import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ConnectScreen from '@/app/connect';
import { installOrStartLocalRuntime } from '@/src/services/termuxRuntime';
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

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(),
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

jest.mock('@/src/services/termuxRuntime', () => ({
  TERMUX_DOWNLOAD_URL: 'https://example.test/termux',
  getTermuxExternalAppsSetupCommand: () => 'setup-termux',
  installOrStartLocalRuntime: jest.fn(),
  openTermuxIfAvailable: jest.fn(),
  probeTermuxRuntime: jest.fn().mockResolvedValue({
    nativeModule: 'available',
    termuxInstalled: 'yes',
    runCommandPermission: 'yes',
  }),
}));

const mockInstallOrStartLocalRuntime = installOrStartLocalRuntime as jest.Mock;
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
    mockInstallOrStartLocalRuntime.mockResolvedValue({
      status: 'started',
      config: { host: '127.0.0.1', port: '43117', token: '', transport: 'aioncore' },
    });
    mockGetRuntimeStatus.mockResolvedValue({
      daemon: { version: '0.1.0', startedAt: 1000, pid: 42 },
      termux: { runCommandPermission: 'granted', allowExternalApps: 'enabled' },
      agents: [],
    });
    mockConnect.mockImplementation(async () => {
      setTimeout(() => stateListener?.('connected'), 0);
    });
  });

  it('connects and opens chat when the bootstrapped daemon becomes ready', async () => {
    const screen = render(<ConnectScreen />);

    fireEvent.press(screen.getByText('connect.installRuntime'));

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledWith('127.0.0.1', '43117', '', 'aioncore');
      expect(mockGetRuntimeStatus).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/(tabs)/chat');
    });
  });
});
