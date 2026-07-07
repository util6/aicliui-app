import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createDefaultRouter } from './default-router.js';
import { InMemoryConversationStore } from './conversation-store.js';
import { createFallbackAgentAdapterRegistry } from './agent-adapters/default-registry.js';
import { createAgentAdapterRegistry } from './agent-adapters/registry.js';
import type { CliAgentAdapter } from './agent-adapters/types.js';

describe('default bridge routes', () => {
  it('creates conversations and lists them in AionUi mobile shape', async () => {
    const store = new InMemoryConversationStore({ now: () => 1000, id: () => 'conv-1' });
    const router = createDefaultRouter({ store, adapters: createFallbackAgentAdapterRegistry() });

    const [created] = await router.handleIncoming({
      name: 'subscribe-create-conversation',
      data: {
        id: 'm_create',
        data: {
          type: 'acp',
          name: 'hello',
          model: { id: '', useModel: '' },
          extra: { backend: 'opencode', agentName: 'opencode' },
        },
      },
    });
    const [listed] = await router.handleIncoming({
      name: 'subscribe-database.get-user-conversations',
      data: { id: 'm_list', data: { page: 0, pageSize: 100 } },
    });

    expect(created.data).toMatchObject({
      id: 'conv-1',
      name: 'hello',
      type: 'acp',
      extra: { backend: 'opencode' },
    });
    expect(listed.data).toEqual([created.data]);
  });

  it('serves workspace trees and file contents for the mobile file UI', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'aicliui-workspace-'));
    try {
      await mkdir(join(workspace, 'src'));
      await mkdir(join(workspace, 'node_modules'));
      await writeFile(join(workspace, 'README.md'), '# hello', 'utf8');
      await writeFile(join(workspace, 'src', 'app.ts'), 'export const value = 1;', 'utf8');
      await writeFile(join(workspace, 'node_modules', 'ignored.js'), 'ignored', 'utf8');
      await writeFile(join(workspace, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      await symlink(join(workspace, 'README.md'), join(workspace, 'readme-link.md'));

      const router = createDefaultRouter({ adapters: createFallbackAgentAdapterRegistry() });

      const [workspaceTree] = await router.handleIncoming({
        name: 'subscribe-conversation.get-workspace',
        data: {
          id: 'm_workspace',
          data: { conversation_id: 'conv-1', workspace, path: workspace, search: '' },
        },
      });
      const [srcTree] = await router.handleIncoming({
        name: 'subscribe-get-file-by-dir',
        data: { id: 'm_dir', data: { root: workspace, dir: join(workspace, 'src') } },
      });
      const [text] = await router.handleIncoming({
        name: 'subscribe-read-file',
        data: { id: 'm_text', data: { path: join(workspace, 'README.md') } },
      });
      const [image] = await router.handleIncoming({
        name: 'subscribe-get-image-base64',
        data: { id: 'm_image', data: { path: join(workspace, 'logo.png') } },
      });

      expect(workspaceTree.data).toMatchObject([
        {
          name: basename(workspace),
          fullPath: workspace,
          relativePath: '',
          isDir: true,
          isFile: false,
        },
      ]);
      expect(workspaceTree.data?.[0]?.children).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'README.md', relativePath: 'README.md', isFile: true }),
          expect.objectContaining({ name: 'src', relativePath: 'src', isDir: true }),
        ]),
      );
      expect(JSON.stringify(workspaceTree.data)).not.toContain('node_modules');
      expect(JSON.stringify(workspaceTree.data)).not.toContain('readme-link.md');
      expect(srcTree.data).toEqual([
        expect.objectContaining({
          name: 'src',
          relativePath: 'src',
          children: [expect.objectContaining({ name: 'app.ts', relativePath: 'src/app.ts', isFile: true })],
        }),
      ]);
      expect(text.data).toBe('# hello');
      expect(image.data).toBe('data:image/png;base64,iVBORw==');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('stores user messages and emits assistant stream events for mobile chat UI', async () => {
    let nextId = 0;
    const store = new InMemoryConversationStore({
      now: () => 2000 + nextId,
      id: () => `id-${++nextId}`,
    });
    const router = createDefaultRouter({ store, adapters: createFallbackAgentAdapterRegistry() });

    await router.handleIncoming({
      name: 'subscribe-create-conversation',
      data: {
        id: 'm_create',
        data: {
          type: 'acp',
          name: 'hello',
          model: { id: '', useModel: '' },
          extra: { backend: 'opencode' },
        },
      },
    });

    const messages = await router.handleIncoming({
      name: 'subscribe-chat.send.message',
      data: {
        id: 'm_send',
        data: { conversation_id: 'id-1', msg_id: 'user-msg-1', input: 'hello daemon' },
      },
    });

    expect(messages.map((message) => message.name)).toEqual([
      'subscribe.callback-chat.send.messagem_send',
      'chat.response.stream',
      'chat.response.stream',
      'chat.response.stream',
    ]);
    expect(messages[1].data).toMatchObject({ type: 'start', conversation_id: 'id-1' });
    expect(messages[2].data).toMatchObject({
      type: 'content',
      conversation_id: 'id-1',
      data: { content: 'Local daemon received: hello daemon' },
    });
    expect(messages[3].data).toMatchObject({ type: 'finish', conversation_id: 'id-1' });

    const [history] = await router.handleIncoming({
      name: 'subscribe-database.get-conversation-messages',
      data: { id: 'm_history', data: { conversation_id: 'id-1' } },
    });
    expect(history.data).toMatchObject([
      {
        msg_id: 'user-msg-1',
        type: 'text',
        position: 'right',
        content: { content: 'hello daemon' },
      },
      {
        type: 'text',
        position: 'left',
        content: { content: 'Local daemon received: hello daemon' },
      },
    ]);
  });

  it('routes chat messages through the conversation backend adapter', async () => {
    let nextId = 0;
    const store = new InMemoryConversationStore({
      now: () => 3000 + nextId,
      id: () => `adapter-id-${++nextId}`,
    });
    const router = createDefaultRouter({
      store,
      adapters: createAgentAdapterRegistry([
        {
          backend: 'opencode',
          name: 'opencode',
          label: 'OpenCode',
          probe: async () => ({ backend: 'opencode', state: 'ready' }),
          sendMessage: async function* ({ input }) {
            yield { type: 'thought', subject: 'OpenCode', description: `received ${input}` };
            yield { type: 'content', content: 'adapter response' };
          },
        } satisfies CliAgentAdapter,
      ]),
    });

    await router.handleIncoming({
      name: 'subscribe-create-conversation',
      data: {
        id: 'm_create_adapter',
        data: {
          type: 'acp',
          name: 'hello',
          model: { id: '', useModel: '' },
          extra: { backend: 'opencode' },
        },
      },
    });

    const messages = await router.handleIncoming({
      name: 'subscribe-chat.send.message',
      data: {
        id: 'm_send_adapter',
        data: { conversation_id: 'adapter-id-1', msg_id: 'user-msg-2', input: 'use opencode' },
      },
    });

    expect(messages.map((message) => message.name)).toEqual([
      'subscribe.callback-chat.send.messagem_send_adapter',
      'chat.response.stream',
      'chat.response.stream',
      'chat.response.stream',
      'chat.response.stream',
    ]);
    expect(messages[1].data).toMatchObject({ type: 'start', conversation_id: 'adapter-id-1' });
    expect(messages[2].data).toMatchObject({
      type: 'thought',
      conversation_id: 'adapter-id-1',
      data: { subject: 'OpenCode', description: 'received use opencode' },
    });
    expect(messages[3].data).toMatchObject({
      type: 'content',
      conversation_id: 'adapter-id-1',
      data: { content: 'adapter response' },
    });
    expect(messages[4].data).toMatchObject({ type: 'finish', conversation_id: 'adapter-id-1' });

    const [history] = await router.handleIncoming({
      name: 'subscribe-database.get-conversation-messages',
      data: { id: 'm_history_adapter', data: { conversation_id: 'adapter-id-1' } },
    });
    expect(history.data).toMatchObject([
      { position: 'right', content: { content: 'use opencode' } },
      { position: 'left', content: { content: 'adapter response' } },
    ]);
  });

  it('passes selected files from chat sends to the backend adapter', async () => {
    let nextId = 0;
    const store = new InMemoryConversationStore({
      now: () => 3500 + nextId,
      id: () => `files-id-${++nextId}`,
    });
    const seen: unknown[] = [];
    const router = createDefaultRouter({
      store,
      adapters: createAgentAdapterRegistry([
        {
          backend: 'opencode',
          name: 'opencode',
          label: 'OpenCode',
          probe: async () => ({ backend: 'opencode', state: 'ready' }),
          sendMessage: async function* (input) {
            seen.push(input);
            yield { type: 'content', content: 'adapter response' };
          },
        } satisfies CliAgentAdapter,
      ]),
    });

    await router.handleIncoming({
      name: 'subscribe-create-conversation',
      data: {
        id: 'm_create_files',
        data: {
          type: 'acp',
          name: 'hello',
          model: { id: '', useModel: '' },
          extra: { backend: 'opencode' },
        },
      },
    });

    await router.handleIncoming({
      name: 'subscribe-chat.send.message',
      data: {
        id: 'm_send_files',
        data: {
          conversation_id: 'files-id-1',
          msg_id: 'user-msg-files',
          input: 'use files',
          files: ['/tmp/project/README.md', 123, '/tmp/project/src/app.ts'],
        },
      },
    });

    expect(seen).toEqual([
      expect.objectContaining({
        files: ['/tmp/project/README.md', '/tmp/project/src/app.ts'],
      }),
    ]);
  });

  it('returns slash commands from the active conversation backend adapter', async () => {
    let nextId = 0;
    const store = new InMemoryConversationStore({
      now: () => 4000 + nextId,
      id: () => `slash-id-${++nextId}`,
    });
    const router = createDefaultRouter({
      store,
      adapters: createAgentAdapterRegistry([
        {
          backend: 'opencode',
          name: 'opencode',
          label: 'OpenCode',
          probe: async () => ({ backend: 'opencode', state: 'ready' }),
          sendMessage: async function* () {
            yield { type: 'content', content: 'unused' };
          },
          getSlashCommands: async ({ conversationId, workspace }) => {
            expect(conversationId).toBe('slash-id-1');
            expect(workspace).toBe('/tmp/project');
            return [
              {
                command: 'review',
                description: 'Review current changes',
                hint: 'focus on regressions',
              },
            ];
          },
        } satisfies CliAgentAdapter,
      ]),
    });

    await router.handleIncoming({
      name: 'subscribe-create-conversation',
      data: {
        id: 'm_create_slash',
        data: {
          type: 'acp',
          name: 'hello',
          model: { id: '', useModel: '' },
          extra: { backend: 'opencode', workspace: '/tmp/project' },
        },
      },
    });

    const [commands] = await router.handleIncoming({
      name: 'subscribe-conversation.get-slash-commands',
      data: { id: 'm_slash', data: { conversation_id: 'slash-id-1' } },
    });

    expect(commands.data).toEqual([
      {
        command: 'review',
        description: 'Review current changes',
        hint: 'focus on regressions',
      },
    ]);
  });
});
