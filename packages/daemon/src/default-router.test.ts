import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { createDefaultRouter } from './default-router.js';
import { InMemoryConversationStore } from './conversation-store.js';
import { createFallbackAgentAdapterRegistry } from './agent-adapters/default-registry.js';
import { createAgentAdapterRegistry } from './agent-adapters/registry.js';
import type { CliAgentAdapter } from './agent-adapters/types.js';
import type { ConversationArtifact } from '@aicliui/shared';

const execFileAsync = promisify(execFile);

describe('default bridge routes', () => {
  it('creates conversations and lists them in AionUi mobile shape', async () => {
    const store = new InMemoryConversationStore({ now: () => 1000, id: () => 'conv-1' });
    const router = createDefaultRouter({ store, adapters: createFallbackAgentAdapterRegistry() });

    const createMessages = await router.handleIncoming({
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
    const [created] = createMessages;
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
    expect(createMessages[1]).toMatchObject({
      name: 'conversation.listChanged',
      data: { conversation_id: 'conv-1', action: 'created' },
    });
    expect(listed.data).toEqual([created.data]);
  });

  it('emits AionUi-style conversation.listChanged events for list mutations', async () => {
    let nextId = 0;
    const store = new InMemoryConversationStore({
      now: () => 1050 + nextId,
      id: () => `list-id-${++nextId}`,
    });
    const router = createDefaultRouter({ store, adapters: createFallbackAgentAdapterRegistry() });

    const createMessages = await router.handleIncoming({
      name: 'subscribe-create-conversation',
      data: {
        id: 'm_create_list',
        data: {
          type: 'acp',
          name: 'list sync',
          model: { id: '', useModel: '' },
          extra: { backend: 'opencode' },
        },
      },
    });
    const updateMessages = await router.handleIncoming({
      name: 'subscribe-update-conversation',
      data: { id: 'm_update_list', data: { id: 'list-id-1', updates: { name: 'renamed' } } },
    });
    const removeMessages = await router.handleIncoming({
      name: 'subscribe-remove-conversation',
      data: { id: 'm_remove_list', data: { id: 'list-id-1' } },
    });

    expect(createMessages).toContainEqual(
      expect.objectContaining({
        name: 'conversation.listChanged',
        data: { conversation_id: 'list-id-1', action: 'created', source: 'local' },
      }),
    );
    expect(updateMessages).toContainEqual(
      expect.objectContaining({
        name: 'conversation.listChanged',
        data: { conversation_id: 'list-id-1', action: 'updated', source: 'local' },
      }),
    );
    expect(removeMessages).toContainEqual(
      expect.objectContaining({
        name: 'conversation.listChanged',
        data: { conversation_id: 'list-id-1', action: 'deleted', source: 'local' },
      }),
    );
  });

  it('lists and updates AionUi-style conversation artifacts', async () => {
    let now = 1200;
    const store = new InMemoryConversationStore({
      now: () => now++,
      id: () => 'artifact-conv-1',
    });
    const router = createDefaultRouter({ store, adapters: createFallbackAgentAdapterRegistry() });

    const conversation = store.createConversation({
      type: 'acp',
      name: 'artifact sync',
      model: { id: '', useModel: '' },
      extra: { backend: 'opencode' },
    });
    const artifact: ConversationArtifact = {
      id: 'artifact-1',
      conversation_id: conversation.id,
      kind: 'skill_suggest',
      status: 'pending',
      payload: {
        cron_job_id: 'cron-1',
        name: 'Review skill',
        description: 'Suggest a local review skill',
        skill_content: '# Review',
      },
      created_at: 1200,
      updated_at: 1200,
    };
    store.upsertArtifact(artifact);

    const [listed] = await router.handleIncoming({
      name: 'subscribe-conversation.list-artifacts',
      data: { id: 'm_list_artifacts', data: { conversation_id: conversation.id } },
    });
    expect(listed.data).toEqual([artifact]);

    const updateMessages = await router.handleIncoming({
      name: 'subscribe-conversation.update-artifact',
      data: {
        id: 'm_update_artifact',
        data: {
          conversation_id: conversation.id,
          artifact_id: 'artifact-1',
          status: 'dismissed',
        },
      },
    });

    expect(updateMessages).toHaveLength(2);
    expect(updateMessages[0]).toMatchObject({
      name: 'subscribe.callback-conversation.update-artifactm_update_artifact',
      data: {
        id: 'artifact-1',
        conversation_id: conversation.id,
        kind: 'skill_suggest',
        status: 'dismissed',
        payload: artifact.payload,
      },
    });
    expect(updateMessages[1]).toEqual({
      name: 'conversation.artifact',
      data: updateMessages[0].data,
    });
  });

  it('persists and streams artifact events emitted by local CLI adapters', async () => {
    let now = 1300;
    const store = new InMemoryConversationStore({
      now: () => now++,
      id: () => `artifact-event-${now}`,
    });
    const artifact: ConversationArtifact = {
      id: 'artifact-from-adapter',
      conversation_id: 'artifact-event-1300',
      kind: 'skill_suggest',
      status: 'pending',
      payload: {
        cron_job_id: 'cron-1',
        name: 'Review skill',
        description: 'Review current workspace',
        skill_content: '# Review',
      },
      created_at: 1350,
      updated_at: 1350,
    };
    const router = createDefaultRouter({
      store,
      adapters: createAgentAdapterRegistry([
        {
          backend: 'opencode',
          name: 'opencode',
          label: 'OpenCode',
          probe: async () => ({ backend: 'opencode', state: 'ready' }),
          sendMessage: async function* () {
            yield { type: 'artifact', artifact };
            yield { type: 'content', content: 'done' };
          },
        } satisfies CliAgentAdapter,
      ]),
    });

    const [conversation] = await router.handleIncoming({
      name: 'subscribe-create-conversation',
      data: {
        id: 'm_create_artifact_event',
        data: {
          type: 'acp',
          name: 'artifact event',
          model: { id: '', useModel: '' },
          extra: { backend: 'opencode' },
        },
      },
    });
    const expectedArtifact = {
      ...artifact,
      conversation_id: (conversation.data as { id: string }).id,
    };
    const turnMessages = await router.handleIncoming({
      name: 'subscribe-chat.send.message',
      data: {
        id: 'm_send_artifact_event',
        data: {
          conversation_id: (conversation.data as { id: string }).id,
          input: 'suggest a skill',
          msg_id: 'user-artifact-event',
        },
      },
    });
    const [listed] = await router.handleIncoming({
      name: 'subscribe-conversation.list-artifacts',
      data: {
        id: 'm_list_artifact_event',
        data: { conversation_id: (conversation.data as { id: string }).id },
      },
    });

    expect(turnMessages).toContainEqual({
      name: 'conversation.artifact',
      data: expectedArtifact,
    });
    expect(turnMessages).not.toContainEqual(
      expect.objectContaining({
        name: 'chat.response.stream',
        data: expect.objectContaining({
          type: 'skill_suggest',
        }),
      }),
    );
    expect(listed.data).toEqual([expectedArtifact]);
  });

  it('normalizes selected mobile model context into the conversation model shape', async () => {
    const store = new InMemoryConversationStore({ now: () => 1100, id: () => 'model-conv-1' });
    const router = createDefaultRouter({ store, adapters: createFallbackAgentAdapterRegistry() });

    const [created] = await router.handleIncoming({
      name: 'subscribe-create-conversation',
      data: {
        id: 'm_create_model',
        data: {
          type: 'acp',
          name: 'hello',
          model: { id: '', useModel: '' },
          extra: {
            backend: 'opencode',
            currentModelId: 'anthropic/claude-sonnet-4',
            currentModelLabel: 'Claude Sonnet 4',
          },
        },
      },
    });

    expect(created.data).toMatchObject({
      id: 'model-conv-1',
      model: {
        id: 'anthropic/claude-sonnet-4',
        useModel: 'Claude Sonnet 4',
      },
      extra: {
        currentModelId: 'anthropic/claude-sonnet-4',
        currentModelLabel: 'Claude Sonnet 4',
      },
    });
  });

  it('falls back to the selected model id when the mobile model label is not a string', async () => {
    const store = new InMemoryConversationStore({ now: () => 1200, id: () => 'model-conv-2' });
    const router = createDefaultRouter({ store, adapters: createFallbackAgentAdapterRegistry() });

    const [created] = await router.handleIncoming({
      name: 'subscribe-create-conversation',
      data: {
        id: 'm_create_model_invalid_label',
        data: {
          type: 'acp',
          name: 'hello',
          model: { id: '', useModel: '' },
          extra: {
            backend: 'opencode',
            currentModelId: 'anthropic/claude-sonnet-4',
            currentModelLabel: 123,
          },
        },
      },
    });

    expect(created.data).toMatchObject({
      id: 'model-conv-2',
      model: {
        id: 'anthropic/claude-sonnet-4',
        useModel: 'anthropic/claude-sonnet-4',
      },
    });
  });

  it('returns adapter model info through the AionUi mobile bridge contract', async () => {
    const router = createDefaultRouter({
      adapters: createAgentAdapterRegistry([
        {
          backend: 'codex',
          name: 'codex',
          label: 'Codex CLI',
          probe: async () => ({ backend: 'codex', state: 'ready' }),
          getModelInfo: async () => ({
            currentModelId: null,
            currentModelLabel: 'Default Codex model',
            availableModels: [{ id: 'gpt-5-codex', label: 'GPT-5 Codex' }],
            canSwitch: true,
            source: 'models',
          }),
          sendMessage: async function* () {
            yield { type: 'content', content: 'ok' };
          },
        } satisfies CliAgentAdapter,
      ]),
    });

    const [modelInfo] = await router.handleIncoming({
      name: 'subscribe-acp.probe-model-info',
      data: { id: 'm_model_info', data: { backend: 'codex' } },
    });

    expect(modelInfo.data).toEqual({
      success: true,
      data: {
        modelInfo: {
          currentModelId: null,
          currentModelLabel: 'Default Codex model',
          availableModels: [{ id: 'gpt-5-codex', label: 'GPT-5 Codex' }],
          canSwitch: true,
          source: 'models',
        },
      },
    });
  });

  it('ensures conversation runtime and exposes AionUi-style config options', async () => {
    const store = new InMemoryConversationStore({ now: () => 1300, id: () => 'runtime-conv-1' });
    const router = createDefaultRouter({
      store,
      adapters: createAgentAdapterRegistry([
        {
          backend: 'codex',
          name: 'codex',
          label: 'Codex CLI',
          probe: async () => ({ backend: 'codex', state: 'ready' }),
          getModelInfo: async () => ({
            currentModelId: null,
            currentModelLabel: 'Default Codex model',
            availableModels: [{ id: 'gpt-5-codex', label: 'GPT-5 Codex' }],
            canSwitch: true,
            source: 'models',
          }),
          sendMessage: async function* () {
            yield { type: 'content', content: 'ok' };
          },
        } satisfies CliAgentAdapter,
      ]),
    });

    await router.handleIncoming({
      name: 'subscribe-create-conversation',
      data: {
        id: 'm_create_runtime',
        data: {
          type: 'codex',
          name: 'runtime',
          model: { id: '', useModel: '' },
          extra: { backend: 'codex', sessionMode: 'default' },
        },
      },
    });

    const [runtime] = await router.handleIncoming({
      name: 'subscribe-conversation.ensure-runtime',
      data: { id: 'm_runtime', data: { conversation_id: 'runtime-conv-1' } },
    });

    expect(runtime.data).toMatchObject({
      recovered: false,
      runtime: {
        state: 'idle',
        can_send_message: true,
        is_processing: false,
        turn_id: null,
      },
      config_options: [
        {
          id: 'model',
          category: 'model',
          option_type: 'select',
          current_value: null,
          options: [{ value: 'gpt-5-codex', label: 'GPT-5 Codex' }],
        },
        {
          id: 'mode',
          category: 'mode',
          option_type: 'select',
          current_value: 'default',
          options: expect.arrayContaining([{ value: 'autoEdit', label: 'Auto Edit' }]),
        },
      ],
    });
  });

  it('sets model and mode config options through the conversation runtime route', async () => {
    const store = new InMemoryConversationStore({ now: () => 1400, id: () => 'config-conv-1' });
    const router = createDefaultRouter({
      store,
      adapters: createAgentAdapterRegistry([
        {
          backend: 'codex',
          name: 'codex',
          label: 'Codex CLI',
          probe: async () => ({ backend: 'codex', state: 'ready' }),
          getModelInfo: async () => ({
            currentModelId: null,
            currentModelLabel: 'Default Codex model',
            availableModels: [{ id: 'gpt-5-codex', label: 'GPT-5 Codex' }],
            canSwitch: true,
            source: 'models',
          }),
          sendMessage: async function* () {
            yield { type: 'content', content: 'ok' };
          },
        } satisfies CliAgentAdapter,
      ]),
    });

    await router.handleIncoming({
      name: 'subscribe-create-conversation',
      data: {
        id: 'm_create_config',
        data: {
          type: 'codex',
          name: 'config',
          model: { id: '', useModel: '' },
          extra: { backend: 'codex', sessionMode: 'default' },
        },
      },
    });

    const modelUpdateMessages = await router.handleIncoming({
      name: 'subscribe-conversation.set-config-option',
      data: {
        id: 'm_set_model',
        data: {
          conversation_id: 'config-conv-1',
          option_id: 'model',
          value: 'gpt-5-codex',
        },
      },
    });
    const [modelUpdate] = modelUpdateMessages;
    const modeUpdateMessages = await router.handleIncoming({
      name: 'subscribe-conversation.set-config-option',
      data: {
        id: 'm_set_mode',
        data: {
          conversation_id: 'config-conv-1',
          option_id: 'mode',
          value: 'autoEdit',
        },
      },
    });
    const [modeUpdate] = modeUpdateMessages;
    const [conversation] = await router.handleIncoming({
      name: 'subscribe-conversation.get',
      data: { id: 'm_get_config', data: { conversation_id: 'config-conv-1' } },
    });

    expect(modelUpdate.data).toMatchObject({
      confirmation: 'observed',
      config_options: expect.arrayContaining([
        expect.objectContaining({
          id: 'model',
          current_value: 'gpt-5-codex',
        }),
      ]),
    });
    expect(modelUpdateMessages).toContainEqual(
      expect.objectContaining({
        name: 'conversation.listChanged',
        data: { conversation_id: 'config-conv-1', action: 'updated', source: 'local' },
      }),
    );
    expect(modeUpdate.data).toMatchObject({
      confirmation: 'observed',
      config_options: expect.arrayContaining([
        expect.objectContaining({
          id: 'mode',
          current_value: 'autoEdit',
        }),
      ]),
    });
    expect(modeUpdateMessages).toContainEqual(
      expect.objectContaining({
        name: 'conversation.listChanged',
        data: { conversation_id: 'config-conv-1', action: 'updated', source: 'local' },
      }),
    );
    expect(conversation.data).toMatchObject({
      model: { id: 'gpt-5-codex', useModel: 'GPT-5 Codex' },
      extra: {
        currentModelId: 'gpt-5-codex',
        currentModelLabel: 'GPT-5 Codex',
        sessionMode: 'autoEdit',
      },
    });
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

  it('compares local git workspace changes in the AionUi fileSnapshot shape', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'aicliui-workspace-diff-'));
    try {
      await execFileAsync('git', ['init'], { cwd: workspace });
      await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: workspace });
      await execFileAsync('git', ['config', 'user.name', 'AICLIUI Test'], { cwd: workspace });
      await mkdir(join(workspace, 'src'));
      await writeFile(join(workspace, 'README.md'), '# hello\n', 'utf8');
      await writeFile(join(workspace, 'src', 'app.ts'), 'export const value = 1;\n', 'utf8');
      await execFileAsync('git', ['add', '.'], { cwd: workspace });
      await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: workspace });

      await writeFile(join(workspace, 'README.md'), '# hello\n\nstaged\n', 'utf8');
      await execFileAsync('git', ['add', 'README.md'], { cwd: workspace });
      await writeFile(join(workspace, 'src', 'app.ts'), 'export const value = 2;\n', 'utf8');
      await writeFile(join(workspace, 'draft.md'), 'one\ntwo\n', 'utf8');

      const router = createDefaultRouter({ adapters: createFallbackAgentAdapterRegistry() });
      const [changes] = await router.handleIncoming({
        name: 'subscribe-fileSnapshot.compare',
        data: { id: 'm_changes', data: { workspace } },
      });
      const [stagedDiff] = await router.handleIncoming({
        name: 'subscribe-fileSnapshot.diff',
        data: { id: 'm_staged_diff', data: { workspace, relativePath: 'README.md', source: 'staged' } },
      });
      const [untrackedDiff] = await router.handleIncoming({
        name: 'subscribe-fileSnapshot.diff',
        data: { id: 'm_untracked_diff', data: { workspace, relativePath: 'draft.md', source: 'unstaged' } },
      });

      expect(changes.data).toMatchObject({
        mode: 'git-repo',
        branch: expect.any(String),
        staged: [
          expect.objectContaining({
            file_path: join(workspace, 'README.md'),
            relativePath: 'README.md',
            operation: 'modify',
            additions: expect.any(Number),
            deletions: expect.any(Number),
          }),
        ],
        unstaged: expect.arrayContaining([
          expect.objectContaining({
            file_path: join(workspace, 'src', 'app.ts'),
            relativePath: 'src/app.ts',
            operation: 'modify',
          }),
          expect.objectContaining({
            file_path: join(workspace, 'draft.md'),
            relativePath: 'draft.md',
            operation: 'create',
            additions: 2,
            deletions: 0,
          }),
        ]),
      });
      expect(stagedDiff.data).toMatchObject({
        relativePath: 'README.md',
        source: 'staged',
        diff: expect.stringContaining('+staged'),
      });
      expect(untrackedDiff.data).toMatchObject({
        relativePath: 'draft.md',
        source: 'unstaged',
        diff: expect.stringContaining('+one'),
      });

      await router.handleIncoming({
        name: 'subscribe-fileSnapshot.stageFile',
        data: { id: 'm_stage_file', data: { workspace, relativePath: 'src/app.ts' } },
      });
      const [afterStageFile] = await router.handleIncoming({
        name: 'subscribe-fileSnapshot.compare',
        data: { id: 'm_after_stage_file', data: { workspace } },
      });
      expect(afterStageFile.data).toMatchObject({
        staged: expect.arrayContaining([expect.objectContaining({ relativePath: 'src/app.ts' })]),
        unstaged: expect.arrayContaining([expect.objectContaining({ relativePath: 'draft.md' })]),
      });

      await router.handleIncoming({
        name: 'subscribe-fileSnapshot.unstageFile',
        data: { id: 'm_unstage_file', data: { workspace, relativePath: 'src/app.ts' } },
      });
      const [afterUnstageFile] = await router.handleIncoming({
        name: 'subscribe-fileSnapshot.compare',
        data: { id: 'm_after_unstage_file', data: { workspace } },
      });
      expect(afterUnstageFile.data).toMatchObject({
        staged: [expect.objectContaining({ relativePath: 'README.md' })],
        unstaged: expect.arrayContaining([expect.objectContaining({ relativePath: 'src/app.ts' })]),
      });

      await router.handleIncoming({
        name: 'subscribe-fileSnapshot.stageAll',
        data: { id: 'm_stage_all', data: { workspace } },
      });
      const [afterStageAll] = await router.handleIncoming({
        name: 'subscribe-fileSnapshot.compare',
        data: { id: 'm_after_stage_all', data: { workspace } },
      });
      expect(afterStageAll.data).toMatchObject({
        staged: expect.arrayContaining([
          expect.objectContaining({ relativePath: 'README.md' }),
          expect.objectContaining({ relativePath: 'src/app.ts' }),
          expect.objectContaining({ relativePath: 'draft.md' }),
        ]),
        unstaged: [],
      });

      await router.handleIncoming({
        name: 'subscribe-fileSnapshot.unstageAll',
        data: { id: 'm_unstage_all', data: { workspace } },
      });
      const [afterUnstageAll] = await router.handleIncoming({
        name: 'subscribe-fileSnapshot.compare',
        data: { id: 'm_after_unstage_all', data: { workspace } },
      });
      expect(afterUnstageAll.data).toMatchObject({
        staged: [],
        unstaged: expect.arrayContaining([
          expect.objectContaining({ relativePath: 'README.md' }),
          expect.objectContaining({ relativePath: 'src/app.ts' }),
          expect.objectContaining({ relativePath: 'draft.md' }),
        ]),
      });

      await router.handleIncoming({
        name: 'subscribe-fileSnapshot.discardFile',
        data: { id: 'm_discard_modify', data: { workspace, relativePath: 'src/app.ts', operation: 'modify' } },
      });
      expect(await readFile(join(workspace, 'src', 'app.ts'), 'utf8')).toBe('export const value = 1;\n');

      await router.handleIncoming({
        name: 'subscribe-fileSnapshot.discardFile',
        data: { id: 'm_discard_create', data: { workspace, relativePath: 'draft.md', operation: 'create' } },
      });
      await expect(access(join(workspace, 'draft.md'))).rejects.toThrow();

      const [afterDiscard] = await router.handleIncoming({
        name: 'subscribe-fileSnapshot.compare',
        data: { id: 'm_after_discard', data: { workspace } },
      });
      expect(afterDiscard.data).toMatchObject({
        staged: [],
        unstaged: [expect.objectContaining({ relativePath: 'README.md' })],
      });
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

    expect(messages[0].data).toMatchObject({
      success: true,
      msg_id: 'user-msg-1',
      turn_id: 'assistant_user-msg-1',
      runtime: {
        state: 'running',
        can_send_message: false,
        has_task: true,
        task_status: 'running',
        is_processing: true,
        pending_confirmations: 0,
        turn_id: 'assistant_user-msg-1',
      },
    });
    expect(messages.map((message) => message.name)).toEqual([
      'subscribe.callback-chat.send.messagem_send',
      'message.userCreated',
      'chat.response.stream',
      'chat.response.stream',
      'chat.response.stream',
      'turn.completed',
    ]);
    expect(messages[1].data).toMatchObject({
      conversation_id: 'id-1',
      msg_id: 'user-msg-1',
      content: 'hello daemon',
      position: 'right',
      status: 'finish',
      hidden: false,
    });
    expect(messages[2].data).toMatchObject({ type: 'start', conversation_id: 'id-1' });
    expect(messages[3].data).toMatchObject({
      type: 'content',
      conversation_id: 'id-1',
      data: { content: 'Local daemon received: hello daemon' },
    });
    expect(messages[4].data).toMatchObject({ type: 'finish', conversation_id: 'id-1' });

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
      'message.userCreated',
      'chat.response.stream',
      'chat.response.stream',
      'chat.response.stream',
      'chat.response.stream',
      'turn.completed',
    ]);
    expect(messages[2].data).toMatchObject({ type: 'start', conversation_id: 'adapter-id-1' });
    expect(messages[3].data).toMatchObject({
      type: 'thought',
      conversation_id: 'adapter-id-1',
      data: { subject: 'OpenCode', description: 'received use opencode' },
    });
    expect(messages[4].data).toMatchObject({
      type: 'content',
      conversation_id: 'adapter-id-1',
      data: { content: 'adapter response' },
    });
    expect(messages[5].data).toMatchObject({ type: 'finish', conversation_id: 'adapter-id-1' });

    const [history] = await router.handleIncoming({
      name: 'subscribe-database.get-conversation-messages',
      data: { id: 'm_history_adapter', data: { conversation_id: 'adapter-id-1' } },
    });
    expect(history.data).toMatchObject([
      { position: 'right', content: { content: 'use opencode' } },
      { position: 'left', content: { content: 'adapter response' } },
    ]);
  });

  it('emits an AionUi-style turn.completed event with the final runtime summary', async () => {
    let nextId = 0;
    const store = new InMemoryConversationStore({
      now: () => 3050 + nextId,
      id: () => `turn-id-${++nextId}`,
    });
    const router = createDefaultRouter({
      store,
      adapters: createAgentAdapterRegistry([
        {
          backend: 'codex',
          name: 'codex',
          label: 'Codex CLI',
          probe: async () => ({ backend: 'codex', state: 'ready' }),
          sendMessage: async function* () {
            yield { type: 'content', content: 'turn done' };
          },
        } satisfies CliAgentAdapter,
      ]),
    });

    await router.handleIncoming({
      name: 'subscribe-create-conversation',
      data: {
        id: 'm_create_turn',
        data: {
          type: 'codex',
          name: 'turn',
          model: { id: 'gpt-5-codex', useModel: 'GPT-5 Codex' },
          extra: {
            backend: 'codex',
            workspace: '/tmp/project',
            currentModelId: 'gpt-5-codex',
            currentModelLabel: 'GPT-5 Codex',
          },
        },
      },
    });

    const messages = await router.handleIncoming({
      name: 'subscribe-chat.send.message',
      data: {
        id: 'm_send_turn',
        data: { conversation_id: 'turn-id-1', msg_id: 'user-msg-turn', input: 'finish with runtime' },
      },
    });

    const turnCompleted = messages.find((message) => message.name === 'turn.completed');
    expect(turnCompleted?.data).toMatchObject({
      session_id: 'turn-id-1',
      turn_id: 'assistant_user-msg-turn',
      status: 'finished',
      state: 'ai_waiting_input',
      detail: '',
      can_send_message: true,
      runtime: {
        state: 'idle',
        can_send_message: true,
        has_task: false,
        task_status: 'finished',
        is_processing: false,
        pending_confirmations: 0,
        turn_id: null,
      },
      workspace: '/tmp/project',
      model: {
        platform: 'codex',
        name: 'Codex CLI',
        use_model: 'GPT-5 Codex',
      },
      last_message: {
        type: 'text',
        content: { content: 'turn done' },
        status: 'finish',
      },
    });
  });

  it('streams adapter runtime failures as assistant content and finishes the turn', async () => {
    let nextId = 0;
    const store = new InMemoryConversationStore({
      now: () => 3100 + nextId,
      id: () => `failure-id-${++nextId}`,
    });
    const router = createDefaultRouter({
      store,
      adapters: createAgentAdapterRegistry([
        {
          backend: 'codex',
          name: 'codex',
          label: 'Codex CLI',
          probe: async () => ({ backend: 'codex', state: 'ready' }),
          sendMessage: async function* () {
            throw new Error('codex failed apiKey=local-value');
          },
        } satisfies CliAgentAdapter,
      ]),
    });

    await router.handleIncoming({
      name: 'subscribe-create-conversation',
      data: {
        id: 'm_create_failure',
        data: {
          type: 'codex',
          name: 'hello',
          model: { id: '', useModel: '' },
          extra: { backend: 'codex' },
        },
      },
    });

    const messages = await router.handleIncoming({
      name: 'subscribe-chat.send.message',
      data: {
        id: 'm_send_failure',
        data: { conversation_id: 'failure-id-1', msg_id: 'user-msg-failure', input: 'use codex' },
      },
    });

    expect(messages.map((message) => message.name)).toEqual([
      'subscribe.callback-chat.send.messagem_send_failure',
      'message.userCreated',
      'chat.response.stream',
      'chat.response.stream',
      'chat.response.stream',
      'turn.completed',
    ]);
    expect(messages[0].data).toMatchObject({
      success: true,
      msg_id: 'user-msg-failure',
      turn_id: 'assistant_user-msg-failure',
      runtime: { state: 'running', turn_id: 'assistant_user-msg-failure' },
    });
    expect(messages[2].data).toMatchObject({ type: 'start', conversation_id: 'failure-id-1' });
    expect(messages[3].data).toMatchObject({
      type: 'content',
      conversation_id: 'failure-id-1',
      data: { content: 'Codex CLI runtime failed: codex failed apiKey=[redacted]' },
    });
    expect(messages[4].data).toMatchObject({ type: 'finish', conversation_id: 'failure-id-1' });
    expect(JSON.stringify(messages)).not.toContain('local-value');

    const [history] = await router.handleIncoming({
      name: 'subscribe-database.get-conversation-messages',
      data: { id: 'm_history_failure', data: { conversation_id: 'failure-id-1' } },
    });
    expect(history.data).toMatchObject([
      { position: 'right', content: { content: 'use codex' } },
      { position: 'left', content: { content: 'Codex CLI runtime failed: codex failed apiKey=[redacted]' } },
    ]);
    expect(JSON.stringify(history.data)).not.toContain('local-value');
  });

  it('forwards AionUi client stream event types from backend adapters', async () => {
    let nextId = 0;
    const store = new InMemoryConversationStore({
      now: () => 3200 + nextId,
      id: () => `stream-id-${++nextId}`,
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
            yield {
              type: 'thinking',
              content: 'Inspecting workspace',
              subject: 'OpenCode',
              status: 'thinking',
            };
            yield {
              type: 'tool_group',
              tools: [
                {
                  callId: 'tool-1',
                  call_id: 'tool-1',
                  name: 'read',
                  description: 'README.md',
                  status: 'Executing',
                  resultDisplay: '',
                },
              ],
            };
            yield {
              type: 'acp_tool_call',
              data: {
                update: {
                  tool_call_id: 'acp-tool-1',
                  title: 'Read file',
                  kind: 'read',
                  status: 'in_progress',
                  raw_input: { path: 'README.md' },
                },
              },
            };
            yield { type: 'context_usage', used: 12, size: 100 };
            yield {
              type: 'plan',
              data: {
                session_id: 'plan-1',
                entries: [{ title: 'Inspect files', status: 'completed' }],
              },
            };
            yield { type: 'content', content: 'adapter response' };
          },
        } satisfies CliAgentAdapter,
      ]),
    });

    await router.handleIncoming({
      name: 'subscribe-create-conversation',
      data: {
        id: 'm_create_stream',
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
        id: 'm_send_stream',
        data: { conversation_id: 'stream-id-1', msg_id: 'user-msg-stream', input: 'use tools' },
      },
    });

    expect(messages.map((message) => message.name)).toEqual([
      'subscribe.callback-chat.send.messagem_send_stream',
      'message.userCreated',
      'chat.response.stream',
      'chat.response.stream',
      'chat.response.stream',
      'chat.response.stream',
      'chat.response.stream',
      'chat.response.stream',
      'chat.response.stream',
      'chat.response.stream',
      'turn.completed',
    ]);
    expect(messages[3].data).toMatchObject({
      type: 'thinking',
      conversation_id: 'stream-id-1',
      data: { content: 'Inspecting workspace', subject: 'OpenCode', status: 'thinking' },
    });
    expect(messages[4].data).toMatchObject({
      type: 'tool_group',
      conversation_id: 'stream-id-1',
      data: [expect.objectContaining({ callId: 'tool-1', call_id: 'tool-1', name: 'read' })],
    });
    expect(messages[5].data).toMatchObject({
      type: 'acp_tool_call',
      conversation_id: 'stream-id-1',
      data: { update: { tool_call_id: 'acp-tool-1', status: 'in_progress' } },
    });
    expect(messages[6].data).toMatchObject({
      type: 'acp_context_usage',
      conversation_id: 'stream-id-1',
      data: { used: 12, size: 100 },
    });
    expect(messages[7].data).toMatchObject({
      type: 'plan',
      conversation_id: 'stream-id-1',
      data: { session_id: 'plan-1' },
    });

    const [conversation] = await router.handleIncoming({
      name: 'subscribe-conversation.get',
      data: { id: 'm_get_stream', data: { conversation_id: 'stream-id-1' } },
    });
    expect(conversation.data).toMatchObject({
      id: 'stream-id-1',
      extra: {
        lastContextUsage: { used: 12, size: 100 },
      },
    });

    const [listed] = await router.handleIncoming({
      name: 'subscribe-database.get-user-conversations',
      data: { id: 'm_list_stream', data: { page: 0, pageSize: 100 } },
    });
    expect(listed.data).toEqual([
      expect.objectContaining({
        id: 'stream-id-1',
        extra: expect.objectContaining({
          lastContextUsage: { used: 12, size: 100 },
        }),
      }),
    ]);
  });

  it('tracks adapter confirmations for the mobile permission UI', async () => {
    let nextId = 0;
    const confirmed: unknown[] = [];
    const store = new InMemoryConversationStore({
      now: () => 3300 + nextId,
      id: () => `confirm-id-${++nextId}`,
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
            yield {
              type: 'permission',
              confirmation: {
                id: 'permission-1',
                title: 'OpenCode permission',
                action: 'execute',
                description: 'Run command: npm test',
                call_id: 'call-1',
                callId: 'call-1',
                options: [
                  { label: 'Allow once', value: 'once' },
                  { label: 'Reject', value: 'reject' },
                ],
              },
            };
            yield { type: 'content', content: 'waiting for permission' };
          },
          confirm: async (input) => {
            confirmed.push(input);
            return { success: true };
          },
        } satisfies CliAgentAdapter,
      ]),
    });

    await router.handleIncoming({
      name: 'subscribe-create-conversation',
      data: {
        id: 'm_create_confirm',
        data: {
          type: 'acp',
          name: 'hello',
          model: { id: '', useModel: '' },
          extra: { backend: 'opencode' },
        },
      },
    });

    const sendMessages = await router.handleIncoming({
      name: 'subscribe-chat.send.message',
      data: {
        id: 'm_send_confirm',
        data: { conversation_id: 'confirm-id-1', msg_id: 'user-msg-confirm', input: 'needs permission' },
      },
    });

    expect(sendMessages.map((message) => message.name)).toContain('confirmation.add');
    expect(sendMessages.find((message) => message.name === 'confirmation.add')?.data).toMatchObject({
      id: 'permission-1',
      msg_id: 'assistant_user-msg-confirm',
      conversation_id: 'confirm-id-1',
      call_id: 'call-1',
      callId: 'call-1',
    });

    const [pending] = await router.handleIncoming({
      name: 'subscribe-confirmation.list',
      data: { id: 'm_list_confirm', data: { conversation_id: 'confirm-id-1' } },
    });
    expect(pending.data).toEqual([
      expect.objectContaining({
        id: 'permission-1',
        conversation_id: 'confirm-id-1',
      }),
    ]);

    const confirmMessages = await router.handleIncoming({
      name: 'subscribe-confirmation.confirm',
      data: {
        id: 'm_confirm',
        data: {
          conversation_id: 'confirm-id-1',
          msg_id: 'permission-1',
          callId: 'call-1',
          data: 'once',
        },
      },
    });

    expect(confirmMessages.map((message) => message.name)).toEqual([
      'subscribe.callback-confirmation.confirmm_confirm',
      'confirmation.remove',
    ]);
    expect(confirmMessages[0].data).toEqual({ success: true });
    expect(confirmMessages[1].data).toEqual({ conversation_id: 'confirm-id-1', id: 'permission-1' });
    expect(confirmed).toEqual([
      {
        conversationId: 'confirm-id-1',
        confirmationId: 'permission-1',
        callId: 'call-1',
        data: 'once',
      },
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

  it('passes conversation default files to the backend adapter for initial mobile sends', async () => {
    let nextId = 0;
    const store = new InMemoryConversationStore({
      now: () => 3600 + nextId,
      id: () => `default-files-id-${++nextId}`,
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
        id: 'm_create_default_files',
        data: {
          type: 'acp',
          name: 'hello',
          model: { id: '', useModel: '' },
          extra: {
            backend: 'opencode',
            defaultFiles: ['/tmp/project/README.md', 123, '/tmp/project/README.md', '/tmp/project/src/app.ts'],
          },
        },
      },
    });

    await router.handleIncoming({
      name: 'subscribe-chat.send.message',
      data: {
        id: 'm_send_default_files',
        data: {
          conversation_id: 'default-files-id-1',
          msg_id: 'user-msg-default-files',
          input: 'use default files',
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

  it('aborts the active adapter stream when chat.stop.stream is requested', async () => {
    let nextId = 0;
    let capturedSignal: AbortSignal | undefined;
    let startedResolve!: () => void;
    let stoppedResolve!: () => void;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    const stopped = new Promise<void>((resolve) => {
      stoppedResolve = resolve;
    });
    const store = new InMemoryConversationStore({
      now: () => 5000 + nextId,
      id: () => `stop-id-${++nextId}`,
    });
    const router = createDefaultRouter({
      store,
      adapters: createAgentAdapterRegistry([
        {
          backend: 'codex',
          name: 'codex',
          label: 'Codex CLI',
          probe: async () => ({ backend: 'codex', state: 'ready' }),
          sendMessage: async function* (input) {
            capturedSignal = input.signal;
            startedResolve();
            if (!input.signal) return;
            await new Promise<void>((resolve) => {
              input.signal?.addEventListener(
                'abort',
                () => {
                  stoppedResolve();
                  resolve();
                },
                { once: true },
              );
            });
          },
        } satisfies CliAgentAdapter,
      ]),
    });

    await router.handleIncoming({
      name: 'subscribe-create-conversation',
      data: {
        id: 'm_create_stop',
        data: {
          type: 'codex',
          name: 'stop me',
          model: { id: '', useModel: '' },
          extra: { backend: 'codex' },
        },
      },
    });

    const sendPromise = router.handleIncoming({
      name: 'subscribe-chat.send.message',
      data: {
        id: 'm_send_stop',
        data: { conversation_id: 'stop-id-1', msg_id: 'user-msg-stop', input: 'long running' },
      },
    });

    await started;
    expect(capturedSignal?.aborted).toBe(false);

    const [stopResponse] = await router.handleIncoming({
      name: 'subscribe-chat.stop.stream',
      data: { id: 'm_stop', data: { conversation_id: 'stop-id-1' } },
    });

    expect(stopResponse.data).toMatchObject({
      success: true,
      stopped: true,
      runtime: {
        state: 'idle',
        can_send_message: true,
        has_task: false,
        task_status: 'finished',
        is_processing: false,
        pending_confirmations: 0,
        turn_id: null,
      },
    });
    const [stoppedConversation] = await router.handleIncoming({
      name: 'subscribe-conversation.get',
      data: { id: 'm_get_stopped', data: { conversation_id: 'stop-id-1' } },
    });
    expect(stoppedConversation.data).toMatchObject({ id: 'stop-id-1', status: 'finished' });

    await stopped;

    const sendMessages = await sendPromise;
    expect(capturedSignal?.aborted).toBe(true);
    expect(sendMessages).toContainEqual(
      expect.objectContaining({
        name: 'chat.response.stream',
        data: expect.objectContaining({
          type: 'content',
          conversation_id: 'stop-id-1',
          data: { content: 'Generation stopped.' },
        }),
      }),
    );
    expect(sendMessages).toContainEqual(
      expect.objectContaining({
        name: 'chat.response.stream',
        data: expect.objectContaining({ type: 'finish', conversation_id: 'stop-id-1' }),
      }),
    );
    expect(sendMessages.at(-1)).toMatchObject({
      name: 'turn.completed',
      data: { session_id: 'stop-id-1', turn_id: 'assistant_user-msg-stop' },
    });
  });

  it('forwards chat.stop.stream to the active backend adapter abort hook', async () => {
    let nextId = 0;
    const aborts: unknown[] = [];
    let startedResolve!: () => void;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    const store = new InMemoryConversationStore({
      now: () => 5200 + nextId,
      id: () => `adapter-stop-id-${++nextId}`,
    });
    const router = createDefaultRouter({
      store,
      adapters: createAgentAdapterRegistry([
        {
          backend: 'opencode',
          name: 'opencode',
          label: 'OpenCode',
          probe: async () => ({ backend: 'opencode', state: 'ready' }),
          sendMessage: async function* (input) {
            startedResolve();
            if (!input.signal) return;
            await new Promise<void>((resolve) => {
              input.signal?.addEventListener('abort', () => resolve(), { once: true });
            });
          },
          abort: async (input) => {
            aborts.push(input);
            return { success: true };
          },
        } satisfies CliAgentAdapter,
      ]),
    });

    await router.handleIncoming({
      name: 'subscribe-create-conversation',
      data: {
        id: 'm_create_adapter_stop',
        data: {
          type: 'acp',
          name: 'adapter stop',
          model: { id: '', useModel: '' },
          extra: { backend: 'opencode' },
        },
      },
    });

    const sendPromise = router.handleIncoming({
      name: 'subscribe-chat.send.message',
      data: {
        id: 'm_send_adapter_stop',
        data: { conversation_id: 'adapter-stop-id-1', msg_id: 'user-msg-adapter-stop', input: 'long running' },
      },
    });

    await started;
    const [stopResponse] = await router.handleIncoming({
      name: 'subscribe-chat.stop.stream',
      data: { id: 'm_adapter_stop', data: { conversation_id: 'adapter-stop-id-1' } },
    });

    expect(stopResponse.data).toMatchObject({ success: true, stopped: true });
    expect(aborts).toEqual([{ conversationId: 'adapter-stop-id-1' }]);
    await sendPromise;
  });

  it('marks conversations running while an adapter stream is active and finished when it ends', async () => {
    let nextId = 0;
    let startedResolve!: () => void;
    let continueResolve!: () => void;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    const shouldContinue = new Promise<void>((resolve) => {
      continueResolve = resolve;
    });
    const store = new InMemoryConversationStore({
      now: () => 6000 + nextId,
      id: () => `status-id-${++nextId}`,
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
            startedResolve();
            await shouldContinue;
            yield { type: 'content', content: 'done' };
          },
        } satisfies CliAgentAdapter,
      ]),
    });

    await router.handleIncoming({
      name: 'subscribe-create-conversation',
      data: {
        id: 'm_create_status',
        data: {
          type: 'acp',
          name: 'status',
          model: { id: '', useModel: '' },
          extra: { backend: 'opencode' },
        },
      },
    });

    const sendPromise = router.handleIncoming({
      name: 'subscribe-chat.send.message',
      data: {
        id: 'm_send_status',
        data: { conversation_id: 'status-id-1', msg_id: 'user-msg-status', input: 'long running' },
      },
    });

    await started;
    const [running] = await router.handleIncoming({
      name: 'subscribe-conversation.get',
      data: { id: 'm_get_running', data: { conversation_id: 'status-id-1' } },
    });
    expect(running.data).toMatchObject({
      id: 'status-id-1',
      status: 'running',
      runtime: {
        state: 'running',
        can_send_message: false,
        has_task: true,
        task_status: 'running',
        is_processing: true,
        pending_confirmations: 0,
        turn_id: 'assistant_user-msg-status',
      },
    });

    continueResolve();
    await sendPromise;

    const [finished] = await router.handleIncoming({
      name: 'subscribe-conversation.get',
      data: { id: 'm_get_finished', data: { conversation_id: 'status-id-1' } },
    });
    expect(finished.data).toMatchObject({
      id: 'status-id-1',
      status: 'finished',
      runtime: {
        state: 'idle',
        can_send_message: true,
        has_task: false,
        task_status: 'finished',
        is_processing: false,
        pending_confirmations: 0,
        turn_id: null,
      },
    });
  });

  it('marks a conversation waiting while an adapter confirmation is pending', async () => {
    let nextId = 0;
    let permissionResolve!: () => void;
    let continueResolve!: () => void;
    const permissionYielded = new Promise<void>((resolve) => {
      permissionResolve = resolve;
    });
    const shouldContinue = new Promise<void>((resolve) => {
      continueResolve = resolve;
    });
    const store = new InMemoryConversationStore({
      now: () => 7000 + nextId,
      id: () => `waiting-id-${++nextId}`,
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
            yield {
              type: 'permission',
              confirmation: {
                id: 'permission-waiting',
                title: 'OpenCode permission',
                call_id: 'call-waiting',
                options: [{ label: 'Allow once', value: 'once' }],
              },
            };
            permissionResolve();
            await shouldContinue;
            yield { type: 'content', content: 'done' };
          },
          confirm: async () => ({ success: true }),
        } satisfies CliAgentAdapter,
      ]),
    });

    await router.handleIncoming({
      name: 'subscribe-create-conversation',
      data: {
        id: 'm_create_waiting',
        data: {
          type: 'acp',
          name: 'waiting',
          model: { id: '', useModel: '' },
          extra: { backend: 'opencode' },
        },
      },
    });

    const sendPromise = router.handleIncoming({
      name: 'subscribe-chat.send.message',
      data: {
        id: 'm_send_waiting',
        data: { conversation_id: 'waiting-id-1', msg_id: 'user-msg-waiting', input: 'needs permission' },
      },
    });

    await permissionYielded;
    const [waiting] = await router.handleIncoming({
      name: 'subscribe-conversation.get',
      data: { id: 'm_get_waiting', data: { conversation_id: 'waiting-id-1' } },
    });
    expect(waiting.data).toMatchObject({
      id: 'waiting-id-1',
      status: 'waiting_confirmation',
      runtime: {
        state: 'waiting_confirmation',
        can_send_message: false,
        has_task: true,
        task_status: 'waiting_confirmation',
        is_processing: true,
        pending_confirmations: 1,
        turn_id: 'assistant_user-msg-waiting',
      },
    });

    await router.handleIncoming({
      name: 'subscribe-confirmation.confirm',
      data: {
        id: 'm_confirm_waiting',
        data: {
          conversation_id: 'waiting-id-1',
          msg_id: 'permission-waiting',
          callId: 'call-waiting',
          data: 'once',
        },
      },
    });
    const [running] = await router.handleIncoming({
      name: 'subscribe-conversation.get',
      data: { id: 'm_get_running_after_confirm', data: { conversation_id: 'waiting-id-1' } },
    });
    expect(running.data).toMatchObject({
      id: 'waiting-id-1',
      status: 'running',
      runtime: {
        state: 'running',
        can_send_message: false,
        has_task: true,
        task_status: 'running',
        is_processing: true,
        pending_confirmations: 0,
        turn_id: 'assistant_user-msg-waiting',
      },
    });

    continueResolve();
    await sendPromise;

    const [finished] = await router.handleIncoming({
      name: 'subscribe-conversation.get',
      data: { id: 'm_get_finished_after_waiting', data: { conversation_id: 'waiting-id-1' } },
    });
    expect(finished.data).toMatchObject({
      id: 'waiting-id-1',
      status: 'finished',
      runtime: {
        state: 'idle',
        can_send_message: true,
        has_task: false,
        task_status: 'finished',
        is_processing: false,
        pending_confirmations: 0,
        turn_id: null,
      },
    });
  });
});
