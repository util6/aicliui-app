import { bridge } from '@/src/services/bridge';
import { getRuntimeStatus, getAgentDisplayName, getAgentStateLabelKey } from '@/src/services/runtimeStatus';

jest.mock('@/src/services/bridge', () => ({
  bridge: {
    request: jest.fn(),
  },
}));

const mockRequest = bridge.request as jest.Mock;

describe('runtimeStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requests daemon runtime status through the AionUi bridge protocol', async () => {
    const status = {
      daemon: { version: '0.1.0', startedAt: 1000, pid: 123 },
      bootstrap: { phase: 'daemon_start_requested', detail: 'Starting local daemon', updatedAt: 1234 },
      termux: { runCommandPermission: 'granted', allowExternalApps: 'unknown' },
      agents: [{ backend: 'opencode', state: 'ready', version: '1.2.3' }],
    };
    mockRequest.mockResolvedValueOnce(status);

    await expect(getRuntimeStatus(2500)).resolves.toBe(status);

    expect(mockRequest).toHaveBeenCalledWith('runtime.get-status', undefined, 2500);
  });

  it('maps known agent backends and states to display labels', () => {
    expect(getAgentDisplayName('opencode')).toBe('OpenCode');
    expect(getAgentDisplayName('gemini')).toBe('Gemini CLI');
    expect(getAgentDisplayName('codex')).toBe('Codex CLI');
    expect(getAgentDisplayName('custom')).toBe('custom');
    expect(getAgentStateLabelKey('ready')).toBe('connect.statusReady');
    expect(getAgentStateLabelKey('installing')).toBe('connect.statusInstalling');
    expect(getAgentStateLabelKey('error')).toBe('connect.statusError');
    expect(getAgentStateLabelKey('missing')).toBe('connect.statusMissing');
  });
});
