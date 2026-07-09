import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { RuntimeStatusCard } from '@/src/components/settings/RuntimeStatusCard';
import { getRuntimeStatus } from '@/src/services/runtimeStatus';

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
    t: (key: string) => {
      const labels: Record<string, string> = {
        'settings.runtime': 'Runtime',
        'settings.refreshRuntime': 'Refresh',
        'settings.runtimeUnavailable': 'Runtime status unavailable',
        'settings.termuxExternalApps': 'Allow external apps',
        'settings.copyDaemonLogPath': 'Copy daemon log path',
        'settings.updatedJustNow': 'Updated just now',
        'common.retry': 'Retry',
        'common.copied': 'Copied',
        'common.error': 'Error',
        'connect.daemon': 'Daemon',
        'connect.bootstrap': 'Bootstrap',
        'connect.runCommandPermission': 'RUN_COMMAND Permission',
        'connect.statusReady': 'Ready',
        'connect.statusMissing': 'Missing',
        'connect.statusInstalling': 'Installing',
        'connect.statusError': 'Error',
        'connect.statusUnknown': 'Not checked',
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

const mockGetRuntimeStatus = getRuntimeStatus as jest.Mock;

describe('RuntimeStatusCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetStringAsync.mockResolvedValue(undefined);
  });

  it('loads and renders daemon, Termux, and CLI agent status', async () => {
    mockGetRuntimeStatus.mockResolvedValueOnce({
      daemon: { version: '0.1.0', startedAt: 1000, pid: 123 },
      bootstrap: { phase: 'daemon_start_requested', detail: 'Termux command sent', updatedAt: Date.now() },
      termux: { runCommandPermission: 'granted', allowExternalApps: 'enabled' },
      agents: [
        { backend: 'codex', state: 'ready', version: '0.2.0' },
        { backend: 'opencode', state: 'missing', detail: 'opencode command not found' },
      ],
    });

    const screen = render(<RuntimeStatusCard />);

    await waitFor(() => expect(screen.getByText('Daemon')).toBeTruthy());
    expect(screen.getByText('0.1.0 · pid 123')).toBeTruthy();
    expect(screen.getByText('RUN_COMMAND Permission')).toBeTruthy();
    expect(screen.getByText('Allow external apps')).toBeTruthy();
    expect(screen.getByText('Bootstrap')).toBeTruthy();
    expect(screen.getByText('daemon_start_requested · Termux command sent · Updated just now')).toBeTruthy();
    expect(screen.getByText('Codex CLI')).toBeTruthy();
    expect(screen.getByText('Ready · 0.2.0')).toBeTruthy();
    expect(screen.getByText('OpenCode')).toBeTruthy();
    expect(screen.getByText('Missing · opencode command not found')).toBeTruthy();
  });

  it('copies the local daemon log path for diagnostics', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockGetRuntimeStatus.mockResolvedValueOnce({
      daemon: { version: '0.1.0', startedAt: 1000, pid: 123 },
      termux: { runCommandPermission: 'granted', allowExternalApps: 'enabled' },
      agents: [],
    });

    const screen = render(<RuntimeStatusCard />);

    await waitFor(() => expect(screen.getByText('Daemon')).toBeTruthy());
    fireEvent.press(screen.getByTestId('copy-daemon-log-path'));

    await waitFor(() => {
      expect(mockSetStringAsync).toHaveBeenCalledWith('~/.aicliui/logs/daemon.log');
    });
    expect(alertSpy).toHaveBeenCalledWith('Copied', '~/.aicliui/logs/daemon.log');
    alertSpy.mockRestore();
  });

  it('shows an error state and retries through the refresh action', async () => {
    mockGetRuntimeStatus
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        daemon: { version: '0.1.0', startedAt: 1000 },
        termux: { runCommandPermission: 'unknown', allowExternalApps: 'unknown' },
        agents: [],
      });

    const screen = render(<RuntimeStatusCard />);

    await waitFor(() => expect(screen.getByText('Runtime status unavailable')).toBeTruthy());

    fireEvent.press(screen.getByText('Refresh'));

    await waitFor(() => expect(screen.getByText('0.1.0')).toBeTruthy());
    expect(mockGetRuntimeStatus).toHaveBeenCalledTimes(2);
  });
});
