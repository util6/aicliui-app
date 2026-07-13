import {
  createEmbeddedRuntimeAdapter,
  type EmbeddedRuntimeNativeClient,
} from '@/src/services/embeddedRuntime';

describe('embedded runtime adapter', () => {
  let client: jest.Mocked<EmbeddedRuntimeNativeClient>;

  beforeEach(() => {
    client = {
      getStatusAsync: jest.fn(),
      prepareAsync: jest.fn(),
      startAsync: jest.fn(),
      stopAsync: jest.fn(),
      getLogPathAsync: jest.fn(),
    };
  });

  it('normalizes the native running status', async () => {
    client.getStatusAsync.mockResolvedValueOnce({
      state: 'running',
      supported: true,
      port: 43117,
      pid: 1234,
      version: 'v0.1.43',
      detail: 'AionCore is running',
    });

    await expect(createEmbeddedRuntimeAdapter(client).probe()).resolves.toEqual({
      state: 'running',
      supported: true,
      port: 43117,
      pid: 1234,
      version: 'v0.1.43',
      detail: 'AionCore is running',
    });
  });

  it('returns an unavailable status when the native module fails', async () => {
    client.getStatusAsync.mockRejectedValueOnce(new Error('native module missing'));

    await expect(createEmbeddedRuntimeAdapter(client).probe()).resolves.toEqual({
      state: 'unavailable',
      supported: false,
      port: 43117,
      detail: 'Embedded runtime is unavailable',
    });
  });

  it('delegates prepare, start, stop, and log-path operations', async () => {
    client.prepareAsync.mockResolvedValueOnce({ state: 'stopped', supported: true, port: 43117 });
    client.startAsync.mockResolvedValueOnce({ state: 'starting', supported: true, port: 43117 });
    client.stopAsync.mockResolvedValueOnce({ state: 'stopped', supported: true, port: 43117 });
    client.getLogPathAsync.mockResolvedValueOnce('/data/user/0/app.aicliui.mobile/files/runtime/logs/aioncore.log');
    const adapter = createEmbeddedRuntimeAdapter(client);

    await expect(adapter.prepare()).resolves.toMatchObject({ state: 'stopped' });
    await expect(adapter.start()).resolves.toMatchObject({ state: 'starting' });
    await expect(adapter.stop()).resolves.toMatchObject({ state: 'stopped' });
    await expect(adapter.getLogPath()).resolves.toContain('aioncore.log');
    expect(client.startAsync).toHaveBeenCalledWith(43117);
  });
});
