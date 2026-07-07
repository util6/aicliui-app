export const TERMUX_DAEMON_SOURCE = String.raw`import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';

const port = Number.parseInt(process.env.AICLIUI_DAEMON_PORT || '43117', 10);
const openCodePort = Number.parseInt(process.env.AICLIUI_OPENCODE_PORT || '4096', 10);
const token = process.env.AICLIUI_DAEMON_TOKEN || '';
const startedAt = Date.now();
const conversations = new Map();
const messages = new Map();
let openCodeServerPromise = null;

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

  socket.on('message', async (raw) => {
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
      data = await route(key, message.data.data, emit);
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

async function route(key, data, emit) {
  const params = isRecord(data) ? data : {};
  if (key === 'runtime.get-status') return getRuntimeStatus();
  if (key === 'acp.get-available-agents') return { success: true, data: agents };
  if (key === 'acp.probe-model-info') return { success: true, data: { modelInfo: null } };
  if (key === 'database.get-user-conversations') return listConversations(params.page, params.pageSize);
  if (key === 'database.get-conversation-messages') return messages.get(requiredString(params.conversation_id)) || [];
  if (key === 'create-conversation') return createConversation(params);
  if (key === 'remove-conversation') return removeConversation(requiredString(params.id));
  if (key === 'update-conversation') return updateConversation(requiredString(params.id), isRecord(params.updates) ? params.updates : {});
  if (key === 'chat.send.message') return await sendMessage(params, emit);
  if (key === 'chat.stop.stream') return { success: true };
  if (key === 'confirmation.list') return [];
  if (key === 'confirmation.confirm') return { success: true };
  if (key === 'conversation.get-workspace') return [];
  throw new Error("No bridge handler registered for '" + key + "'");
}

async function getRuntimeStatus() {
  return {
    daemon: { version: '0.1.0-termux-bootstrap', startedAt },
    termux: { runCommandPermission: 'granted', allowExternalApps: 'unknown' },
    agents: await Promise.all([probeAgent('opencode'), probeAgent('gemini')]),
  };
}

async function probeAgent(backend) {
  const exists = await commandExists(backend);
  if (!exists) return { backend, state: 'missing', detail: backend + ' command not found' };
  return { backend, state: 'ready', version: await readVersion(backend, ['--version']) };
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

async function sendMessage(params, emit) {
  const conversationId = requiredString(params.conversation_id);
  const input = requiredString(params.input);
  const conversation = conversations.get(conversationId);
  if (!conversation) throw new Error("Conversation '" + conversationId + "' was not found");
  const userMsgId = typeof params.msg_id === 'string' ? params.msg_id : randomId();
  const assistantMsgId = 'assistant_' + userMsgId;
  const backend = typeof conversation.extra.backend === 'string' ? conversation.extra.backend : 'opencode';
  const workspace =
    typeof conversation.extra.workspace === 'string' && conversation.extra.workspace
      ? conversation.extra.workspace
      : process.env.AICLIUI_WORKSPACE || process.env.HOME + '/.aicliui/workspaces/default';
  const model = typeof conversation.extra.currentModelId === 'string' ? conversation.extra.currentModelId : undefined;
  const approvalMode = typeof conversation.extra.sessionMode === 'string' ? conversation.extra.sessionMode : undefined;
  let assistantContent = '';

  addTextMessage(conversationId, userMsgId, 'right', input);
  emit('chat.response.stream', { type: 'start', msg_id: assistantMsgId, conversation_id: conversationId, data: null });

  try {
    if (backend === 'opencode') {
      if (!(await commandExists('opencode'))) {
        throw new Error('opencode command not found. The bootstrap tried npm install -g opencode-ai@latest; check Termux npm output in ~/.aicliui/logs/daemon.log.');
      }
      emit('chat.response.stream', {
        type: 'thought',
        msg_id: assistantMsgId,
        conversation_id: conversationId,
        data: { subject: 'OpenCode', description: 'starting local server on 127.0.0.1:' + openCodePort },
      });
      const result = await sendOpenCodePrompt({ input, workspace });
      emit('chat.response.stream', {
        type: 'thought',
        msg_id: assistantMsgId,
        conversation_id: conversationId,
        data: { subject: 'OpenCode', description: 'session ' + result.sessionId },
      });
      assistantContent = result.text || 'OpenCode completed, but no assistant text was returned from the session context.';
    } else if (backend === 'gemini') {
      if (!(await commandExists('gemini'))) {
        throw new Error('gemini command not found. The bootstrap tried npm install -g @google/gemini-cli@latest; check Termux npm output in ~/.aicliui/logs/daemon.log.');
      }
      emit('chat.response.stream', {
        type: 'thought',
        msg_id: assistantMsgId,
        conversation_id: conversationId,
        data: { subject: 'Gemini CLI', description: buildGeminiCommandDescription({ input, model, approvalMode }) },
      });
      assistantContent =
        (await sendGeminiPrompt({ input, workspace, model, approvalMode })) ||
        'Gemini CLI completed, but no assistant text was returned.';
    } else {
      throw new Error("Agent backend '" + backend + "' is not supported by this Termux daemon.");
    }
  } catch (error) {
    assistantContent =
      (backend === 'opencode' ? 'OpenCode runtime failed: ' : 'CLI runtime failed: ') +
      (error instanceof Error ? error.message : 'Unknown runtime error');
  }

  addTextMessage(conversationId, assistantMsgId, 'left', assistantContent);
  emit('chat.response.stream', {
    type: 'content',
    msg_id: assistantMsgId,
    conversation_id: conversationId,
    data: { content: assistantContent },
  });
  emit('chat.response.stream', { type: 'finish', msg_id: assistantMsgId, conversation_id: conversationId, data: null });
  return { success: true };
}

async function sendOpenCodePrompt({ input, workspace }) {
  const baseUrl = await ensureOpenCodeServer();
  const session = await requestOpenCodeJson(baseUrl, '/api/session', {
    method: 'POST',
    body: JSON.stringify({
      ...(workspace ? { location: { directory: workspace } } : {}),
    }),
  });
  const sessionId = session && session.data && typeof session.data.id === 'string' ? session.data.id : '';
  if (!sessionId) throw new Error('OpenCode session.create returned no session id');

  await requestOpenCodeJson(baseUrl, '/api/session/' + encodeURIComponent(sessionId) + '/prompt', {
    method: 'POST',
    body: JSON.stringify({
      prompt: {
        text: input,
        files: [],
        agents: [],
      },
    }),
  });
  await requestOpenCodeJson(baseUrl, '/api/session/' + encodeURIComponent(sessionId) + '/wait', { method: 'POST' });
  const context = await requestOpenCodeJson(baseUrl, '/api/session/' + encodeURIComponent(sessionId) + '/context', {
    method: 'GET',
  });

  return {
    sessionId,
    text: extractOpenCodeAssistantText(Array.isArray(context && context.data) ? context.data : []),
  };
}

function buildGeminiCommandDescription({ input, model, approvalMode }) {
  return buildGeminiArgs({ input, model, approvalMode })
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(' ');
}

function buildGeminiArgs({ input, model, approvalMode }) {
  return [
    'gemini',
    '-p',
    input,
    '--output-format',
    'stream-json',
    ...(model ? ['--model', model] : []),
    ...(approvalMode ? ['--approval-mode', approvalMode] : []),
  ];
}

async function sendGeminiPrompt({ input, workspace, model, approvalMode }) {
  const args = buildGeminiArgs({ input, model, approvalMode }).slice(1);
  const result = await runProcess('gemini', args, { cwd: workspace || process.env.HOME || process.cwd() });
  return extractGeminiStreamText(result.stdout) || result.stdout.trim();
}

async function ensureOpenCodeServer() {
  if (openCodeServerPromise) return openCodeServerPromise;
  openCodeServerPromise = startOpenCodeServer();
  return openCodeServerPromise;
}

function startOpenCodeServer() {
  return new Promise((resolve, reject) => {
    const child = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', String(openCodePort)], {
      cwd: process.env.HOME || process.cwd(),
      env: process.env,
    });
    let output = '';
    let resolved = false;

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      openCodeServerPromise = null;
      child.kill('SIGTERM');
      reject(new Error('Timed out waiting for OpenCode server listening on 127.0.0.1:' + openCodePort));
    }, 30000);

    const handleOutput = (chunk) => {
      output += chunk.toString();
      const match = output.match(/server listening on\s+(https?:\/\/[^\s]+)/i);
      if (!match || resolved) return;
      resolved = true;
      clearTimeout(timeout);
      resolve(match[1].replace(/\/+$/, ''));
    };

    child.stdout.on('data', handleOutput);
    child.stderr.on('data', handleOutput);
    child.on('error', (error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      openCodeServerPromise = null;
      reject(error);
    });
    child.on('exit', (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      openCodeServerPromise = null;
      reject(new Error('OpenCode server exited before it was ready with code ' + code + ': ' + output.slice(-1000)));
    });
  });
}

async function requestOpenCodeJson(baseUrl, path, init) {
  const response = await fetch(baseUrl + path, {
    ...init,
    headers: {
      ...(init && init.body ? { 'Content-Type': 'application/json' } : {}),
      ...((init && init.headers) || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error('OpenCode ' + ((init && init.method) || 'GET') + ' ' + path + ' failed (' + response.status + '): ' + body);
  }
  if (response.status === 204) return undefined;
  return await response.json();
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.env.HOME || process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const appendStdout = (chunk) => {
      stdout += chunk.toString();
    };
    const appendStderr = (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    };
    child.stdout.on('data', appendStdout);
    child.stderr.on('data', appendStderr);
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(command + ' exited with code ' + code + ': ' + (stderr || stdout).slice(-1000)));
    });
  });
}

function extractGeminiStreamText(output) {
  return output
    .split(/\r?\n/)
    .map((line) => parseGeminiStreamJsonLine(line))
    .filter(Boolean)
    .join('');
}

function parseGeminiStreamJsonLine(line) {
  if (!line.trim()) return '';
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return '';
  }
  return extractGeminiText(value);
}

function extractGeminiText(value) {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return '';

  const direct =
    stringValue(value.value) ||
    stringValue(value.text) ||
    stringValue(value.content) ||
    stringValue(value.delta) ||
    (isRecord(value.message) ? stringValue(value.message.content) : undefined);
  if (direct) return direct;

  return extractGeminiCandidateText(value.candidates);
}

function extractGeminiCandidateText(value) {
  if (!Array.isArray(value)) return '';
  return value
    .flatMap((candidate) => {
      if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) return [];
      return candidate.content.parts.map((part) => (isRecord(part) ? stringValue(part.text) : undefined));
    })
    .filter(Boolean)
    .join('');
}

function extractOpenCodeAssistantText(items) {
  for (const item of [...items].reverse()) {
    if (!isAssistantMessage(item)) continue;
    const text = extractTextParts(item);
    if (text) return text;
  }
  return '';
}

function isAssistantMessage(value) {
  return isRecord(value) && (value.role === 'assistant' || value.type === 'assistant');
}

function extractTextParts(value) {
  const candidates = [value.parts, value.content];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const text = candidate
      .map((part) => (isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
      .join('');
    if (text) return text;
  }
  return typeof value.text === 'string' ? value.text : '';
}

function commandExists(command) {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-lc', 'command -v "$1" >/dev/null 2>&1', 'sh', command], { stdio: 'ignore' });
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

function readVersion(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve(undefined);
    }, 5000);
    const append = (chunk) => {
      output += chunk.toString();
      if (output.length > 4000) output = output.slice(0, 4000);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(undefined);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve(undefined);
      resolve(output.trim().split(/\r?\n/)[0] || undefined);
    });
  });
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

function stringValue(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function randomId() {
  return 'local_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

console.log('aicliui termux daemon listening on ws://127.0.0.1:' + port);`;
