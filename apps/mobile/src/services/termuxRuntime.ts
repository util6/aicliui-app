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
export AICLIUI_BOOTSTRAP_LOG="$AICLIUI_HOME/logs/bootstrap.log"
export AICLIUI_BOOTSTRAP_STATUS="$AICLIUI_HOME/daemon/bootstrap.status"

mkdir -p "$AICLIUI_HOME/bin" "$AICLIUI_HOME/daemon" "$AICLIUI_HOME/logs" "$AICLIUI_HOME/workspaces/default"

log_bootstrap() {
  printf '%s %s\\n' "$(date -Iseconds)" "$*" >> "$AICLIUI_BOOTSTRAP_LOG"
}

write_bootstrap_status() {
  {
    printf 'phase=%s\\n' "$1"
    printf 'detail=%s\\n' "$2"
    printf 'updatedAt=%s\\n' "$(date +%s000)"
  } > "$AICLIUI_BOOTSTRAP_STATUS"
  log_bootstrap "$1: $2"
}

write_bootstrap_status preparing "Preparing AICLIUI Termux runtime"
printf %s ${token} > "$AICLIUI_HOME/daemon/token"
chmod 600 "$AICLIUI_HOME/daemon/token"

if ! command -v node >/dev/null 2>&1; then
  write_bootstrap_status installing_node "Installing Node.js in Termux"
  pkg update -y
  if ! pkg install -y nodejs; then
    write_bootstrap_status node_install_failed "Failed to install Node.js"
    exit 1
  fi
fi

cat > "$AICLIUI_HOME/daemon/package.json" <<'AICLIUI_DAEMON_PACKAGE'
{"name":"aicliui-termux-daemon","version":"0.1.0","private":true,"type":"module","dependencies":{"ws":"8.18.3"}}
AICLIUI_DAEMON_PACKAGE

write_bootstrap_status installing_daemon_deps "Installing daemon npm dependencies"
if ! npm install --omit=dev --prefix "$AICLIUI_HOME/daemon"; then
  write_bootstrap_status daemon_deps_failed "Failed to install daemon npm dependencies"
  exit 1
fi

if ! command -v opencode >/dev/null 2>&1; then
  write_bootstrap_status installing_opencode "Installing OpenCode CLI"
  if ! npm install -g opencode-ai@latest; then
    write_bootstrap_status opencode_install_failed "Failed to install OpenCode CLI; daemon can still start"
  fi
fi

if ! command -v gemini >/dev/null 2>&1; then
  write_bootstrap_status installing_gemini "Installing Gemini CLI"
  if ! npm install -g @google/gemini-cli@latest; then
    write_bootstrap_status gemini_install_failed "Failed to install Gemini CLI; daemon can still start"
  fi
fi

if ! command -v codex >/dev/null 2>&1; then
  write_bootstrap_status installing_codex "Installing Codex CLI"
  if ! npm install -g @openai/codex@latest; then
    write_bootstrap_status codex_install_failed "Failed to install Codex CLI; daemon can still start"
  fi
fi

write_bootstrap_status writing_daemon "Writing daemon source files"

cat > "$AICLIUI_HOME/daemon/aicliui-daemon.mjs" <<'AICLIUI_DAEMON_SOURCE'
${TERMUX_DAEMON_SOURCE}
AICLIUI_DAEMON_SOURCE

cat > "$AICLIUI_HOME/bin/start-daemon.sh" <<'AICLIUI_START_DAEMON'
#!/data/data/com.termux/files/usr/bin/bash
set -eu

export AICLIUI_HOME="$HOME/.aicliui"
export AICLIUI_DAEMON_TOKEN="$(cat "$AICLIUI_HOME/daemon/token")"
export AICLIUI_DAEMON_PORT="\${AICLIUI_DAEMON_PORT:-43117}"
export AICLIUI_BOOTSTRAP_STATUS="$AICLIUI_HOME/daemon/bootstrap.status"
export AICLIUI_DAEMON_PID_FILE="$AICLIUI_HOME/daemon/daemon.pid"

cd "$AICLIUI_HOME/daemon"
if [ -f ./aicliui-daemon.mjs ]; then
  if [ -s "$AICLIUI_DAEMON_PID_FILE" ]; then
    OLD_PID="$(cat "$AICLIUI_DAEMON_PID_FILE" || true)"
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" >/dev/null 2>&1; then
      kill "$OLD_PID" >/dev/null 2>&1 || true
      sleep 1
    fi
  fi
  printf %s "$$" > "$AICLIUI_DAEMON_PID_FILE"
  exec node ./aicliui-daemon.mjs >> "$AICLIUI_HOME/logs/daemon.log" 2>&1
fi

echo "AICLIUI daemon bundle is not installed yet." >> "$AICLIUI_HOME/logs/daemon.log"
exit 64
AICLIUI_START_DAEMON

chmod 700 "$AICLIUI_HOME/bin/start-daemon.sh"
write_bootstrap_status daemon_start_requested "Starting local daemon"
nohup "$AICLIUI_HOME/bin/start-daemon.sh" >/dev/null 2>&1 &
`;
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
