import { getOrCreateLocalDaemonConfig, LOCAL_DAEMON_HOST, LOCAL_DAEMON_PORT } from '@/src/services/localRuntime';

describe('localRuntime', () => {
  it('returns the fixed local AionCore connection', async () => {
    await expect(getOrCreateLocalDaemonConfig()).resolves.toEqual({
      host: LOCAL_DAEMON_HOST,
      port: LOCAL_DAEMON_PORT,
      token: '',
      transport: 'aioncore',
    });
  });
});
