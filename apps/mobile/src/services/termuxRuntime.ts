import {
  hasRunCommandPermissionAsync,
  isTermuxInstalledAsync,
  openTermuxAppAsync,
  runCommandAsync,
  type TermuxRunCommandOptions,
} from '@aicliui/termux';
import { TERMUX_DAEMON_SOURCE } from './termuxDaemonSource';
import { getOrCreateLocalDaemonConfig, LOCAL_DAEMON_PORT, type LocalDaemonConfig } from './localRuntime';

export type ProbeState = 'unknown' | 'yes' | 'no';

export type TermuxRuntimeProbe = {
  nativeModule: 'available' | 'unavailable';
  termuxInstalled: ProbeState;
  runCommandPermission: ProbeState;
};

export type RuntimeInstallResult =
  | { status: 'started'; config: LocalDaemonConfig }
  | { status: 'native_unavailable' }
  | { status: 'termux_missing' }
  | { status: 'permission_missing' };

export async function probeTermuxRuntime(): Promise<TermuxRuntimeProbe> {
  try {
    const termuxInstalled = await isTermuxInstalledAsync();
    const runCommandPermission = termuxInstalled ? await hasRunCommandPermissionAsync() : false;
    return {
      nativeModule: 'available',
      termuxInstalled: termuxInstalled ? 'yes' : 'no',
      runCommandPermission: runCommandPermission ? 'yes' : 'no',
    };
  } catch {
    return {
      nativeModule: 'unavailable',
      termuxInstalled: 'unknown',
      runCommandPermission: 'unknown',
    };
  }
}

export async function openTermuxIfAvailable(): Promise<boolean> {
  try {
    return await openTermuxAppAsync();
  } catch {
    return false;
  }
}

export async function runTermuxCommand(options: TermuxRunCommandOptions): Promise<boolean> {
  return runCommandAsync(options);
}

export async function installOrStartLocalRuntime(): Promise<RuntimeInstallResult> {
  const probe = await probeTermuxRuntime();
  if (probe.nativeModule === 'unavailable') return { status: 'native_unavailable' };
  if (probe.termuxInstalled === 'no') return { status: 'termux_missing' };
  if (probe.runCommandPermission === 'no') return { status: 'permission_missing' };

  const config = await getOrCreateLocalDaemonConfig();
  await runTermuxCommand({
    commandPath: '$PREFIX/bin/bash',
    args: ['-s'],
    stdin: buildTermuxBootstrapScript(config),
    workdir: '~',
    background: true,
    label: 'AICLIUI runtime bootstrap',
  });

  return { status: 'started', config };
}

export function buildTermuxBootstrapScript(config: LocalDaemonConfig): string {
  const token = shellSingleQuote(config.token);
  const port = shellSingleQuote(config.port || LOCAL_DAEMON_PORT);

  return `#!/data/data/com.termux/files/usr/bin/bash
set -eu

export AICLIUI_HOME="$HOME/.aicliui"
export AICLIUI_DAEMON_PORT=${port}

mkdir -p "$AICLIUI_HOME/bin" "$AICLIUI_HOME/daemon" "$AICLIUI_HOME/logs" "$AICLIUI_HOME/workspaces/default"
printf %s ${token} > "$AICLIUI_HOME/daemon/token"
chmod 600 "$AICLIUI_HOME/daemon/token"

if ! command -v node >/dev/null 2>&1; then
  pkg update -y
  pkg install -y nodejs
fi

cat > "$AICLIUI_HOME/daemon/package.json" <<'AICLIUI_DAEMON_PACKAGE'
{"name":"aicliui-termux-daemon","version":"0.1.0","private":true,"type":"module","dependencies":{"ws":"8.18.3"}}
AICLIUI_DAEMON_PACKAGE

npm install --omit=dev --prefix "$AICLIUI_HOME/daemon"

if ! command -v opencode >/dev/null 2>&1; then
  npm install -g opencode-ai@latest || true
fi

if ! command -v gemini >/dev/null 2>&1; then
  npm install -g @google/gemini-cli@latest || true
fi

cat > "$AICLIUI_HOME/daemon/aicliui-daemon.mjs" <<'AICLIUI_DAEMON_SOURCE'
${TERMUX_DAEMON_SOURCE}
AICLIUI_DAEMON_SOURCE

cat > "$AICLIUI_HOME/bin/start-daemon.sh" <<'AICLIUI_START_DAEMON'
#!/data/data/com.termux/files/usr/bin/bash
set -eu

export AICLIUI_HOME="$HOME/.aicliui"
export AICLIUI_DAEMON_TOKEN="$(cat "$AICLIUI_HOME/daemon/token")"
export AICLIUI_DAEMON_PORT="\${AICLIUI_DAEMON_PORT:-43117}"

cd "$AICLIUI_HOME/daemon"
if [ -f ./aicliui-daemon.mjs ]; then
  exec node ./aicliui-daemon.mjs >> "$AICLIUI_HOME/logs/daemon.log" 2>&1
fi

echo "AICLIUI daemon bundle is not installed yet." >> "$AICLIUI_HOME/logs/daemon.log"
exit 64
AICLIUI_START_DAEMON

chmod 700 "$AICLIUI_HOME/bin/start-daemon.sh"
nohup "$AICLIUI_HOME/bin/start-daemon.sh" >/dev/null 2>&1 &
`;
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
