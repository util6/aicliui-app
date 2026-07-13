import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ConnectScreen from '@/app/connect';
import {
  prepareEmbeddedRuntime,
  probeEmbeddedRuntime,
  startEmbeddedRuntime,
} from '@/src/services/embeddedRuntime';
import { getRuntimeStatus } from '@/src/services/runtimeStatus';

const mockConnect = jest.fn();
const mockReplace = jest.fn();
const mockGetOrCreateLocalDaemonConfig = jest.fn();
let stateListener: ((state: string) => void) | null = null;

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: (...args: unknown[]) => mockReplace(...args) }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});

jest.mock('@/src/components/ui/ThemedText', () => {
  const { Text } = require('react-native');
  return { ThemedText: Text };
});

jest.mock('@/src/hooks/useThemeColor', () => ({
  useThemeColor: () => '#444444',
}));

jest.mock('@/src/context/ConnectionContext', () => ({
  useConnection: () => ({
    connect: (...args: unknown[]) => mockConnect(...args),
    connectionState: 'disconnected',
  }),
}));

jest.mock('@/src/services/localRuntime', () => ({
  LOCAL_DAEMON_PORT: '43117',
  getOrCreateLocalDaemonConfig: (...args: unknown[]) => mockGetOrCreateLocalDaemonConfig(...args),
}));

jest.mock('@/src/services/websocket', () => ({
  wsService: {
    state: 'disconnected',
    onStateChange: (listener: (state: string) => void) => {
      stateListener = listener;
      return () => {
        stateListener = null;
      };
    },
  },
}));

jest.mock('@/src/services/runtimeStatus', () => ({
  getRuntimeStatus: jest.fn(),
  getAgentDisplayName: (backend: string) => backend,
  getAgentStateLabelKey: () => 'connect.statusReady',
}));

jest.mock('@/src/services/embeddedRuntime', () => ({
  probeEmbeddedRuntime: jest.fn(),
  prepareEmbeddedRuntime: jest.fn(),
  startEmbeddedRuntime: jest.fn(),
}));

const mockProbeEmbeddedRuntime = probeEmbeddedRuntime as jest.Mock;
const mockPrepareEmbeddedRuntime = prepareEmbeddedRuntime as jest.Mock;
const mockStartEmbeddedRuntime = startEmbeddedRuntime as jest.Mock;
const mockGetRuntimeStatus = getRuntimeStatus as jest.Mock;

describe('ConnectScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stateListener = null;
    mockGetOrCreateLocalDaemonConfig.mockResolvedValue({
      host: '127.0.0.1',
      port: '43117',
      token: '',
      transport: 'aioncore',
    });
    mockProbeEmbeddedRuntime.mockResolvedValue({ state: 'stopped', supported: true, port: 43117 });
    mockPrepareEmbeddedRuntime.mockResolvedValue({ state: 'stopped', supported: true, port: 43117 });
    mockStartEmbeddedRuntime.mockResolvedValue({ state: 'starting', supported: true, port: 43117 });
    mockGetRuntimeStatus.mockResolvedValue({
      daemon: { version: '0.1.0', startedAt: 1000, pid: 42 },
      agents: [],
    });
    mockConnect.mockImplementation(async () => {
      setTimeout(() => stateListener?.('connected'), 0);
    });
  });

  it('prepares and starts the embedded runtime before opening chat', async () => {
    const screen = render(<ConnectScreen />);

    fireEvent.press(screen.getByText('connect.installRuntime'));

    await waitFor(() => {
      expect(mockPrepareEmbeddedRuntime).toHaveBeenCalledTimes(1);
      expect(mockStartEmbeddedRuntime).toHaveBeenCalledTimes(1);
      expect(mockConnect).toHaveBeenCalledWith('127.0.0.1', '43117', '', 'aioncore');
      expect(mockGetRuntimeStatus).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/(tabs)/chat');
    });
  });

  it('shows only the embedded runtime and daemon status rows', async () => {
    const screen = render(<ConnectScreen />);

    await waitFor(() => expect(mockProbeEmbeddedRuntime).toHaveBeenCalledTimes(1));
    expect(screen.getByText('connect.embeddedRuntime')).toBeTruthy();
    expect(screen.getByText('connect.daemon')).toBeTruthy();
    expect(screen.queryByText('connect.termux')).toBeNull();
    expect(screen.queryByText('connect.runCommandPermission')).toBeNull();
    expect(screen.queryByText('connect.configureTermux')).toBeNull();
  });

  it('does not try to connect when the packaged runtime is unavailable', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockPrepareEmbeddedRuntime.mockResolvedValueOnce({
      state: 'unavailable',
      supported: false,
      port: 43117,
      detail: 'Embedded AionCore binary is missing',
    });
    const screen = render(<ConnectScreen />);

    fireEvent.press(screen.getByText('connect.installRuntime'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('connect.installRuntime', 'connect.embeddedRuntimeUnavailable');
    });
    expect(mockStartEmbeddedRuntime).not.toHaveBeenCalled();
    expect(mockConnect).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
