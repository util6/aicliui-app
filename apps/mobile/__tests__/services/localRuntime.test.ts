import * as SecureStore from 'expo-secure-store';
import { getOrCreateLocalDaemonConfig, LOCAL_DAEMON_HOST, LOCAL_DAEMON_PORT } from '@/src/services/localRuntime';

jest.mock('@/src/utils/uuid', () => ({
  uuid: () => 'generated-token',
}));

const mockedSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;

describe('localRuntime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reuses an existing local daemon token', async () => {
    mockedSecureStore.getItemAsync.mockResolvedValueOnce('existing-token');

    await expect(getOrCreateLocalDaemonConfig()).resolves.toEqual({
      host: LOCAL_DAEMON_HOST,
      port: LOCAL_DAEMON_PORT,
      token: 'existing-token',
    });
    expect(mockedSecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('creates and stores a local daemon token when missing', async () => {
    mockedSecureStore.getItemAsync.mockResolvedValueOnce(null);

    await expect(getOrCreateLocalDaemonConfig()).resolves.toEqual({
      host: LOCAL_DAEMON_HOST,
      port: LOCAL_DAEMON_PORT,
      token: 'generated-token',
    });
    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith('aicliui_local_daemon_token', 'generated-token');
  });
});
