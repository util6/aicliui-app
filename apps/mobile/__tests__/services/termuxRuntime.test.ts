import {
  hasRunCommandPermissionAsync,
  isTermuxInstalledAsync,
  openTermuxAppAsync,
} from '@aicliui/termux';
import { openTermuxIfAvailable, probeTermuxRuntime } from '@/src/services/termuxRuntime';

jest.mock('@aicliui/termux', () => ({
  hasRunCommandPermissionAsync: jest.fn(),
  isTermuxInstalledAsync: jest.fn(),
  openTermuxAppAsync: jest.fn(),
  runCommandAsync: jest.fn(),
}));

const mockIsTermuxInstalled = isTermuxInstalledAsync as jest.Mock;
const mockHasRunCommandPermission = hasRunCommandPermissionAsync as jest.Mock;
const mockOpenTermux = openTermuxAppAsync as jest.Mock;

describe('termuxRuntime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports installed Termux and granted RUN_COMMAND permission', async () => {
    mockIsTermuxInstalled.mockResolvedValueOnce(true);
    mockHasRunCommandPermission.mockResolvedValueOnce(true);

    await expect(probeTermuxRuntime()).resolves.toEqual({
      nativeModule: 'available',
      termuxInstalled: 'yes',
      runCommandPermission: 'yes',
    });
  });

  it('does not request permission state when Termux is missing', async () => {
    mockIsTermuxInstalled.mockResolvedValueOnce(false);

    await expect(probeTermuxRuntime()).resolves.toEqual({
      nativeModule: 'available',
      termuxInstalled: 'no',
      runCommandPermission: 'no',
    });
    expect(mockHasRunCommandPermission).not.toHaveBeenCalled();
  });

  it('falls back to unknown when native module calls fail', async () => {
    mockIsTermuxInstalled.mockRejectedValueOnce(new Error('native module unavailable'));

    await expect(probeTermuxRuntime()).resolves.toEqual({
      nativeModule: 'unavailable',
      termuxInstalled: 'unknown',
      runCommandPermission: 'unknown',
    });
  });

  it('opens Termux when the native call succeeds', async () => {
    mockOpenTermux.mockResolvedValueOnce(true);
    await expect(openTermuxIfAvailable()).resolves.toBe(true);
  });
});
