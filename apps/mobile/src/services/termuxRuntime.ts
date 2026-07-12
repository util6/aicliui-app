import {
  hasRunCommandPermissionAsync,
  isTermuxInstalledAsync,
  openTermuxAppAsync,
  requestRunCommandPermissionAsync,
  runCommandAsync,
  type TermuxRunCommandOptions,
} from '@aicliui/termux';
import { getOrCreateLocalDaemonConfig, LOCAL_DAEMON_PORT, type LocalDaemonConfig } from './localRuntime';

export type LocalAgentBackend = 'opencode' | 'gemini' | 'codex';
export const TERMUX_DOWNLOAD_URL = 'https://f-droid.org/packages/com.termux/';

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

export function getTermuxExternalAppsSetupCommand(): string {
  return [
    'mkdir -p "$HOME/.termux"',
    'touch "$HOME/.termux/termux.properties"',
    "if grep -q '^allow-external-apps=' \"$HOME/.termux/termux.properties\"; then",
    "  sed -i 's/^allow-external-apps=.*/allow-external-apps=true/' \"$HOME/.termux/termux.properties\"",
    'else',
    "  printf '\\nallow-external-apps=true\\n' >> \"$HOME/.termux/termux.properties\"",
    'fi',
    'termux-reload-settings',
  ].join('\n');
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
  const port = shellSingleQuote(config.port || LOCAL_DAEMON_PORT);

  return `#!/data/data/com.termux/files/usr/bin/bash
set -eu

export AICLIUI_HOME="$HOME/.aicliui"
export AICLIUI_AIONCORE_PORT=${port}
export AICLIUI_BOOTSTRAP_LOG="$AICLIUI_HOME/logs/bootstrap.log"
export AICLIUI_BOOTSTRAP_STATUS="$AICLIUI_HOME/aioncore/bootstrap.status"

mkdir -p "$AICLIUI_HOME/bin" "$AICLIUI_HOME/aioncore" "$AICLIUI_HOME/logs" "$AICLIUI_HOME/workspaces/default"

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

write_bootstrap_status preparing "Preparing AionCore Termux runtime"

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

cat > "$AICLIUI_HOME/bin/start-aioncore-guest.sh" <<'AICLIUI_START_AIONCORE_GUEST'
#!/bin/bash
set -eu

export AICLIUI_HOME="/root/.aicliui"
export AICLIUI_AIONCORE_PORT="$(cat "$AICLIUI_HOME/aioncore/port")"

exec "$AICLIUI_HOME/aioncore/aioncore" \
  --local \
  --host 127.0.0.1 \
  --port "$AICLIUI_AIONCORE_PORT" \
  --data-dir "$AICLIUI_HOME/data" \
  --work-dir "$AICLIUI_HOME/workspaces" \
  --log-dir "$AICLIUI_HOME/logs" \
  --managed-resources-mode download \
  >> "$AICLIUI_HOME/logs/aioncore.log" 2>&1
AICLIUI_START_AIONCORE_GUEST

cat > "$AICLIUI_HOME/bin/start-aioncore.sh" <<'AICLIUI_START_AIONCORE'
#!/data/data/com.termux/files/usr/bin/bash
set -eu

export AICLIUI_HOME="$HOME/.aicliui"
export AICLIUI_AIONCORE_PID_FILE="$AICLIUI_HOME/aioncore/aioncore.pid"

if [ -s "$AICLIUI_AIONCORE_PID_FILE" ]; then
  OLD_PID="$(cat "$AICLIUI_AIONCORE_PID_FILE" || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" >/dev/null 2>&1; then
    kill "$OLD_PID" >/dev/null 2>&1 || true
    sleep 1
  fi
fi

if [ -s "$AICLIUI_HOME/daemon/daemon.pid" ]; then
  LEGACY_PID="$(cat "$AICLIUI_HOME/daemon/daemon.pid" || true)"
  if [ -n "$LEGACY_PID" ] && kill -0 "$LEGACY_PID" >/dev/null 2>&1; then
    kill "$LEGACY_PID" >/dev/null 2>&1 || true
    sleep 1
  fi
fi

printf %s "$$" > "$AICLIUI_AIONCORE_PID_FILE"
exec proot-distro login aicliui --shared-tmp --bind "$AICLIUI_HOME:/root/.aicliui" -- /root/.aicliui/bin/start-aioncore-guest.sh
AICLIUI_START_AIONCORE

printf %s "$AICLIUI_AIONCORE_PORT" > "$AICLIUI_HOME/aioncore/port"
chmod 700 "$AICLIUI_HOME/bin/start-aioncore.sh" "$AICLIUI_HOME/bin/start-aioncore-guest.sh"

write_bootstrap_status installing_linux_dependencies "Installing AionCore dependencies and CLI agents in Debian"
if ! proot-distro login aicliui --shared-tmp --bind "$AICLIUI_HOME:/root/.aicliui" -- /bin/bash -s <<'AICLIUI_GUEST_BOOTSTRAP'
set -euo pipefail

export AICLIUI_HOME="/root/.aicliui"
export DEBIAN_FRONTEND=noninteractive
export AIONCORE_VERSION="v0.1.43"
export AIONCORE_ARCHIVE="aioncore-v0.1.43-aarch64-unknown-linux-gnu.tar.gz"
export AIONCORE_URL="https://github.com/iOfficeAI/AionCore/releases/download/v0.1.43/$AIONCORE_ARCHIVE"
export AIONCORE_SHA256="d8f86dc1538b85f136466c0e9ef011ceb5357276e9beb5a3715673ff1d28594b"

write_guest_status() {
  {
    printf 'phase=%s\\n' "$1"
    printf 'detail=%s\\n' "$2"
    printf 'updatedAt=%s\\n' "$(date +%s000)"
  } > "$AICLIUI_HOME/aioncore/bootstrap.status"
  printf '%s %s: %s\\n' "$(date -Iseconds)" "$1" "$2" >> "$AICLIUI_HOME/logs/bootstrap.log"
}

apt-get update
apt-get install -y ca-certificates curl gnupg git ripgrep tar

case "$(uname -m)" in
  aarch64|arm64) ;;
  *)
    write_guest_status unsupported_architecture "Unsupported Android CPU architecture: $(uname -m)"
    exit 1
    ;;
esac

CURRENT_AIONCORE_VERSION="$(cat "$AICLIUI_HOME/aioncore/version" 2>/dev/null || true)"
if [ ! -x "$AICLIUI_HOME/aioncore/aioncore" ] || [ "$CURRENT_AIONCORE_VERSION" != "$AIONCORE_VERSION" ]; then
  write_guest_status installing_aioncore "Installing AionCore $AIONCORE_VERSION"
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT
  curl -fL --retry 3 --retry-delay 2 "$AIONCORE_URL" -o "$TMP_DIR/$AIONCORE_ARCHIVE"
  printf '%s  %s\n' "$AIONCORE_SHA256" "$TMP_DIR/$AIONCORE_ARCHIVE" | sha256sum -c -
  tar -xzf "$TMP_DIR/$AIONCORE_ARCHIVE" -C "$TMP_DIR"
  install -m 0755 "$TMP_DIR/aioncore" "$AICLIUI_HOME/aioncore/aioncore"
  printf %s "$AIONCORE_VERSION" > "$AICLIUI_HOME/aioncore/version"
  rm -rf "$TMP_DIR"
  trap - EXIT
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || printf 0)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  write_guest_status installing_node "Installing Node.js 22 in Debian"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v opencode >/dev/null 2>&1 || ! opencode --version >/dev/null 2>&1; then
  write_guest_status installing_opencode "Installing OpenCode CLI"
  if ! npm install -g opencode-ai@latest || ! opencode --version >/dev/null 2>&1; then
    write_guest_status opencode_install_failed "Failed to install OpenCode CLI; AionCore can still start"
  fi
fi

if ! command -v gemini >/dev/null 2>&1 || ! gemini --version >/dev/null 2>&1; then
  write_guest_status installing_gemini "Installing Gemini CLI"
  if ! npm install -g @google/gemini-cli@latest || ! gemini --version >/dev/null 2>&1; then
    write_guest_status gemini_install_failed "Failed to install Gemini CLI; AionCore can still start"
  fi
fi

if ! command -v codex >/dev/null 2>&1 || ! codex --version >/dev/null 2>&1; then
  write_guest_status installing_codex "Installing Codex CLI"
  if ! npm install -g @openai/codex@latest || ! codex --version >/dev/null 2>&1; then
    write_guest_status codex_install_failed "Failed to install Codex CLI; AionCore can still start"
  fi
fi
AICLIUI_GUEST_BOOTSTRAP
then
  write_bootstrap_status linux_dependencies_failed "Failed to prepare CLI agents in Debian"
  exit 1
fi

write_bootstrap_status aioncore_start_requested "Starting local AionCore"
nohup "$AICLIUI_HOME/bin/start-aioncore.sh" >/dev/null 2>&1 &
`;
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
