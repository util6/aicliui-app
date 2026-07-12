jest.mock('@/src/services/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

import { requestAionCore } from '@/src/services/aionCoreClient';
import { api } from '@/src/services/api';
import fs from 'node:fs';
import path from 'node:path';

const mockGet = api.get as jest.Mock;
const mockPost = api.post as jest.Mock;
const mockPut = api.put as jest.Mock;
const mockPatch = api.patch as jest.Mock;
const mockDelete = api.delete as jest.Mock;

describe('AionCore client adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps paginated REST conversations to the mobile conversation shape', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          items: [
            {
              id: 'conv-1',
              name: 'Test',
              type: 'acp',
              status: 'finished',
              pinned: true,
              pinned_at: 15,
              created_at: 10,
              modified_at: 20,
              extra: { backend: 'opencode' },
            },
          ],
          total: 1,
          has_more: false,
        },
      },
    });

    await expect(
      requestAionCore('database.get-user-conversations', { page: 0, pageSize: 100 }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'conv-1',
        createTime: 10,
        modifyTime: 20,
        pinned: true,
        pinnedAt: 15,
        model: { id: '', useModel: '' },
      }),
    ]);
    expect(mockGet).toHaveBeenCalledWith('/api/conversations', {
      params: { limit: 100 },
    });
  });

  it('unwraps paginated message items', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        success: true,
        data: { items: [{ id: 'msg-1', created_at: 30 }] },
      },
    });

    await expect(
      requestAionCore('database.get-conversation-messages', { conversation_id: 'conv-1' }),
    ).resolves.toEqual([{ id: 'msg-1', created_at: 30, createdAt: 30 }]);
    expect(mockGet).toHaveBeenCalledWith('/api/conversations/conv-1/messages', {
      params: { limit: 500 },
    });
  });

  it('maps mobile send requests to the AionCore message endpoint', async () => {
    mockPost.mockResolvedValueOnce({
      data: { success: true, data: { msg_id: 'msg-1', turn_id: 'turn-1' } },
    });

    await expect(
      requestAionCore('chat.send.message', {
        conversation_id: 'conv-1',
        input: 'hello',
        files: ['/tmp/a.txt'],
      }),
    ).resolves.toEqual({ msg_id: 'msg-1', turn_id: 'turn-1' });
    expect(mockPost).toHaveBeenCalledWith('/api/conversations/conv-1/messages', {
      content: 'hello',
      files: ['/tmp/a.txt'],
    });
  });

  it('maps config changes to the current AionCore PUT route', async () => {
    mockPut.mockResolvedValueOnce({
      data: { success: true, data: { confirmation: 'observed' } },
    });

    await requestAionCore('conversation.set-config-option', {
      conversation_id: 'conv-1',
      option_id: 'mode',
      value: 'build',
    });

    expect(mockPut).toHaveBeenCalledWith(
      '/api/conversations/conv-1/config-options/mode',
      { value: 'build' },
    );
  });

  it('builds a unified file diff from AionCore baseline and current content', async () => {
    mockPost
      .mockResolvedValueOnce({ data: { success: true, data: 'before\n' } })
      .mockResolvedValueOnce({ data: { success: true, data: 'after\n' } });

    await expect(
      requestAionCore('fileSnapshot.diff', {
        workspace: '/tmp/project',
        relativePath: 'src/file.ts',
        source: 'unstaged',
      }),
    ).resolves.toEqual({
      relativePath: 'src/file.ts',
      source: 'unstaged',
      diff: expect.stringContaining('-before'),
    });
    expect(mockPost).toHaveBeenNthCalledWith(1, '/api/fs/snapshot/baseline', {
      workspace: '/tmp/project',
      file_path: 'src/file.ts',
    });
    expect(mockPost).toHaveBeenNthCalledWith(2, '/api/fs/read', {
      path: '/tmp/project/src/file.ts',
      workspace: '/tmp/project',
    });
  });

  it('maps the AionCore agent catalog to selectable mobile agents', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        success: true,
        data: [
          { id: '1', backend: 'opencode', name: 'OpenCode', installed: true, status: 'online' },
          { id: '2', backend: 'gemini', name: 'Gemini CLI', installed: false, status: 'missing' },
          {
            id: 'custom-1',
            name: 'My CLI',
            agent_type: 'acp',
            agent_source: 'custom',
            enabled: true,
            installed: true,
            status: 'online',
          },
          { id: '3', backend: 'other', name: 'Other', installed: true, status: 'online' },
        ],
      },
    });

    await expect(requestAionCore('acp.get-available-agents')).resolves.toEqual({
      success: true,
      data: [
        expect.objectContaining({ backend: 'opencode', name: 'OpenCode', state: 'ready' }),
        expect.objectContaining({ backend: 'gemini', name: 'Gemini CLI', state: 'missing' }),
        expect.objectContaining({
          id: 'custom-1',
          backend: 'custom-1',
          name: 'My CLI',
          source: 'custom',
          state: 'ready',
        }),
      ],
    });
  });

  it('maps the full AionCore custom agent management lifecycle', async () => {
    mockGet.mockResolvedValueOnce({ data: { success: true, data: [{ id: 'custom-1' }] } });
    mockPost
      .mockResolvedValueOnce({ data: { success: true, data: { id: 'custom-1' } } })
      .mockResolvedValueOnce({ data: { success: true, data: { step: 'success' } } })
      .mockResolvedValueOnce({ data: { success: true, data: { id: 'custom-1' } } });
    mockPut.mockResolvedValueOnce({ data: { success: true, data: { id: 'custom-1' } } });
    mockPatch.mockResolvedValueOnce({ data: { success: true, data: { id: 'custom-1', enabled: false } } });
    mockDelete.mockResolvedValueOnce({ data: { success: true, data: { deleted: true } } });

    await requestAionCore('agents.management.list');
    await requestAionCore('agents.health-check', { id: 'custom-1' });
    await requestAionCore('agents.custom.test', { command: 'my-cli', acp_args: [], env: {} });
    await requestAionCore('agents.custom.create', { name: 'My CLI', command: 'my-cli', args: [], env: [] });
    await requestAionCore('agents.custom.update', { id: 'custom-1', name: 'My CLI', command: 'my-cli' });
    await requestAionCore('agents.set-enabled', { id: 'custom-1', enabled: false });
    await requestAionCore('agents.custom.delete', { id: 'custom-1' });

    expect(mockGet).toHaveBeenCalledWith('/api/agents/management', undefined);
    expect(mockPost).toHaveBeenNthCalledWith(1, '/api/agents/custom-1/health-check', undefined);
    expect(mockPost).toHaveBeenNthCalledWith(2, '/api/agents/custom/try-connect', {
      command: 'my-cli',
      acp_args: [],
      env: {},
    });
    expect(mockPut).toHaveBeenCalledWith('/api/agents/custom/custom-1', expect.objectContaining({
      name: 'My CLI',
      command: 'my-cli',
    }));
    expect(mockPatch).toHaveBeenCalledWith('/api/agents/custom-1/enabled', { enabled: false });
    expect(mockDelete).toHaveBeenCalledWith('/api/agents/custom/custom-1');
  });

  it('uses the recursive file tree for conversation workspace browsing and search', async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        success: true,
        data: [
          {
            name: 'project',
            full_path: '/workspace/project',
            relative_path: '',
            is_dir: true,
            is_file: false,
            children: [
              {
                name: 'src',
                full_path: '/workspace/project/src',
                relative_path: 'src',
                is_dir: true,
                is_file: false,
                children: [
                  {
                    name: 'App.tsx',
                    full_path: '/workspace/project/src/App.tsx',
                    relative_path: 'src/App.tsx',
                    is_dir: false,
                    is_file: true,
                  },
                ],
              },
              {
                name: 'README.md',
                full_path: '/workspace/project/README.md',
                relative_path: 'README.md',
                is_dir: false,
                is_file: true,
              },
            ],
          },
        ],
      },
    });

    await expect(
      requestAionCore('conversation.get-workspace', {
        conversation_id: 'conv-1',
        workspace: '/workspace/project',
        path: '/workspace/project',
        search: 'app',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        name: 'project',
        children: [
          expect.objectContaining({
            name: 'src',
            children: [expect.objectContaining({ name: 'App.tsx', isFile: true })],
          }),
        ],
      }),
    ]);
    expect(mockPost).toHaveBeenCalledWith('/api/fs/dir', {
      dir: '/workspace/project',
      root: '/workspace/project',
    });
  });

  it('reads camelCase model values from the management agent response', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        success: true,
        data: [
          {
            backend: 'opencode',
            config_options: {
              config_options: [
                {
                  id: 'model',
                  category: 'model',
                  currentValue: 'provider/model-a',
                  options: [{ value: 'provider/model-a', name: 'Model A' }],
                },
              ],
            },
          },
        ],
      },
    });

    await expect(
      requestAionCore('acp.probe-model-info', { backend: 'opencode' }),
    ).resolves.toEqual({
      success: true,
      data: {
        modelInfo: expect.objectContaining({
          currentModelId: 'provider/model-a',
          currentModelLabel: 'Model A',
        }),
      },
    });
  });

  it('maps every bridge request used by the mobile application', () => {
    const mobileRoot = path.resolve(__dirname, '../..');
    const applicationRequests = collectBridgeRequestNames([
      path.join(mobileRoot, 'app'),
      path.join(mobileRoot, 'src'),
    ]);
    const adapterSource = fs.readFileSync(
      path.join(mobileRoot, 'src/services/aionCoreClient.ts'),
      'utf8',
    );
    const mappedRequests = new Set(
      [...adapterSource.matchAll(/case '([^']+)'/g)].map((match) => match[1]),
    );

    expect([...applicationRequests].filter((name) => !mappedRequests.has(name))).toEqual([]);
  });
});

function collectBridgeRequestNames(roots: string[]): Set<string> {
  const requestNames = new Set<string>();
  const requestPattern = /bridge\s*\.\s*request(?:<[^;]*?>)?\s*\(\s*['"]([^'"]+)['"]/gs;

  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (/\.tsx?$/.test(entry.name)) {
        const source = fs.readFileSync(entryPath, 'utf8');
        for (const match of source.matchAll(requestPattern)) {
          requestNames.add(match[1]);
        }
      }
    }
  };

  roots.forEach(visit);
  return requestNames;
}
