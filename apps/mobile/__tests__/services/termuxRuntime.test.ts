import {
  hasRunCommandPermissionAsync,
  isTermuxInstalledAsync,
  openTermuxAppAsync,
  runCommandAsync,
} from '@aicliui/termux';
import { spawnSync } from 'node:child_process';
import { TERMUX_DAEMON_SOURCE } from '@/src/services/termuxDaemonSource';
import * as localRuntime from '@/src/services/localRuntime';
import {
  buildTermuxBootstrapScript,
  installOrStartLocalRuntime,
  openTermuxIfAvailable,
  probeTermuxRuntime,
} from '@/src/services/termuxRuntime';

jest.mock('@aicliui/termux', () => ({
  hasRunCommandPermissionAsync: jest.fn(),
  isTermuxInstalledAsync: jest.fn(),
  openTermuxAppAsync: jest.fn(),
  runCommandAsync: jest.fn(),
}));

const mockIsTermuxInstalled = isTermuxInstalledAsync as jest.Mock;
const mockHasRunCommandPermission = hasRunCommandPermissionAsync as jest.Mock;
const mockOpenTermux = openTermuxAppAsync as jest.Mock;
const mockRunCommand = runCommandAsync as jest.Mock;

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

  it('builds a bootstrap script that prepares daemon directories and start command', () => {
    const script = buildTermuxBootstrapScript({
      host: '127.0.0.1',
      port: '43117',
      token: "tok'en",
    });

    expect(script).toContain('mkdir -p "$AICLIUI_HOME/bin" "$AICLIUI_HOME/daemon"');
    expect(script).toContain('export AICLIUI_BOOTSTRAP_LOG="$AICLIUI_HOME/logs/bootstrap.log"');
    expect(script).toContain('export AICLIUI_BOOTSTRAP_STATUS="$AICLIUI_HOME/daemon/bootstrap.status"');
    expect(script).toContain('write_bootstrap_status preparing "Preparing AICLIUI Termux runtime"');
    expect(script).toContain('write_bootstrap_status installing_daemon_deps "Installing daemon npm dependencies"');
    expect(script).toContain('write_bootstrap_status daemon_start_requested "Starting local daemon"');
    expect(script).toContain("printf %s 'tok'\\''en' > \"$AICLIUI_HOME/daemon/token\"");
    expect(script).toContain('pkg install -y nodejs');
    expect(script).toContain('npm install --omit=dev --prefix "$AICLIUI_HOME/daemon"');
    expect(script).toContain('npm install -g opencode-ai@latest');
    expect(script).toContain('npm install -g @google/gemini-cli@latest');
    expect(script).toContain("import { WebSocketServer } from 'ws';");
    expect(script).toContain("import { spawn } from 'node:child_process';");
    expect(script).toContain("import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';");
    expect(script).toContain("const storePath = process.env.AICLIUI_STORE_PATH || dataRoot + '/daemon/store.json';");
    expect(script).toContain("const bootstrapStatusPath = process.env.AICLIUI_BOOTSTRAP_STATUS || dataRoot + '/daemon/bootstrap.status';");
    expect(script).toContain('const storeReady = loadStore();');
    expect(script).toContain('bootstrap: await readBootstrapStatus()');
    expect(script).toContain('await storeReady;');
    expect(script).toContain('await rename(tmpPath, storePath);');
    expect(script).toContain("if (key === 'conversation.get-workspace') return await getWorkspaceTree(params);");
    expect(script).toContain("if (key === 'get-file-by-dir') return await getFileTreeByDir(params);");
    expect(script).toContain("if (key === 'read-file') return await readTextFile(requiredString(params.path));");
    expect(script).toContain("if (key === 'get-image-base64') return await readImageBase64(requiredString(params.path));");
    expect(script).toContain("throw new Error('Path is outside the workspace: ' + path);");
    expect(script).toContain("return 'data:' + imageMimeType(filePath) + ';base64,' + buffer.toString('base64');");
    expect(script).toContain("opencode', ['serve', '--hostname', '127.0.0.1', '--port'");
    expect(script).toContain("buildGeminiArgs({ input, model, approvalMode }).slice(1)");
    expect(script).toContain("'--output-format'");
    expect(script).toContain("'stream-json'");
    expect(script).toContain('parseGeminiStreamJsonLine');
    expect(script).toContain('server listening on');
    expect(script).toContain("'/api/session'");
    expect(script).toContain("'/api/session/' + encodeURIComponent(sessionId) + '/prompt'");
    expect(script).toContain("'/api/session/' + encodeURIComponent(sessionId) + '/wait'");
    expect(script).toContain("'/api/session/' + encodeURIComponent(sessionId) + '/context'");
    expect(script).toContain("if (key === 'chat.send.message') return await sendMessage(params, emit);");
    expect(script).toContain('exec node ./aicliui-daemon.mjs');
    expect(script).toContain('export AICLIUI_DAEMON_PID_FILE="$AICLIUI_HOME/daemon/daemon.pid"');
    expect(script).toContain('if [ -s "$AICLIUI_DAEMON_PID_FILE" ]; then');
    expect(script).toContain('kill "$OLD_PID" >/dev/null 2>&1 || true');
    expect(script).toContain('printf %s "$$" > "$AICLIUI_DAEMON_PID_FILE"');
    expect(script).toContain('nohup "$AICLIUI_HOME/bin/start-daemon.sh"');
  });

  it('generates a syntactically valid ESM daemon script', () => {
    const script = buildTermuxBootstrapScript({
      host: '127.0.0.1',
      port: '43117',
      token: 'runtime-token',
    });
    const match = script.match(/AICLIUI_DAEMON_SOURCE'\n([\s\S]*?)\nAICLIUI_DAEMON_SOURCE/);
    expect(match).not.toBeNull();
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

  it('does not start Termux command when permission is missing', async () => {
    mockIsTermuxInstalled.mockResolvedValueOnce(true);
    mockHasRunCommandPermission.mockResolvedValueOnce(false);

    await expect(installOrStartLocalRuntime()).resolves.toEqual({ status: 'permission_missing' });
    expect(mockRunCommand).not.toHaveBeenCalled();
  });
});
