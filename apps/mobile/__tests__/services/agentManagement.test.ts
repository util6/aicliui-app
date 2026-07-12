import { bridge } from '@/src/services/bridge';
import {
  createCustomAgent,
  deleteCustomAgent,
  listManagedAgents,
  parseAgentArgs,
  parseEnvironmentText,
  setAgentEnabled,
  testCustomAgent,
  updateCustomAgent,
} from '@/src/services/agentManagement';

jest.mock('@/src/services/bridge', () => ({
  bridge: { request: jest.fn() },
}));

const mockRequest = bridge.request as jest.Mock;

describe('agentManagement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequest.mockResolvedValue(undefined);
  });

  it('uses the AionCore-compatible bridge contracts for agent management', async () => {
    await listManagedAgents();
    await setAgentEnabled('custom-1', false);
    await createCustomAgent({ name: 'My CLI', command: 'my-cli', args: ['--acp'], env: [] });
    await updateCustomAgent('custom-1', { name: 'My CLI', command: 'my-cli', args: [], env: [] });
    await deleteCustomAgent('custom-1');
    await testCustomAgent({ name: 'My CLI', command: 'my-cli', args: ['--acp'], env: [] });

    expect(mockRequest).toHaveBeenNthCalledWith(1, 'agents.management.list');
    expect(mockRequest).toHaveBeenNthCalledWith(2, 'agents.set-enabled', {
      id: 'custom-1',
      enabled: false,
    });
    expect(mockRequest).toHaveBeenNthCalledWith(3, 'agents.custom.create', expect.objectContaining({
      name: 'My CLI',
      command: 'my-cli',
    }));
    expect(mockRequest).toHaveBeenNthCalledWith(4, 'agents.custom.update', expect.objectContaining({
      id: 'custom-1',
    }));
    expect(mockRequest).toHaveBeenNthCalledWith(5, 'agents.custom.delete', { id: 'custom-1' });
    expect(mockRequest).toHaveBeenNthCalledWith(6, 'agents.custom.test', {
      command: 'my-cli',
      acp_args: ['--acp'],
      env: {},
    });
  });

  it('parses quoted arguments and environment values without losing embedded equals signs', () => {
    expect(parseAgentArgs(`--mode acp --label "My Agent" 'two words'`)).toEqual([
      '--mode',
      'acp',
      '--label',
      'My Agent',
      'two words',
    ]);
    expect(parseEnvironmentText('API_URL=https://example.test?a=1\nEMPTY=\n# ignored\nINVALID')).toEqual([
      { name: 'API_URL', value: 'https://example.test?a=1' },
      { name: 'EMPTY', value: '' },
    ]);
  });
});
