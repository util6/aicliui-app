import {
  hasRunCommandPermissionAsync,
  isTermuxInstalledAsync,
  openTermuxAppAsync,
  runCommandAsync,
  type TermuxRunCommandOptions,
} from '@aicliui/termux';
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

cat > "$AICLIUI_HOME/daemon/aicliui-daemon.mjs" <<'AICLIUI_DAEMON_SOURCE'
import { WebSocketServer } from 'ws';

const port = Number.parseInt(process.env.AICLIUI_DAEMON_PORT || '43117', 10);
const token = process.env.AICLIUI_DAEMON_TOKEN || '';
const startedAt = Date.now();
const conversations = new Map();
const messages = new Map();

const agents = [
  { backend: 'opencode', name: 'opencode', label: 'OpenCode' },
  { backend: 'gemini', name: 'gemini', label: 'Gemini CLI' },
];

const server = new WebSocketServer({ host: '127.0.0.1', port });

server.on('connection', (socket, request) => {
  if (token && request.headers['sec-websocket-protocol'] !== token) {
    socket.close(1008, 'auth_failed');
    return;
  }

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!message || typeof message.name !== 'string' || message.name === 'pong') return;
    if (!message.name.startsWith('subscribe-')) return;

    const key = message.name.slice('subscribe-'.length);
    const id = message.data && typeof message.data.id === 'string' ? message.data.id : '';
    if (!id) return;

    const pushes = [];
    const emit = (name, data) => pushes.push({ name, data });
    let data;
    try {
      data = route(key, message.data.data, emit);
    } catch (error) {
      data = {
        success: false,
        error: { code: 'BRIDGE_ROUTE_FAILED', message: error instanceof Error ? error.message : 'Route failed' },
      };
    }

    socket.send(JSON.stringify({ name: 'subscribe.callback-' + key + id, data }));
    for (const push of pushes) socket.send(JSON.stringify(push));
  });

  const heartbeat = setInterval(() => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ name: 'ping', data: { timestamp: Date.now() } }));
    }
  }, 15000);
  socket.on('close', () => clearInterval(heartbeat));
});

function route(key, data, emit) {
  const params = isRecord(data) ? data : {};
  if (key === 'runtime.get-status') {
    return {
      daemon: { version: '0.1.0-termux-bootstrap', startedAt },
      termux: { runCommandPermission: 'granted', allowExternalApps: 'unknown' },
      agents: [
        { backend: 'opencode', state: 'missing' },
        { backend: 'gemini', state: 'missing' },
      ],
    };
  }
  if (key === 'acp.get-available-agents') return { success: true, data: agents };
  if (key === 'acp.probe-model-info') return { success: true, data: { modelInfo: null } };
  if (key === 'database.get-user-conversations') return listConversations(params.page, params.pageSize);
  if (key === 'database.get-conversation-messages') return messages.get(requiredString(params.conversation_id)) || [];
  if (key === 'create-conversation') return createConversation(params);
  if (key === 'remove-conversation') return removeConversation(requiredString(params.id));
  if (key === 'update-conversation') return updateConversation(requiredString(params.id), isRecord(params.updates) ? params.updates : {});
  if (key === 'chat.send.message') return sendMessage(params, emit);
  if (key === 'chat.stop.stream') return { success: true };
  if (key === 'confirmation.list') return [];
  if (key === 'confirmation.confirm') return { success: true };
  if (key === 'conversation.get-workspace') return [];
  throw new Error("No bridge handler registered for '" + key + "'");
}

function createConversation(params) {
  const now = Date.now();
  const id = randomId();
  const conversation = {
    id,
    name: typeof params.name === 'string' && params.name.trim() ? params.name.trim() : 'New conversation',
    type: typeof params.type === 'string' ? params.type : 'acp',
    status: 'finished',
    createTime: now,
    modifyTime: now,
    model: isRecord(params.model) ? params.model : { id: '', useModel: '' },
    extra: isRecord(params.extra) ? params.extra : {},
  };
  conversations.set(id, conversation);
  messages.set(id, []);
  return conversation;
}

function listConversations(page = 0, pageSize = 100) {
  const start = Math.max(0, Number(page) || 0) * Math.max(1, Number(pageSize) || 100);
  const end = start + Math.max(1, Number(pageSize) || 100);
  return Array.from(conversations.values()).sort((a, b) => b.modifyTime - a.modifyTime).slice(start, end);
}

function sendMessage(params, emit) {
  const conversationId = requiredString(params.conversation_id);
  const input = requiredString(params.input);
  if (!conversations.has(conversationId)) throw new Error("Conversation '" + conversationId + "' was not found");
  const userMsgId = typeof params.msg_id === 'string' ? params.msg_id : randomId();
  const assistantMsgId = 'assistant_' + userMsgId;
  const assistantContent = 'Local daemon received: ' + input;
  addTextMessage(conversationId, userMsgId, 'right', input);
  addTextMessage(conversationId, assistantMsgId, 'left', assistantContent);
  emit('chat.response.stream', { type: 'start', msg_id: assistantMsgId, conversation_id: conversationId, data: null });
  emit('chat.response.stream', {
    type: 'content',
    msg_id: assistantMsgId,
    conversation_id: conversationId,
    data: { content: assistantContent },
  });
  emit('chat.response.stream', { type: 'finish', msg_id: assistantMsgId, conversation_id: conversationId, data: null });
  return { success: true };
}

function addTextMessage(conversationId, msgId, position, content) {
  const now = Date.now();
  const message = {
    id: randomId(),
    msg_id: msgId,
    conversation_id: conversationId,
    type: 'text',
    position,
    content: { content },
    createdAt: now,
  };
  messages.get(conversationId).push(message);
  conversations.get(conversationId).modifyTime = now;
}

function removeConversation(id) {
  const existed = conversations.delete(id);
  messages.delete(id);
  return existed;
}

function updateConversation(id, updates) {
  const conversation = conversations.get(id);
  if (!conversation) return false;
  conversations.set(id, {
    ...conversation,
    ...updates,
    extra: isRecord(updates.extra) ? { ...conversation.extra, ...updates.extra } : conversation.extra,
    modifyTime: Date.now(),
  });
  return true;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value) {
  if (typeof value !== 'string') throw new Error('Expected string bridge parameter');
  return value;
}

function randomId() {
  return 'local_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

console.log('aicliui termux daemon listening on ws://127.0.0.1:' + port);
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
