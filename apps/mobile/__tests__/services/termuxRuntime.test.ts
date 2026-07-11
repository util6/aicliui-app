import {
  hasRunCommandPermissionAsync,
  isTermuxInstalledAsync,
  openTermuxAppAsync,
  requestRunCommandPermissionAsync,
  runCommandAsync,
} from '@aicliui/termux';
import { spawnSync } from 'node:child_process';
import { TERMUX_DAEMON_SOURCE } from '@/src/services/termuxDaemonSource';
import * as localRuntime from '@/src/services/localRuntime';
import {
  buildTermuxBootstrapScript,
  getAgentLoginCommand,
  installOrStartLocalRuntime,
  openTermuxIfAvailable,
  probeTermuxRuntime,
} from '@/src/services/termuxRuntime';

jest.mock('@aicliui/termux', () => ({
  hasRunCommandPermissionAsync: jest.fn(),
  isTermuxInstalledAsync: jest.fn(),
  openTermuxAppAsync: jest.fn(),
  requestRunCommandPermissionAsync: jest.fn(),
  runCommandAsync: jest.fn(),
}));

const mockIsTermuxInstalled = isTermuxInstalledAsync as jest.Mock;
const mockHasRunCommandPermission = hasRunCommandPermissionAsync as jest.Mock;
const mockOpenTermux = openTermuxAppAsync as jest.Mock;
const mockRequestRunCommandPermission = requestRunCommandPermissionAsync as jest.Mock;
const mockRunCommand = runCommandAsync as jest.Mock;

describe('termuxRuntime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestRunCommandPermission.mockResolvedValue(false);
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

  it.each([
    ['opencode', 'opencode auth login'],
    ['gemini', 'exec gemini'],
    ['codex', 'codex login'],
  ] as const)('builds the %s login command inside the app Debian runtime', (backend, expectedCommand) => {
    const command = getAgentLoginCommand(backend);

    expect(command).toContain('proot-distro login aicliui --shared-tmp');
    expect(command).toContain('--bind "$HOME/.aicliui:/root/.aicliui"');
    expect(command).toContain('cd /root/.aicliui/workspaces/default');
    expect(command).toContain(expectedCommand);
  });

  it('builds the Debian bootstrap and daemon launch chain', () => {
    const script = buildTermuxBootstrapScript({
      host: '127.0.0.1',
      port: '43117',
      token: "tok'en",
    });

    expect(script).toContain('mkdir -p "$AICLIUI_HOME/bin" "$AICLIUI_HOME/daemon"');
    expect(script).toContain('pkg install -y proot-distro');
    expect(script).toContain('proot-distro install debian:bookworm --name aicliui');
    expect(script).toContain('https://deb.nodesource.com/setup_22.x');
    expect(script).toContain("printf %s 'tok'\\''en' > \"$AICLIUI_HOME/daemon/token\"");
    expect(script).toContain('npm install --omit=dev --prefix "$AICLIUI_HOME/daemon"');
    expect(script).toContain('npm install -g opencode-ai@latest');
    expect(script).toContain('npm install -g @google/gemini-cli@latest');
    expect(script).toContain('npm install -g @openai/codex@latest');
    expect(script).toContain(TERMUX_DAEMON_SOURCE);
    expect(script).toContain('exec node ./aicliui-daemon.mjs');
    expect(script).toContain('exec proot-distro login aicliui --shared-tmp');
    expect(script).toContain('nohup "$AICLIUI_HOME/bin/start-daemon.sh"');
  });

  it('generates a syntactically valid Termux bootstrap shell script', () => {
    const script = buildTermuxBootstrapScript({
      host: '127.0.0.1',
      port: '43117',
      token: 'runtime-token',
    });
    const result = spawnSync('/bin/bash', ['-n'], {
      input: script,
      encoding: 'utf8',
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('embeds a syntactically valid ESM daemon script', () => {
    const script = buildTermuxBootstrapScript({
      host: '127.0.0.1',
      port: '43117',
      token: 'runtime-token',
    });
    const match = script.match(/AICLIUI_DAEMON_SOURCE'\n([\s\S]*?)\nAICLIUI_DAEMON_SOURCE/);
    expect(match?.[1]).toBe(TERMUX_DAEMON_SOURCE);

    const result = spawnSync(process.execPath, ['--input-type=module', '--check', '-'], {
      input: match?.[1] ?? '',
      encoding: 'utf8',
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('starts the local runtime through Termux RUN_COMMAND when prerequisites are ready', async () => {
    jest.spyOn(localRuntime, 'getOrCreateLocalDaemonConfig').mockResolvedValueOnce({
      host: '127.0.0.1',
      port: '43117',
      token: 'runtime-token',
    });
    mockIsTermuxInstalled.mockResolvedValueOnce(true);
    mockHasRunCommandPermission.mockResolvedValueOnce(true);
    mockRunCommand.mockResolvedValueOnce(true);

    await expect(installOrStartLocalRuntime()).resolves.toEqual({
      status: 'started',
      config: { host: '127.0.0.1', port: '43117', token: 'runtime-token' },
    });
    expect(mockRunCommand).toHaveBeenCalledWith({
      commandPath: '$PREFIX/bin/bash',
      args: ['-s'],
      stdin: expect.stringContaining('AICLIUI_HOME'),
      workdir: '~',
      background: true,
      label: 'AICLIUI runtime bootstrap',
    });
  });

  it('requests RUN_COMMAND permission and does not start when the user denies it', async () => {
    mockIsTermuxInstalled.mockResolvedValueOnce(true);
    mockHasRunCommandPermission.mockResolvedValueOnce(false);

    await expect(installOrStartLocalRuntime()).resolves.toEqual({ status: 'permission_missing' });
    expect(mockRequestRunCommandPermission).toHaveBeenCalledTimes(1);
    expect(mockRunCommand).not.toHaveBeenCalled();
  });

  it('continues runtime installation after RUN_COMMAND permission is granted', async () => {
    jest.spyOn(localRuntime, 'getOrCreateLocalDaemonConfig').mockResolvedValueOnce({
      host: '127.0.0.1',
      port: '43117',
      token: 'runtime-token',
    });
    mockIsTermuxInstalled.mockResolvedValueOnce(true);
    mockHasRunCommandPermission.mockResolvedValueOnce(false);
    mockRequestRunCommandPermission.mockResolvedValueOnce(true);
    mockRunCommand.mockResolvedValueOnce(true);

    await expect(installOrStartLocalRuntime()).resolves.toEqual({
      status: 'started',
      config: { host: '127.0.0.1', port: '43117', token: 'runtime-token' },
    });
    expect(mockRunCommand).toHaveBeenCalledTimes(1);
  });

  it('reports a start failure when Termux rejects the RUN_COMMAND request', async () => {
    jest.spyOn(localRuntime, 'getOrCreateLocalDaemonConfig').mockResolvedValueOnce({
      host: '127.0.0.1',
      port: '43117',
      token: 'runtime-token',
    });
    mockIsTermuxInstalled.mockResolvedValueOnce(true);
    mockHasRunCommandPermission.mockResolvedValueOnce(true);
    mockRunCommand.mockResolvedValueOnce(false);

    await expect(installOrStartLocalRuntime()).resolves.toEqual({ status: 'start_failed' });
  });
});
