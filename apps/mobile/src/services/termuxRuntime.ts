import {
  hasRunCommandPermissionAsync,
  isTermuxInstalledAsync,
  openTermuxAppAsync,
  requestRunCommandPermissionAsync,
  runCommandAsync,
  type TermuxRunCommandOptions,
} from '@aicliui/termux';
import { TERMUX_DAEMON_SOURCE } from './termuxDaemonSource';
import { getOrCreateLocalDaemonConfig, LOCAL_DAEMON_PORT, type LocalDaemonConfig } from './localRuntime';

export type LocalAgentBackend = 'opencode' | 'gemini' | 'codex';

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
  | { status: 'permission_missing' }
  | { status: 'start_failed' };

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

export function getAgentLoginCommand(backend: LocalAgentBackend): string {
  const loginCommand: Record<LocalAgentBackend, string> = {
    opencode: 'opencode auth login',
    gemini: 'gemini',
    codex: 'codex login',
  };

  return `proot-distro login aicliui --shared-tmp --bind "$HOME/.aicliui:/root/.aicliui" -- /bin/bash -lc 'cd /root/.aicliui/workspaces/default && exec ${loginCommand[backend]}'`;
}

export async function installOrStartLocalRuntime(): Promise<RuntimeInstallResult> {
  const probe = await probeTermuxRuntime();
  if (probe.nativeModule === 'unavailable') return { status: 'native_unavailable' };
  if (probe.termuxInstalled === 'no') return { status: 'termux_missing' };
  if (probe.runCommandPermission === 'no') {
    let granted = false;
    try {
      granted = await requestRunCommandPermissionAsync();
    } catch {
      return { status: 'permission_missing' };
    }
    if (!granted) return { status: 'permission_missing' };
  }

  const config = await getOrCreateLocalDaemonConfig();
  const started = await runTermuxCommand({
    commandPath: '$PREFIX/bin/bash',
    args: ['-s'],
    stdin: buildTermuxBootstrapScript(config),
    workdir: '~',
    background: true,
    label: 'AICLIUI runtime bootstrap',
  });
  if (!started) return { status: 'start_failed' };

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

if ! command -v proot-distro >/dev/null 2>&1; then
  write_bootstrap_status installing_proot "Installing isolated Linux runtime"
  pkg update -y
  if ! pkg install -y proot-distro; then
    write_bootstrap_status proot_install_failed "Failed to install proot-distro"
    exit 1
  fi
fi

if ! proot-distro login aicliui -- /bin/true >/dev/null 2>&1; then
  write_bootstrap_status installing_linux_runtime "Installing AICLIUI Debian runtime"
  if ! proot-distro install debian:bookworm --name aicliui; then
    write_bootstrap_status linux_runtime_install_failed "Failed to install AICLIUI Debian runtime"
    exit 1
  fi
fi

proot-distro login aicliui -- /bin/mkdir -p /root/.aicliui

cat > "$AICLIUI_HOME/daemon/package.json" <<'AICLIUI_DAEMON_PACKAGE'
{"name":"aicliui-termux-daemon","version":"0.1.0","private":true,"type":"module","dependencies":{"ws":"8.18.3"}}
AICLIUI_DAEMON_PACKAGE

write_bootstrap_status writing_daemon "Writing daemon source files"

cat > "$AICLIUI_HOME/daemon/aicliui-daemon.mjs" <<'AICLIUI_DAEMON_SOURCE'
${TERMUX_DAEMON_SOURCE}
AICLIUI_DAEMON_SOURCE

cat > "$AICLIUI_HOME/bin/start-daemon-guest.sh" <<'AICLIUI_START_DAEMON_GUEST'
#!/bin/bash
set -eu

export AICLIUI_HOME="/root/.aicliui"
export AICLIUI_DAEMON_TOKEN="$(cat "$AICLIUI_HOME/daemon/token")"
export AICLIUI_DAEMON_PORT="$(cat "$AICLIUI_HOME/daemon/port")"
export AICLIUI_BOOTSTRAP_STATUS="$AICLIUI_HOME/daemon/bootstrap.status"
export AICLIUI_WORKSPACE="$AICLIUI_HOME/workspaces/default"
export AICLIUI_TERMUX_RUN_COMMAND_PERMISSION="granted"
export AICLIUI_TERMUX_ALLOW_EXTERNAL_APPS="enabled"

cd "$AICLIUI_HOME/daemon"
exec node ./aicliui-daemon.mjs >> "$AICLIUI_HOME/logs/daemon.log" 2>&1
AICLIUI_START_DAEMON_GUEST

cat > "$AICLIUI_HOME/bin/start-daemon.sh" <<'AICLIUI_START_DAEMON'
#!/data/data/com.termux/files/usr/bin/bash
set -eu

export AICLIUI_HOME="$HOME/.aicliui"
export AICLIUI_DAEMON_PID_FILE="$AICLIUI_HOME/daemon/daemon.pid"

if [ -s "$AICLIUI_DAEMON_PID_FILE" ]; then
  OLD_PID="$(cat "$AICLIUI_DAEMON_PID_FILE" || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" >/dev/null 2>&1; then
    kill "$OLD_PID" >/dev/null 2>&1 || true
    sleep 1
  fi
fi

printf %s "$$" > "$AICLIUI_DAEMON_PID_FILE"
exec proot-distro login aicliui --shared-tmp --bind "$AICLIUI_HOME:/root/.aicliui" -- /root/.aicliui/bin/start-daemon-guest.sh
AICLIUI_START_DAEMON

printf %s "$AICLIUI_DAEMON_PORT" > "$AICLIUI_HOME/daemon/port"
chmod 700 "$AICLIUI_HOME/bin/start-daemon.sh" "$AICLIUI_HOME/bin/start-daemon-guest.sh"

write_bootstrap_status installing_linux_dependencies "Installing Node.js and CLI agents in Debian"
if ! proot-distro login aicliui --shared-tmp --bind "$AICLIUI_HOME:/root/.aicliui" -- /bin/bash -s <<'AICLIUI_GUEST_BOOTSTRAP'
set -euo pipefail

export AICLIUI_HOME="/root/.aicliui"
export DEBIAN_FRONTEND=noninteractive

write_guest_status() {
  {
    printf 'phase=%s\\n' "$1"
    printf 'detail=%s\\n' "$2"
    printf 'updatedAt=%s\\n' "$(date +%s000)"
  } > "$AICLIUI_HOME/daemon/bootstrap.status"
  printf '%s %s: %s\\n' "$(date -Iseconds)" "$1" "$2" >> "$AICLIUI_HOME/logs/bootstrap.log"
}

apt-get update
apt-get install -y ca-certificates curl gnupg git ripgrep

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || printf 0)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  write_guest_status installing_node "Installing Node.js 22 in Debian"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

write_guest_status installing_daemon_deps "Installing daemon npm dependencies"
npm install --omit=dev --prefix "$AICLIUI_HOME/daemon"

if ! command -v opencode >/dev/null 2>&1 || ! opencode --version >/dev/null 2>&1; then
  write_guest_status installing_opencode "Installing OpenCode CLI"
  if ! npm install -g opencode-ai@latest || ! opencode --version >/dev/null 2>&1; then
    write_guest_status opencode_install_failed "Failed to install OpenCode CLI; daemon can still start"
  fi
fi

if ! command -v gemini >/dev/null 2>&1 || ! gemini --version >/dev/null 2>&1; then
  write_guest_status installing_gemini "Installing Gemini CLI"
  if ! npm install -g @google/gemini-cli@latest || ! gemini --version >/dev/null 2>&1; then
    write_guest_status gemini_install_failed "Failed to install Gemini CLI; daemon can still start"
  fi
fi

if ! command -v codex >/dev/null 2>&1 || ! codex --version >/dev/null 2>&1; then
  write_guest_status installing_codex "Installing Codex CLI"
  if ! npm install -g @openai/codex@latest || ! codex --version >/dev/null 2>&1; then
    write_guest_status codex_install_failed "Failed to install Codex CLI; daemon can still start"
  fi
fi
AICLIUI_GUEST_BOOTSTRAP
then
  write_bootstrap_status linux_dependencies_failed "Failed to prepare CLI agents in Debian"
  exit 1
fi

write_bootstrap_status daemon_start_requested "Starting local daemon"
nohup "$AICLIUI_HOME/bin/start-daemon.sh" >/dev/null 2>&1 &
`;
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
