import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { RuntimeStatusCard } from '@/src/components/settings/RuntimeStatusCard';
import { getRuntimeStatus } from '@/src/services/runtimeStatus';
import {
  getEmbeddedRuntimeLogPath,
  prepareEmbeddedRuntime,
  probeEmbeddedRuntime,
  startEmbeddedRuntime,
} from '@/src/services/embeddedRuntime';

const mockSetStringAsync = jest.fn();

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});

jest.mock('expo-clipboard', () => ({
  setStringAsync: (...args: unknown[]) => mockSetStringAsync(...args),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'settings.runtime': 'Runtime',
        'settings.refreshRuntime': 'Refresh',
        'settings.runtimeUnavailable': 'Runtime status unavailable',
        'settings.copyDaemonLogPath': 'Copy daemon log path',
        'settings.repairRuntime': 'Repair local runtime',
        'settings.updatedJustNow': 'Updated just now',
        'connect.installRuntime': 'Install Runtime',
        'connect.runtimeStartRequested': 'Runtime start requested',
        'connect.runtimeStartFailed': 'Runtime start failed',
        'connect.embeddedRuntime': 'Embedded runtime',
        'connect.embeddedRuntimeUnavailable': 'Embedded runtime unavailable',
        'common.retry': 'Retry',
        'common.copied': 'Copied',
        'common.error': 'Error',
        'common.loading': 'Loading',
        'connect.daemon': 'Daemon',
        'connect.bootstrap': 'Bootstrap',
        'connect.statusReady': 'Ready',
        'connect.statusMissing': 'Missing',
        'connect.statusInstalling': 'Installing',
        'connect.statusError': 'Error',
        'connect.statusUnknown': 'Not checked',
        'connect.runtimeStateRunning': 'Running',
        'connect.runtimeStateStopped': 'Stopped',
        'connect.runtimeStatePreparing': 'Preparing',
        'connect.runtimeStateStarting': 'Starting',
        'connect.runtimeStateUnavailable': 'Unavailable',
        'connect.runtimeStateError': 'Error',
      };
      return labels[key] ?? key;
    },
  }),
}));

jest.mock('@/src/services/runtimeStatus', () => ({
  getRuntimeStatus: jest.fn(),
  getAgentDisplayName: (backend: string) =>
    backend === 'codex' ? 'Codex CLI' : backend === 'opencode' ? 'OpenCode' : backend,
  getAgentStateLabelKey: (state: string) => {
    if (state === 'ready') return 'connect.statusReady';
    if (state === 'installing') return 'connect.statusInstalling';
    if (state === 'error') return 'connect.statusError';
    return 'connect.statusMissing';
  },
}));

jest.mock('@/src/services/embeddedRuntime', () => ({
  probeEmbeddedRuntime: jest.fn(),
  prepareEmbeddedRuntime: jest.fn(),
  startEmbeddedRuntime: jest.fn(),
  getEmbeddedRuntimeLogPath: jest.fn(),
}));

const mockGetRuntimeStatus = getRuntimeStatus as jest.Mock;
const mockProbeEmbeddedRuntime = probeEmbeddedRuntime as jest.Mock;
const mockPrepareEmbeddedRuntime = prepareEmbeddedRuntime as jest.Mock;
const mockStartEmbeddedRuntime = startEmbeddedRuntime as jest.Mock;
const mockGetEmbeddedRuntimeLogPath = getEmbeddedRuntimeLogPath as jest.Mock;

describe('RuntimeStatusCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetStringAsync.mockResolvedValue(undefined);
    mockProbeEmbeddedRuntime.mockResolvedValue({ state: 'running', supported: true, port: 43117, pid: 777 });
    mockPrepareEmbeddedRuntime.mockResolvedValue({ state: 'stopped', supported: true, port: 43117 });
    mockStartEmbeddedRuntime.mockResolvedValue({ state: 'starting', supported: true, port: 43117 });
    mockGetEmbeddedRuntimeLogPath.mockResolvedValue('/data/user/0/app.aicliui.mobile/files/runtime/logs/aioncore.log');
  });

  it('renders embedded runtime, daemon, and CLI agent status without Termux controls', async () => {
    mockGetRuntimeStatus.mockResolvedValueOnce({
      daemon: { version: '0.1.0', startedAt: 1000, pid: 123 },
      bootstrap: { phase: 'aioncore_start_requested', detail: 'Local runtime', updatedAt: Date.now() },
      agents: [
        { backend: 'codex', state: 'ready', version: '0.2.0' },
        { backend: 'opencode', state: 'missing', detail: 'opencode command not found' },
      ],
    });

    const screen = render(<RuntimeStatusCard />);

    await waitFor(() => expect(screen.getByText('Embedded runtime')).toBeTruthy());
    expect(screen.getByText('Running · pid 777')).toBeTruthy();
    expect(screen.getByText('Daemon')).toBeTruthy();
    expect(screen.getByText('0.1.0 · pid 123')).toBeTruthy();
    expect(screen.getByText('Bootstrap')).toBeTruthy();
    expect(screen.getByText('aioncore_start_requested · Local runtime · Updated just now')).toBeTruthy();
    expect(screen.getByText('Codex CLI')).toBeTruthy();
    expect(screen.getByText('Ready · 0.2.0')).toBeTruthy();
    expect(screen.queryByText('Termux')).toBeNull();
    expect(screen.queryByText('RUN_COMMAND Permission')).toBeNull();
    expect(screen.queryByTestId('configure-agent-codex')).toBeNull();
  });

  it('copies the app-private embedded runtime log path for diagnostics', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockGetRuntimeStatus.mockResolvedValueOnce({
      daemon: { version: '0.1.0', startedAt: 1000, pid: 123 },
      agents: [],
    });

    const screen = render(<RuntimeStatusCard />);

    await waitFor(() => expect(screen.getByText('Daemon')).toBeTruthy());
    fireEvent.press(screen.getByTestId('copy-daemon-log-path'));

    await waitFor(() => {
      expect(mockSetStringAsync).toHaveBeenCalledWith(
        '/data/user/0/app.aicliui.mobile/files/runtime/logs/aioncore.log',
      );
    });
    expect(alertSpy).toHaveBeenCalledWith(
      'Copied',
      '/data/user/0/app.aicliui.mobile/files/runtime/logs/aioncore.log',
    );
    alertSpy.mockRestore();
  });

  it('repairs a missing agent by preparing and starting the embedded runtime', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockGetRuntimeStatus.mockResolvedValueOnce({
      daemon: { version: '0.1.0', startedAt: 1000, pid: 123 },
      agents: [{ backend: 'opencode', state: 'missing', detail: 'opencode command not found' }],
    });

    const screen = render(<RuntimeStatusCard />);

    await waitFor(() => expect(screen.getByText('Repair local runtime')).toBeTruthy());
    fireEvent.press(screen.getByTestId('repair-local-runtime'));

    await waitFor(() => expect(mockPrepareEmbeddedRuntime).toHaveBeenCalledTimes(1));
    expect(mockStartEmbeddedRuntime).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith('Install Runtime', 'Runtime start requested');
    alertSpy.mockRestore();
  });

  it('reports an embedded runtime start failure without opening Android settings', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockStartEmbeddedRuntime.mockResolvedValueOnce({
      state: 'error',
      supported: true,
      port: 43117,
      detail: 'AionCore exited',
    });
    mockGetRuntimeStatus.mockResolvedValueOnce({
      daemon: { version: '0.1.0', startedAt: 1000, pid: 123 },
      agents: [{ backend: 'codex', state: 'missing', detail: 'codex command not found' }],
    });

    const screen = render(<RuntimeStatusCard />);

    await waitFor(() => expect(screen.getByText('Repair local runtime')).toBeTruthy());
    fireEvent.press(screen.getByTestId('repair-local-runtime'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Error', 'Runtime start failed'));
    alertSpy.mockRestore();
  });

  it('shows an error state and retries the daemon status while retaining native runtime status', async () => {
    mockGetRuntimeStatus
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        daemon: { version: '0.1.0', startedAt: 1000 },
        agents: [],
      });

    const screen = render(<RuntimeStatusCard />);

    await waitFor(() => expect(screen.getByText('Runtime status unavailable')).toBeTruthy());
    expect(screen.getByText('Running · pid 777')).toBeTruthy();

    fireEvent.press(screen.getByText('Refresh'));

    await waitFor(() => expect(screen.getByText('0.1.0')).toBeTruthy());
    expect(mockGetRuntimeStatus).toHaveBeenCalledTimes(2);
    expect(mockProbeEmbeddedRuntime).toHaveBeenCalledTimes(2);
  });
});
