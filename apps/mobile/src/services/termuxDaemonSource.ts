export const TERMUX_DAEMON_SOURCE = String.raw`import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';

const IGNORED_ENTRY_NAMES = new Set(['.git', 'node_modules', '.expo', '.next', 'dist', 'build']);
const MAX_WORKSPACE_TREE_DEPTH = 4;
const MAX_WORKSPACE_TREE_ENTRIES = 1000;
const MAX_TEXT_FILE_BYTES = 1024 * 1024 * 2;
const port = Number.parseInt(process.env.AICLIUI_DAEMON_PORT || '43117', 10);
const openCodePort = Number.parseInt(process.env.AICLIUI_OPENCODE_PORT || '4096', 10);
const dataRoot = process.env.AICLIUI_HOME || (process.env.HOME ? process.env.HOME + '/.aicliui' : '.aicliui');
const storePath = process.env.AICLIUI_STORE_PATH || dataRoot + '/daemon/store.json';
const bootstrapStatusPath = process.env.AICLIUI_BOOTSTRAP_STATUS || dataRoot + '/daemon/bootstrap.status';
const token = process.env.AICLIUI_DAEMON_TOKEN || '';
const startedAt = Date.now();
const conversations = new Map();
const messages = new Map();
const artifacts = new Map();
const activeRuns = new Map();
const pendingConfirmations = new Map();
const openCodeSessions = new Map();
let openCodeServerPromise = null;
let saveQueue = Promise.resolve();
const storeReady = loadStore();

const geminiModels = parseModelOptions(
  process.env.AICLIUI_GEMINI_MODELS,
  [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  ],
);

const codexModels = parseModelOptions(
  process.env.AICLIUI_CODEX_MODELS,
  [
    { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
    { id: 'gpt-5', label: 'GPT-5' },
    { id: 'gpt-5-mini', label: 'GPT-5 Mini' },
  ],
);

const agentModes = {
  opencode: [
    { value: 'build', label: 'Build' },
    { value: 'plan', label: 'Plan' },
  ],
  gemini: [
    { value: 'default', label: 'Default' },
    { value: 'autoEdit', label: 'Auto-Accept Edits' },
    { value: 'yolo', label: 'YOLO' },
  ],
  codex: [
    { value: 'default', label: 'Plan' },
    { value: 'autoEdit', label: 'Auto Edit' },
    { value: 'yolo', label: 'Full Auto' },
  ],
};

const agents = [
  { backend: 'opencode', name: 'opencode', label: 'OpenCode' },
  { backend: 'gemini', name: 'gemini', label: 'Gemini CLI' },
  { backend: 'codex', name: 'codex', label: 'Codex CLI' },
];

const server = new WebSocketServer({ host: '127.0.0.1', port });

server.on('connection', (socket, request) => {
  if (token && !isAuthorized(request.headers['sec-websocket-protocol'], token)) {
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
    const emit = (name, data) => {
      const push = { name, data };
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(push));
      else pushes.push(push);
    };
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
  await storeReady;
  const params = isRecord(data) ? data : {};
  if (key === 'runtime.get-status') return getRuntimeStatus();
  if (key === 'acp.get-available-agents') return { success: true, data: agents };
  if (key === 'acp.probe-model-info') return { success: true, data: { modelInfo: await getModelInfo(params.backend) } };
  if (key === 'conversation.ensure-runtime') return await ensureConversationRuntime(params);
  if (key === 'conversation.set-config-option') return await setConfigOption(params, emit);
  if (key === 'database.get-user-conversations') return listConversations(params.page, params.pageSize);
  if (key === 'database.get-conversation-messages') return messages.get(requiredString(params.conversation_id)) || [];
  if (key === 'conversation.get') return conversations.get(requiredString(params.conversation_id)) || null;
  if (key === 'conversation.list-artifacts') return listArtifacts(requiredString(params.conversation_id));
  if (key === 'conversation.update-artifact') return await updateArtifactStatus(params, emit);
  if (key === 'conversation.get-slash-commands') return await getSlashCommands(params);
  if (key === 'create-conversation') return await createConversation(params, emit);
  if (key === 'remove-conversation') return await removeConversation(requiredString(params.id), emit);
  if (key === 'update-conversation') return await updateConversation(requiredString(params.id), isRecord(params.updates) ? params.updates : {}, emit);
  if (key === 'chat.send.message') return await sendMessage(params, emit);
  if (key === 'chat.stop.stream') return stopStream(params);
  if (key === 'confirmation.list') return listConfirmations(requiredString(params.conversation_id));
  if (key === 'confirmation.confirm') return await confirmPendingPermission(params, emit);
  if (key === 'conversation.get-workspace') return await getWorkspaceTree(params);
  if (key === 'get-file-by-dir') return await getFileTreeByDir(params);
  if (key === 'read-file') return await readTextFile(requiredString(params.path));
  if (key === 'get-image-base64') return await readImageBase64(requiredString(params.path));
  throw new Error("No bridge handler registered for '" + key + "'");
}

async function getRuntimeStatus() {
  return {
    daemon: { version: '0.1.0-termux-bootstrap', startedAt, pid: process.pid },
    bootstrap: await readBootstrapStatus(),
    termux: { runCommandPermission: 'granted', allowExternalApps: 'unknown' },
    agents: await Promise.all(agents.map((agent) => probeAgent(agent.backend))),
  };
}

async function probeAgent(backend) {
  const exists = await commandExists(backend);
  if (!exists) return { backend, state: 'missing', detail: backend + ' command not found' };
  return { backend, state: 'ready', version: await readVersion(backend, ['--version']) };
}

async function loadStore() {
  try {
    const raw = await readFile(storePath, 'utf8');
    const store = JSON.parse(raw);
    if (!isRecord(store)) return;
    conversations.clear();
    messages.clear();
    artifacts.clear();

    if (Array.isArray(store.conversations)) {
      for (const conversation of store.conversations) {
        if (isRecord(conversation) && typeof conversation.id === 'string') {
          conversations.set(conversation.id, conversation);
        }
      }
    }

    if (isRecord(store.messages)) {
      for (const [conversationId, conversationMessages] of Object.entries(store.messages)) {
        messages.set(conversationId, Array.isArray(conversationMessages) ? conversationMessages : []);
      }
    }

    if (isRecord(store.artifacts)) {
      for (const [conversationId, conversationArtifacts] of Object.entries(store.artifacts)) {
        if (conversations.has(conversationId)) {
          artifacts.set(conversationId, Array.isArray(conversationArtifacts) ? conversationArtifacts : []);
        }
      }
    }

    for (const id of conversations.keys()) {
      if (!messages.has(id)) messages.set(id, []);
      if (!artifacts.has(id)) artifacts.set(id, []);
    }
  } catch (error) {
    if (!isNodeErrorCode(error, 'ENOENT')) {
      console.warn('Failed to load AICLIUI daemon store:', error instanceof Error ? error.message : error);
    }
  }
}

function saveStore() {
  saveQueue = saveQueue.then(writeStore, writeStore);
  return saveQueue;
}

async function writeStore() {
  await mkdir(dirname(storePath), { recursive: true });
  const tmpPath = storePath + '.tmp';
  const payload = JSON.stringify(
    {
      version: 1,
      conversations: Array.from(conversations.values()),
      messages: Object.fromEntries(messages.entries()),
      artifacts: Object.fromEntries(artifacts.entries()),
    },
    null,
    2,
  );
  await writeFile(tmpPath, payload, 'utf8');
  await rename(tmpPath, storePath);
}

function isNodeErrorCode(error, code) {
  return isRecord(error) && error.code === code;
}

async function readBootstrapStatus() {
  try {
    const raw = await readFile(bootstrapStatusPath, 'utf8');
    const values = Object.fromEntries(
      raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const index = line.indexOf('=');
          return index === -1 ? [line, ''] : [line.slice(0, index), line.slice(index + 1)];
        }),
    );
    return {
      phase: typeof values.phase === 'string' && values.phase ? values.phase : 'unknown',
      detail: typeof values.detail === 'string' && values.detail ? values.detail : undefined,
      updatedAt: Number.isFinite(Number(values.updatedAt)) ? Number(values.updatedAt) : undefined,
    };
  } catch (error) {
    if (!isNodeErrorCode(error, 'ENOENT')) {
      return { phase: 'error', detail: error instanceof Error ? error.message : 'Failed to read bootstrap status' };
    }
    return { phase: 'unknown' };
  }
}

async function getWorkspaceTree(params) {
  const workspace = resolveLocalPath(requiredString(params.workspace || params.path));
  const targetPath = resolveLocalPath(typeof params.path === 'string' ? params.path : workspace);
  const search = typeof params.search === 'string' ? params.search.trim() : '';
  const target = ensurePathInsideRoot(targetPath, workspace);
  const counter = { count: 0 };
  const rootNode = await readDirectoryNode(target, workspace, 0, search, counter);
  return rootNode ? [rootNode] : [];
}

async function getFileTreeByDir(params) {
  const root = resolveLocalPath(requiredString(params.root || params.dir));
  const dir = ensurePathInsideRoot(resolveLocalPath(requiredString(params.dir)), root);
  const counter = { count: 0 };
  const rootNode = await readDirectoryNode(dir, root, 0, '', counter);
  return rootNode ? [rootNode] : [];
}

async function readDirectoryNode(targetPath, rootPath, depth, search, counter) {
  if (counter.count >= MAX_WORKSPACE_TREE_ENTRIES) return null;

  let stats;
  try {
    stats = await stat(targetPath);
  } catch {
    return null;
  }
  if (!stats.isDirectory() && !stats.isFile()) return null;

  counter.count += 1;
  const node = {
    name: basename(targetPath) || targetPath,
    fullPath: targetPath,
    relativePath: normalizeRelativePath(relative(rootPath, targetPath)),
    isDir: stats.isDirectory(),
    isFile: stats.isFile(),
  };

  if (stats.isFile()) {
    return matchesSearch(node, search) ? node : search ? null : node;
  }

  const children = [];
  if (depth < MAX_WORKSPACE_TREE_DEPTH) {
    let entries = [];
    try {
      entries = await readdir(targetPath, { withFileTypes: true });
    } catch {
      entries = [];
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (IGNORED_ENTRY_NAMES.has(entry.name)) continue;
      if (counter.count >= MAX_WORKSPACE_TREE_ENTRIES) break;
      const childPath = join(targetPath, entry.name);
      const child = await readDirectoryNode(childPath, rootPath, depth + 1, search, counter);
      if (child) children.push(child);
    }
  }

  if (children.length > 0) {
    node.children = children;
  }

  if (!search || matchesSearch(node, search) || children.length > 0) return node;
  return null;
}

async function readTextFile(path) {
  const filePath = resolveLocalPath(path);
  const stats = await stat(filePath);
  if (!stats.isFile()) throw new Error('Path is not a file: ' + filePath);
  if (stats.size > MAX_TEXT_FILE_BYTES) {
    throw new Error('File is too large to preview: ' + filePath);
  }
  return await readFile(filePath, 'utf8');
}

async function readImageBase64(path) {
  const filePath = resolveLocalPath(path);
  const stats = await stat(filePath);
  if (!stats.isFile()) throw new Error('Path is not a file: ' + filePath);
  const buffer = await readFile(filePath);
  return 'data:' + imageMimeType(filePath) + ';base64,' + buffer.toString('base64');
}

function imageMimeType(path) {
  const ext = path.toLowerCase().split('.').pop() || '';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'bmp') return 'image/bmp';
  if (ext === 'avif') return 'image/avif';
  return 'image/png';
}

function fileMimeType(path) {
  const ext = path.toLowerCase().split('.').pop() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) return imageMimeType(path);
  if (ext === 'json') return 'application/json';
  if (ext === 'html' || ext === 'htm') return 'text/html';
  if (ext === 'css') return 'text/css';
  if (ext === 'csv') return 'text/csv';
  if (ext === 'md' || ext === 'markdown') return 'text/markdown';
  return 'text/plain';
}

function matchesSearch(node, search) {
  if (!search) return true;
  const lower = search.toLowerCase();
  return node.name.toLowerCase().includes(lower) || node.relativePath.toLowerCase().includes(lower);
}

function normalizeRelativePath(path) {
  return path === '' ? '' : path.split('\\').join('/');
}

function resolveLocalPath(path) {
  if (typeof path !== 'string' || !path.trim()) throw new Error('Expected non-empty path');
  if (path.includes('\0')) throw new Error('Path contains a null byte');
  return resolve(path.replace(/^~(?=\/|$)/, process.env.HOME || '.'));
}

function ensurePathInsideRoot(path, root) {
  const rel = relative(root, path);
  if (rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))) return path;
  throw new Error('Path is outside the workspace: ' + path);
}

async function createConversation(params, emit) {
  const now = Date.now();
  const id = randomId();
  const extra = isRecord(params.extra) ? params.extra : {};
  const conversation = {
    id,
    name: typeof params.name === 'string' && params.name.trim() ? params.name.trim() : 'New conversation',
    type: typeof params.type === 'string' ? params.type : 'acp',
    status: 'finished',
    runtime: idleRuntimeSummary('finished', 0),
    createTime: now,
    modifyTime: now,
    model: normalizeConversationModel(params.model, extra),
    extra,
  };
  conversations.set(id, conversation);
  messages.set(id, []);
  artifacts.set(id, []);
  await saveStore();
  emitListChanged(emit, conversation.id, 'created');
  return conversation;
}

function listConversations(page = 0, pageSize = 100) {
  const start = Math.max(0, Number(page) || 0) * Math.max(1, Number(pageSize) || 100);
  const end = start + Math.max(1, Number(pageSize) || 100);
  return Array.from(conversations.values()).sort((a, b) => b.modifyTime - a.modifyTime).slice(start, end);
}

function listArtifacts(conversationId) {
  if (!conversations.has(conversationId)) throw new Error("Conversation '" + conversationId + "' was not found");
  return [...(artifacts.get(conversationId) || [])].sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0));
}

async function updateArtifactStatus(params, emit) {
  const conversationId = requiredString(params.conversation_id);
  const artifactId = requiredString(params.artifact_id);
  const status = artifactStatusParam(params.status);
  const conversation = conversations.get(conversationId);
  if (!conversation) throw new Error("Conversation '" + conversationId + "' was not found");
  const list = artifacts.get(conversationId) || [];
  const index = list.findIndex((artifact) => isRecord(artifact) && artifact.id === artifactId);
  if (index === -1) throw new Error("Artifact '" + artifactId + "' was not found");

  const now = Date.now();
  const updated = { ...list[index], status, updated_at: now };
  const next = [...list];
  next[index] = updated;
  artifacts.set(conversationId, next);
  conversation.modifyTime = now;
  await saveStore();
  emit('conversation.artifact', updated);
  return updated;
}

async function getModelInfo(backend) {
  if (backend === 'opencode') return await getOpenCodeModelInfo();
  if (backend === 'codex') return getCodexModelInfo();
  if (backend !== 'gemini') return null;
  return {
    currentModelId: null,
    currentModelLabel: 'Default Gemini model',
    availableModels: geminiModels,
    canSwitch: geminiModels.length > 0,
    source: 'models',
  };
}

function getCodexModelInfo() {
  return {
    currentModelId: null,
    currentModelLabel: 'Default Codex model',
    availableModels: codexModels,
    canSwitch: codexModels.length > 0,
    source: 'models',
  };
}

async function getOpenCodeModelInfo() {
  try {
    const baseUrl = await ensureOpenCodeServer();
    const response = await requestOpenCodeJson(baseUrl, '/api/model', { method: 'GET' });
    const availableModels = normalizeOpenCodeModels(Array.isArray(response && response.data) ? response.data : []);
    return {
      currentModelId: null,
      currentModelLabel: 'Default OpenCode model',
      availableModels,
      canSwitch: availableModels.length > 0,
      source: 'models',
    };
  } catch (error) {
    console.warn('OpenCode model probe failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

async function ensureConversationRuntime(params) {
  const conversationId = requiredString(params.conversation_id);
  const conversation = conversations.get(conversationId);
  if (!conversation) throw new Error("Conversation '" + conversationId + "' was not found");
  const configOptions = await buildConversationConfigOptions(conversation);
  return {
    recovered: false,
    runtime: conversation.runtime || idleRuntimeSummary('finished', pendingConfirmationCount(conversationId)),
    config_options: configOptions,
    modelInfo: modelInfoFromConfigOptions(configOptions),
  };
}

async function setConfigOption(params, emit) {
  const conversationId = requiredString(params.conversation_id);
  const optionId = requiredString(params.option_id);
  const value = requiredString(params.value);
  const conversation = conversations.get(conversationId);
  if (!conversation) throw new Error("Conversation '" + conversationId + "' was not found");

  const configOptions = await buildConversationConfigOptions(conversation);
  const option = configOptions.find((candidate) => candidate.id === optionId);
  if (!option) throw new Error("Config option '" + optionId + "' was not found");
  const selected = option.options.find((candidate) => candidate.value === value);
  if (option.options.length > 0 && !selected) {
    throw new Error("Config option '" + optionId + "' does not support value '" + value + "'");
  }

  applyConfigOption(conversation, option, value, selected);
  conversation.modifyTime = Date.now();
  await saveStore();
  emitListChanged(emit, conversationId, 'updated');
  const nextConfigOptions = await buildConversationConfigOptions(conversation);
  return {
    confirmation: 'observed',
    config_options: nextConfigOptions,
    modelInfo: modelInfoFromConfigOptions(nextConfigOptions),
  };
}

async function buildConversationConfigOptions(conversation) {
  const extra = isRecord(conversation.extra) ? conversation.extra : {};
  const backend = typeof extra.backend === 'string' ? extra.backend : conversation.type;
  const configOptions = [];
  const modelInfo = await getModelInfo(backend);
  if (modelInfo && modelInfo.canSwitch && Array.isArray(modelInfo.availableModels) && modelInfo.availableModels.length > 0) {
    configOptions.push({
      id: 'model',
      name: 'Model',
      label: 'Model',
      category: 'model',
      type: 'select',
      option_type: 'select',
      current_value: typeof extra.currentModelId === 'string' ? extra.currentModelId : modelInfo.currentModelId || null,
      options: modelInfo.availableModels.map((model) => ({
        value: model.id,
        label: model.label,
      })),
    });
  }

  const modes = Array.isArray(agentModes[backend]) ? agentModes[backend] : [];
  if (modes.length > 0) {
    configOptions.push({
      id: 'mode',
      name: 'Permission',
      label: 'Permission',
      category: 'mode',
      type: 'select',
      option_type: 'select',
      current_value: typeof extra.sessionMode === 'string' ? extra.sessionMode : modes[0].value,
      options: modes.map((mode) => ({
        value: mode.value,
        label: mode.label,
      })),
    });
  }
  return configOptions;
}

function modelInfoFromConfigOptions(configOptions) {
  const option = configOptions.find((candidate) => candidate.category === 'model' || candidate.id === 'model');
  if (!option) return null;
  const currentModelId = option.current_value || null;
  const currentModel = option.options.find((candidate) => candidate.value === currentModelId);
  return {
    currentModelId,
    currentModelLabel: currentModel ? currentModel.label || currentModel.name || currentModelId : currentModelId,
    availableModels: option.options.map((candidate) => ({
      id: candidate.value,
      label: candidate.label || candidate.name || candidate.value,
    })),
    canSwitch: option.options.length > 0,
    source: 'configOption',
    configOptionId: option.id,
  };
}

function applyConfigOption(conversation, option, value, selected) {
  if (!isRecord(conversation.extra)) conversation.extra = {};
  const category = option.category || option.id;
  if (category === 'model' || option.id === 'model') {
    const label = (selected && (selected.label || selected.name)) || value;
    conversation.extra.currentModelId = value;
    conversation.extra.currentModelLabel = label;
    conversation.model = { id: value, useModel: label };
    return;
  }
  if (category === 'mode' || option.id === 'mode') {
    conversation.extra.sessionMode = value;
  }
}

async function getSlashCommands(params) {
  const conversation = conversations.get(requiredString(params.conversation_id));
  if (!conversation || !isRecord(conversation.extra)) return [];
  const backend = typeof conversation.extra.backend === 'string' ? conversation.extra.backend : 'opencode';
  if (backend !== 'opencode') return [];

  try {
    const baseUrl = await ensureOpenCodeServer();
    const workspace = typeof conversation.extra.workspace === 'string' ? conversation.extra.workspace : undefined;
    return await fetchOpenCodeCommands(baseUrl, workspace);
  } catch (fallbackError) {
    console.warn(
      'OpenCode command probe failed:',
      fallbackError instanceof Error ? fallbackError.message : fallbackError,
    );
    return [];
  }
}

async function fetchOpenCodeCommands(baseUrl, workspace, signal) {
  try {
    const response = await requestOpenCodeJson(baseUrl, openCodeCommandListPath(workspace), { method: 'GET', signal });
    return extractOpenCodeCommands(response);
  } catch {
    const response = await requestOpenCodeJson(baseUrl, legacyOpenCodeCommandListPath(workspace), { method: 'GET', signal });
    return extractOpenCodeCommands(response);
  }
}

function openCodeCommandListPath(workspace) {
  if (!workspace) return '/api/command';
  return '/api/command?location=' + encodeURIComponent(JSON.stringify({ directory: workspace }));
}

function legacyOpenCodeCommandListPath(workspace) {
  if (!workspace) return '/command';
  return '/command?directory=' + encodeURIComponent(workspace);
}

function extractOpenCodeCommands(value) {
  const rawCommands = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.data) ? value.data : [];
  return rawCommands
    .filter(isRecord)
    .map((command) => {
      const name = stringValue(command.name) || stringValue(command.command);
      const template = stringValue(command.template);
      const description = stringValue(command.description) || template;
      if (!name || !description) return null;
      return {
        command: name,
        description,
        ...(template ? { hint: template } : {}),
      };
    })
    .filter(Boolean);
}

function normalizeOpenCodeModels(models) {
  return models
    .filter((model) => isRecord(model) && model.enabled !== false && typeof model.id === 'string' && typeof model.providerID === 'string')
    .map((model) => ({
      id: model.providerID + '/' + model.id,
      label: (typeof model.name === 'string' && model.name ? model.name : model.id) + ' (' + model.providerID + ')',
    }));
}

function normalizeConversationModel(model, extra) {
  if (isRecord(model) && (model.id || model.useModel)) {
    return {
      id: typeof model.id === 'string' ? model.id : '',
      useModel: typeof model.useModel === 'string' ? model.useModel : '',
    };
  }
  const currentModelId = typeof extra.currentModelId === 'string' ? extra.currentModelId : '';
  const currentModelLabel = typeof extra.currentModelLabel === 'string' ? extra.currentModelLabel : '';
  return currentModelId ? { id: currentModelId, useModel: currentModelLabel || modelLabel(currentModelId, extra.backend) } : { id: '', useModel: '' };
}

function modelLabel(modelId, backend) {
  if (backend === 'opencode' && modelId.includes('/')) return modelId.split('/').slice(1).join('/');
  if (backend === 'codex') return codexModels.find((model) => model.id === modelId)?.label || modelId;
  return geminiModels.find((model) => model.id === modelId)?.label || modelId;
}

function runningRuntimeSummary(status, turnId, pendingConfirmationCount) {
  return {
    state: status,
    can_send_message: false,
    has_task: true,
    task_status: status,
    is_processing: true,
    pending_confirmations: pendingConfirmationCount,
    turn_id: turnId,
  };
}

function idleRuntimeSummary(status, pendingConfirmationCount) {
  return {
    state: 'idle',
    can_send_message: true,
    has_task: false,
    task_status: status,
    is_processing: false,
    pending_confirmations: pendingConfirmationCount,
    turn_id: null,
  };
}

function buildTurnCompletedEvent({ conversation, conversationId, turnId, backend, assistantMessage }) {
  const runtime = conversation.runtime || idleRuntimeSummary('finished', 0);
  const extra = isRecord(conversation.extra) ? conversation.extra : {};
  const model = isRecord(conversation.model) ? conversation.model : {};
  return {
    session_id: conversationId,
    turn_id: turnId,
    status: conversation.status || 'finished',
    state: turnStateFromRuntime(runtime),
    detail: '',
    can_send_message: runtime.can_send_message,
    runtime,
    workspace: typeof extra.workspace === 'string' ? extra.workspace : '',
    model: {
      platform: backend,
      name: (typeof extra.agentName === 'string' && extra.agentName) || runtimeDisplayName(backend),
      use_model:
        (typeof model.useModel === 'string' && model.useModel) ||
        (typeof extra.currentModelLabel === 'string' && extra.currentModelLabel) ||
        (typeof extra.currentModelId === 'string' && extra.currentModelId) ||
        '',
    },
    last_message: {
      id: assistantMessage.id,
      type: assistantMessage.type,
      content: assistantMessage.content,
      status: 'finish',
      created_at: assistantMessage.createdAt,
    },
  };
}

function buildUserCreatedEvent(message) {
  return {
    conversation_id: message.conversation_id,
    msg_id: message.msg_id,
    content: message.content.content,
    position: 'right',
    status: 'finish',
    hidden: false,
    created_at: message.createdAt,
  };
}

function turnStateFromRuntime(runtime) {
  if (runtime.state === 'idle') return 'ai_waiting_input';
  if (runtime.state === 'waiting_confirmation') return 'ai_waiting_confirmation';
  if (runtime.state === 'starting') return 'initializing';
  if (runtime.state === 'cancelling') return 'stopped';
  if (runtime.state === 'running') return 'ai_generating';
  return 'unknown';
}

function pendingConfirmationCount(conversationId) {
  let count = 0;
  for (const record of pendingConfirmations.values()) {
    if (record.conversationId === conversationId) count += 1;
  }
  return count;
}

function parseModelOptions(raw, fallback) {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  const models = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [id, label] = item.split(':');
      return { id: id.trim(), label: (label || id).trim() };
    })
    .filter((item) => item.id);
  return models.length ? models : fallback;
}

async function sendMessage(params, emit) {
  const conversationId = requiredString(params.conversation_id);
  const input = requiredString(params.input);
  const conversation = conversations.get(conversationId);
  if (!conversation) throw new Error("Conversation '" + conversationId + "' was not found");
  stopActiveRun(conversationId);
  const userMsgId = typeof params.msg_id === 'string' ? params.msg_id : randomId();
  const assistantMsgId = 'assistant_' + userMsgId;
  const run = createActiveRun(conversationId, assistantMsgId);
  const backend = typeof conversation.extra.backend === 'string' ? conversation.extra.backend : 'opencode';
  const workspace =
    typeof conversation.extra.workspace === 'string' && conversation.extra.workspace
      ? conversation.extra.workspace
      : process.env.AICLIUI_WORKSPACE || process.env.HOME + '/.aicliui/workspaces/default';
  const model = typeof conversation.extra.currentModelId === 'string' ? conversation.extra.currentModelId : undefined;
  const approvalMode = typeof conversation.extra.sessionMode === 'string' ? conversation.extra.sessionMode : undefined;
  const selectedFiles = normalizeSelectedFiles(params.files, conversation.extra.defaultFiles, workspace);
  const acceptedRuntime = runningRuntimeSummary('running', assistantMsgId, pendingConfirmationCount(conversationId));
  let assistantContent = '';
  let assistantContentStreamed = false;
  const emitAssistantContent = (content) => {
    if (!content) return;
    assistantContent += content;
    assistantContentStreamed = true;
    emit('chat.response.stream', {
      type: 'content',
      msg_id: assistantMsgId,
      conversation_id: conversationId,
      data: { content },
    });
  };
  const emitAssistantTool = (tool) => {
    if (!tool) return;
    upsertToolGroupMessage(conversationId, assistantMsgId, tool);
    emit('chat.response.stream', {
      type: 'tool_group',
      msg_id: assistantMsgId,
      conversation_id: conversationId,
      data: [tool],
    });
  };
  const emitAssistantCodexTool = (tool) => {
    if (!tool) return;
    upsertCodexToolCallMessage(conversationId, assistantMsgId, tool);
    emit('chat.response.stream', {
      type: 'codex_tool_call',
      msg_id: assistantMsgId,
      conversation_id: conversationId,
      data: tool,
    });
  };
  const emitAssistantPlan = (plan) => {
    if (!plan) return;
    upsertCodexPlanMessage(conversationId, assistantMsgId, plan);
    emit('chat.response.stream', {
      type: 'plan',
      msg_id: assistantMsgId,
      conversation_id: conversationId,
      data: plan,
    });
  };
  const emitAssistantPermission = (confirmation) => {
    if (!confirmation || !confirmation.id) return;
    conversation.status = 'waiting_confirmation';
    conversation.runtime = runningRuntimeSummary('waiting_confirmation', assistantMsgId, pendingConfirmationCount(conversationId));
    conversation.modifyTime = Date.now();
    void saveStore();
    emit('confirmation.add', confirmation);
  };
  const emitAssistantPermissionResolved = (confirmationId) => {
    if (!confirmationId) return;
    pendingConfirmations.delete(confirmationId);
    if (activeRuns.get(conversationId) === run) {
      conversation.status = 'running';
      conversation.runtime = runningRuntimeSummary('running', assistantMsgId, pendingConfirmationCount(conversationId));
      conversation.modifyTime = Date.now();
      void saveStore();
    }
    emit('confirmation.remove', { conversation_id: conversationId, id: confirmationId });
  };
  activeRuns.set(conversationId, run);
  conversation.status = 'running';
  conversation.runtime = acceptedRuntime;
  conversation.modifyTime = Date.now();

  const userMessage = await addTextMessage(conversationId, userMsgId, 'right', input);
  emit('message.userCreated', buildUserCreatedEvent(userMessage));
  emit('chat.response.stream', { type: 'start', msg_id: assistantMsgId, conversation_id: conversationId, data: null });

  void (async () => {
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
      const result = await sendOpenCodePrompt({
        conversationId,
        msgId: assistantMsgId,
        input,
        workspace,
        model,
        agent: approvalMode,
        files: selectedFiles,
        signal: run.signal,
        onContent: emitAssistantContent,
        onTool: emitAssistantTool,
        onPermission: emitAssistantPermission,
        onPermissionResolved: emitAssistantPermissionResolved,
      });
      emit('chat.response.stream', {
        type: 'thought',
        msg_id: assistantMsgId,
        conversation_id: conversationId,
        data: { subject: 'OpenCode', description: 'session ' + result.sessionId },
      });
      if (!assistantContent) assistantContent = result.text || 'OpenCode completed, but no assistant text was returned from the session context.';
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
      await sendGeminiPrompt({
        input,
        workspace,
        model,
        approvalMode,
        files: selectedFiles,
        signal: run.signal,
        onContent: emitAssistantContent,
      });
      if (!assistantContent) assistantContent = 'Gemini CLI completed, but no assistant text was returned.';
    } else if (backend === 'codex') {
      if (!(await commandExists('codex'))) {
        throw new Error('codex command not found. The bootstrap tried npm install -g @openai/codex@latest; check Termux npm output in ~/.aicliui/logs/daemon.log.');
      }
      emit('chat.response.stream', {
        type: 'thought',
        msg_id: assistantMsgId,
        conversation_id: conversationId,
        data: { subject: 'Codex CLI', description: buildCodexCommandDescription({ input, model, approvalMode }) },
      });
      await sendCodexPrompt({
        input,
        workspace,
        model,
        approvalMode,
        files: selectedFiles,
        signal: run.signal,
        onContent: emitAssistantContent,
        onTool: emitAssistantCodexTool,
        onPlan: emitAssistantPlan,
      });
      if (!assistantContent) assistantContent = 'Codex CLI completed, but no assistant text was returned.';
    } else {
      throw new Error("Agent backend '" + backend + "' is not supported by this Termux daemon.");
    }
  } catch (error) {
    assistantContent =
      run.signal.aborted || isAbortError(error)
        ? 'Generation stopped.'
        : runtimeDisplayName(backend) + ' runtime failed: ' + formatRuntimeErrorMessage(error);
  } finally {
    const activeRun = activeRuns.get(conversationId);
    if (activeRun === run) activeRuns.delete(conversationId);
    if (activeRun === run || activeRun === undefined) {
      clearConfirmationsForConversation(conversationId, emit);
      conversation.status = 'finished';
      conversation.runtime = idleRuntimeSummary('finished', pendingConfirmationCount(conversationId));
      conversation.modifyTime = Date.now();
      await saveStore();
    }
  }

  const assistantMessage = await addTextMessage(conversationId, assistantMsgId, 'left', assistantContent);
  if (!assistantContentStreamed) {
    emit('chat.response.stream', {
      type: 'content',
      msg_id: assistantMsgId,
      conversation_id: conversationId,
      data: { content: assistantContent },
    });
  }
  emit('chat.response.stream', { type: 'finish', msg_id: assistantMsgId, conversation_id: conversationId, data: null });
  emit('turn.completed', buildTurnCompletedEvent({ conversation, conversationId, turnId: assistantMsgId, backend, assistantMessage }));
  })().catch((error) => {
    console.warn('AICLIUI detached send failed:', error instanceof Error ? error.message : error);
  });

  return {
    success: true,
    msg_id: userMessage.msg_id,
    turn_id: assistantMsgId,
    runtime: acceptedRuntime,
  };
}

function createActiveRun(conversationId, turnId) {
  const controller = new AbortController();
  return {
    conversationId,
    turnId,
    signal: controller.signal,
    cancel() {
      controller.abort(new Error('Generation stopped by user'));
    },
  };
}

function stopActiveRun(conversationId) {
  const run = activeRuns.get(conversationId);
  if (!run) return false;
  run.cancel();
  activeRuns.delete(conversationId);
  return true;
}

function stopStream(params) {
  const conversationId = requiredString(params.conversation_id);
  const runtime = idleRuntimeSummary('finished', pendingConfirmationCount(conversationId));
  if (!stopActiveRun(conversationId)) {
    const conversation = conversations.get(conversationId);
    return { success: true, stopped: false, runtime: conversation ? conversation.runtime || runtime : runtime };
  }
  const conversation = conversations.get(conversationId);
  if (conversation) {
    conversation.status = 'finished';
    conversation.runtime = runtime;
    conversation.modifyTime = Date.now();
    void saveStore();
  }
  return { success: true, stopped: true, runtime };
}

async function sendOpenCodePrompt({
  conversationId,
  msgId,
  input,
  workspace,
  model,
  agent,
  files,
  signal,
  onContent,
  onTool,
  onPermission,
  onPermissionResolved,
}) {
  const baseUrl = await ensureOpenCodeServer();
  const attachments = await buildOpenCodeFileAttachments(files, workspace);
  const modelRef = parseOpenCodeModelRef(model);
  const agentId = parseOpenCodeAgent(agent);
  const sessionId = await ensureOpenCodeSession({ conversationId, workspace, modelRef, agentId, signal });
  const slashCommand = await findOpenCodeSlashCommand(baseUrl, workspace, input, signal);
  const eventStream = subscribeOpenCodeSessionEvents(baseUrl, workspace, sessionId, signal, {
    onContent,
    onTool,
    onPermission: (request) => {
      const confirmation = toOpenCodeConfirmation(request, conversationId, msgId, baseUrl);
      if (confirmation) onPermission(confirmation);
    },
    onPermissionResolved,
  });

  try {
    await eventStream.ready;
    if (slashCommand) {
      const commandParts = await buildOpenCodeCommandParts(files, workspace);
      await requestOpenCodeJson(baseUrl, openCodeCommandSendPath(sessionId, workspace), {
        method: 'POST',
        signal,
        body: JSON.stringify({
          command: slashCommand.command,
          arguments: slashCommand.arguments,
          ...(model ? { model } : {}),
          ...(agentId ? { agent: agentId } : {}),
          ...(commandParts.length ? { parts: commandParts } : {}),
        }),
      });
    } else {
      await requestOpenCodeJson(baseUrl, '/api/session/' + encodeURIComponent(sessionId) + '/prompt', {
        method: 'POST',
        signal,
        body: JSON.stringify({
          prompt: {
            text: input,
            files: attachments,
            agents: [],
          },
        }),
      });
    }
    await requestOpenCodeJson(baseUrl, '/api/session/' + encodeURIComponent(sessionId) + '/wait', { method: 'POST', signal });
  } finally {
    eventStream.close();
    await eventStream.done;
  }
  const context = await requestOpenCodeJson(baseUrl, '/api/session/' + encodeURIComponent(sessionId) + '/context', {
    method: 'GET',
    signal,
  });

  return {
    sessionId,
    text: extractOpenCodeAssistantText(Array.isArray(context && context.data) ? context.data : []),
  };
}

async function ensureOpenCodeSession({ conversationId, workspace, modelRef, agentId, signal }) {
  const cached = openCodeSessions.get(conversationId);
  if (cached) return cached;

  const session = await requestOpenCodeJson(await ensureOpenCodeServer(), '/api/session', {
    method: 'POST',
    signal,
    body: JSON.stringify({
      ...(workspace ? { location: { directory: workspace } } : {}),
      ...(modelRef ? { model: modelRef } : {}),
      ...(agentId ? { agent: agentId } : {}),
    }),
  });
  const sessionId = session && session.data && typeof session.data.id === 'string' ? session.data.id : '';
  if (!sessionId) throw new Error('OpenCode session.create returned no session id');
  openCodeSessions.set(conversationId, sessionId);
  return sessionId;
}

function openCodeCommandSendPath(sessionId, workspace) {
  const path = '/session/' + encodeURIComponent(sessionId) + '/command';
  return workspace ? path + '?directory=' + encodeURIComponent(workspace) : path;
}

async function findOpenCodeSlashCommand(baseUrl, workspace, input, signal) {
  const slashCommand = parseOpenCodeSlashCommand(input);
  if (!slashCommand) return null;
  try {
    const commands = await fetchOpenCodeCommands(baseUrl, workspace, signal);
    return commands.some((command) => command.command === slashCommand.command) ? slashCommand : null;
  } catch {
    return null;
  }
}

function parseOpenCodeSlashCommand(input) {
  const trimmed = typeof input === 'string' ? input.trim() : '';
  const match = trimmed.match(/^\/([a-zA-Z0-9_-]+)(?:\s+(.*))?$/);
  if (!match) return null;
  return {
    command: match[1],
    arguments: match[2] || '',
  };
}

function parseOpenCodeModelRef(model) {
  if (typeof model !== 'string' || !model.includes('/')) return null;
  const index = model.indexOf('/');
  const providerID = model.slice(0, index).trim();
  const id = model.slice(index + 1).trim();
  return providerID && id ? { providerID, id } : null;
}

function parseOpenCodeAgent(agent) {
  return agent === 'build' || agent === 'plan' ? agent : null;
}

function subscribeOpenCodeSessionEvents(baseUrl, workspace, sessionId, signal, handlers) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(signal.reason || new Error('OpenCode event stream aborted'));
  if (signal?.aborted) abortFromParent();
  else signal?.addEventListener('abort', abortFromParent, { once: true });

  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const done = (async () => {
    try {
      const response = await fetch(
        baseUrl + '/api/event?location%5Bdirectory%5D=' + encodeURIComponent(workspace),
        { method: 'GET', signal: controller.signal },
      );
      resolveReady();
      if (!response.ok || !response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const extractTextDelta = createOpenCodeTextDeltaExtractor(sessionId);
      const extractToolUpdate = createOpenCodeToolUpdateExtractor(sessionId);
      const extractPermissionEvent = createOpenCodePermissionEventExtractor(sessionId);
      const parse = createSseParser((event) => {
        const text = extractTextDelta(event);
        if (text) handlers.onContent(text);
        const tool = extractToolUpdate(event);
        if (tool) handlers.onTool(tool);
        const permissionEvent = extractPermissionEvent(event);
        if (permissionEvent?.type === 'asked') handlers.onPermission(permissionEvent.request);
        if (permissionEvent?.type === 'resolved') handlers.onPermissionResolved(permissionEvent.requestId);
      });
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        parse(decoder.decode(next.value, { stream: true }));
      }
      parse(decoder.decode());
    } catch (error) {
      resolveReady();
      if (!controller.signal.aborted && !signal?.aborted) {
        console.warn('OpenCode event stream failed:', error instanceof Error ? error.message : error);
      }
    } finally {
      signal?.removeEventListener('abort', abortFromParent);
    }
  })();

  return {
    ready,
    done,
    close() {
      controller.abort(new Error('OpenCode event stream closed'));
    },
  };
}

function createSseParser(onEvent) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk;
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';
    for (const block of blocks) parseSseEventBlock(block, onEvent);
  };
}

function parseSseEventBlock(block, onEvent) {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trimStart())
    .join('\n');
  if (!data) return;
  try {
    onEvent(JSON.parse(data));
  } catch {
    // Ignore malformed event frames.
  }
}

function createOpenCodeTextDeltaExtractor(sessionId) {
  const textByPartId = new Map();
  return (event) => extractOpenCodeEventTextDelta(event, sessionId, textByPartId);
}

function extractOpenCodeEventTextDelta(event, sessionId, textByPartId) {
  if (!isRecord(event)) return '';
  const payload = isRecord(event.payload) ? event.payload : event;
  const type = typeof payload.type === 'string' ? payload.type : '';
  const data = isRecord(payload.data) ? payload.data : isRecord(payload.properties) ? payload.properties : {};
  if (type === 'session.next.text.delta' && data.sessionID === sessionId && typeof data.delta === 'string') {
    return data.delta;
  }
  if (type !== 'message.part.updated') return '';
  const part = isRecord(data.part) ? data.part : {};
  const partSessionId = typeof data.sessionID === 'string' ? data.sessionID : part.sessionID;
  if (partSessionId !== sessionId || part.type !== 'text') return '';
  if (typeof data.delta === 'string') return data.delta;

  const partId = typeof part.id === 'string' ? part.id : '';
  if (!partId || typeof part.text !== 'string') return '';
  const previous = textByPartId.get(partId) || '';
  textByPartId.set(partId, part.text);
  return part.text.startsWith(previous) ? part.text.slice(previous.length) : '';
}

function createOpenCodeToolUpdateExtractor(sessionId) {
  return (event) => extractOpenCodeToolUpdate(event, sessionId);
}

function extractOpenCodeToolUpdate(event, sessionId) {
  if (!isRecord(event)) return null;
  const payload = isRecord(event.payload) ? event.payload : event;
  const type = typeof payload.type === 'string' ? payload.type : '';
  const data = isRecord(payload.data) ? payload.data : isRecord(payload.properties) ? payload.properties : {};
  if (type !== 'message.part.updated') return null;
  const part = isRecord(data.part) ? data.part : {};
  const partSessionId = typeof data.sessionID === 'string' ? data.sessionID : part.sessionID;
  if (partSessionId !== sessionId || part.type !== 'tool') return null;

  const state = isRecord(part.state) ? part.state : {};
  const callId = typeof part.callID === 'string' ? part.callID : typeof part.id === 'string' ? part.id : '';
  if (!callId) return null;

  return {
    callId,
    name: typeof part.tool === 'string' && part.tool ? part.tool : 'tool',
    description: openCodeToolTitle(part, state),
    status: openCodeToolStatus(state.status),
    resultDisplay: openCodeToolResultDisplay(state),
  };
}

function createOpenCodePermissionEventExtractor(sessionId) {
  return (event) => {
    const request = extractOpenCodePermissionAsked(event, sessionId);
    if (request) return { type: 'asked', request };
    const requestId = extractOpenCodePermissionResolved(event, sessionId);
    if (requestId) return { type: 'resolved', requestId };
    return null;
  };
}

function extractOpenCodePermissionAsked(event, sessionId) {
  if (!isRecord(event)) return null;
  const payload = isRecord(event.payload) ? event.payload : event;
  const type = typeof payload.type === 'string' ? payload.type : '';
  const data = isRecord(payload.data) ? payload.data : isRecord(payload.properties) ? payload.properties : {};
  if (type !== 'permission.v2.asked' && type !== 'permission.asked') return null;
  return data.sessionID === sessionId && typeof data.id === 'string' ? data : null;
}

function extractOpenCodePermissionResolved(event, sessionId) {
  if (!isRecord(event)) return null;
  const payload = isRecord(event.payload) ? event.payload : event;
  const type = typeof payload.type === 'string' ? payload.type : '';
  const data = isRecord(payload.data) ? payload.data : isRecord(payload.properties) ? payload.properties : {};
  if (type !== 'permission.v2.replied' && type !== 'permission.replied') return null;
  if (data.sessionID !== sessionId) return null;
  return typeof data.requestID === 'string' ? data.requestID : typeof data.id === 'string' ? data.id : '';
}

function toOpenCodeConfirmation(request, conversationId, msgId, baseUrl) {
  const requestId = typeof request.id === 'string' ? request.id : '';
  const sessionId = typeof request.sessionID === 'string' ? request.sessionID : '';
  if (!requestId || !sessionId) return null;

  const action = typeof request.action === 'string' && request.action ? request.action : stringValue(request.permission) || 'tool';
  const resources = Array.isArray(request.resources)
    ? request.resources.filter((item) => typeof item === 'string' && item)
    : Array.isArray(request.patterns)
      ? request.patterns.filter((item) => typeof item === 'string' && item)
      : [];
  const source = isRecord(request.source) ? request.source : isRecord(request.tool) ? request.tool : {};
  const callId = stringValue(source.callID) || requestId;
  const confirmation = {
    id: requestId,
    msg_id: msgId,
    conversation_id: conversationId,
    title: 'OpenCode permission',
    action,
    description: openCodePermissionDescription(action, resources, request.metadata),
    call_id: callId,
    callId,
    options: [
      { label: 'Allow once', value: 'once' },
      { label: 'Allow always', value: 'always' },
      { label: 'Reject', value: 'reject' },
    ],
  };
  pendingConfirmations.set(requestId, {
    conversationId,
    sessionId,
    requestId,
    callId,
    baseUrl,
    confirmation,
  });
  return confirmation;
}

function openCodePermissionDescription(action, resources, metadata) {
  const lines = ['Action: ' + action];
  if (resources.length) lines.push('Resources:', ...resources.map((item) => '- ' + item));
  if (isRecord(metadata) && Object.keys(metadata).length) {
    lines.push('Metadata: ' + JSON.stringify(metadata));
  }
  return lines.join('\n');
}

function listConfirmations(conversationId) {
  return Array.from(pendingConfirmations.values())
    .filter((record) => record.conversationId === conversationId)
    .map((record) => record.confirmation);
}

function clearConfirmationsForConversation(conversationId, emit) {
  for (const [confirmationId, record] of pendingConfirmations) {
    if (record.conversationId !== conversationId) continue;
    pendingConfirmations.delete(confirmationId);
    emit('confirmation.remove', { conversation_id: conversationId, id: confirmationId });
  }
}

async function confirmPendingPermission(params, emit) {
  const confirmationId = requiredString(params.msg_id || params.id);
  const record = pendingConfirmations.get(confirmationId);
  if (!record) {
    return {
      success: false,
      error: { code: 'CONFIRMATION_NOT_FOUND', message: 'Confirmation not found: ' + confirmationId },
    };
  }
  const reply = normalizeOpenCodePermissionReply(params.data);
  if (!reply) {
    return {
      success: false,
      error: { code: 'INVALID_CONFIRMATION_REPLY', message: 'Unsupported confirmation reply' },
    };
  }

  await replyOpenCodePermission(record, reply);
  pendingConfirmations.delete(confirmationId);
  const conversation = conversations.get(record.conversationId);
  if (conversation && activeRuns.has(record.conversationId)) {
    conversation.status = 'running';
    conversation.runtime = runningRuntimeSummary(
      'running',
      activeRuns.get(record.conversationId)?.turnId || null,
      pendingConfirmationCount(record.conversationId),
    );
    conversation.modifyTime = Date.now();
    void saveStore();
  }
  emit('confirmation.remove', { conversation_id: record.conversationId, id: confirmationId });
  return { success: true };
}

async function replyOpenCodePermission(record, reply) {
  try {
    await requestOpenCodeJson(
      record.baseUrl,
      '/api/session/' + encodeURIComponent(record.sessionId) + '/permission/' + encodeURIComponent(record.requestId) + '/reply',
      {
        method: 'POST',
        body: JSON.stringify({ reply }),
      },
    );
  } catch (error) {
    await requestOpenCodeJson(
      record.baseUrl,
      '/api/session/' + encodeURIComponent(record.sessionId) + '/permissions/' + encodeURIComponent(record.requestId),
      {
        method: 'POST',
        body: JSON.stringify({ response: reply }),
      },
    );
  }
}

function normalizeOpenCodePermissionReply(value) {
  if (value === 'once' || value === 'always' || value === 'reject') return value;
  if (value === 'proceed_once' || value === 'allow' || value === 'approve' || value === 'yes') return 'once';
  if (value === 'proceed_always' || value === 'proceed_always_tool' || value === 'proceed_always_server') return 'always';
  if (value === 'cancel' || value === 'deny' || value === 'no') return 'reject';
  return null;
}

function openCodeToolTitle(part, state) {
  if (typeof state.title === 'string' && state.title) return state.title;
  if (isRecord(state.input)) {
    const values = Object.values(state.input)
      .filter((value) => typeof value === 'string' && value.trim())
      .slice(0, 2);
    if (values.length) return values.join(' ');
  }
  return typeof part.tool === 'string' && part.tool ? part.tool : 'tool';
}

function openCodeToolStatus(status) {
  if (status === 'completed') return 'Success';
  if (status === 'error') return 'Error';
  if (status === 'pending') return 'Pending';
  return 'Executing';
}

function openCodeToolResultDisplay(state) {
  if (typeof state.output === 'string' && state.output) return state.output;
  if (typeof state.error === 'string' && state.error) return state.error;
  if (Array.isArray(state.content) && state.content.length) return JSON.stringify(state.content);
  return '';
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

function buildCodexCommandDescription({ input, model, approvalMode }) {
  return buildCodexArgs({ input, model, approvalMode })
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(' ');
}

function buildCodexArgs({ input, model, approvalMode }) {
  const args = ['exec', '--json', '--skip-git-repo-check'];
  if (model) args.push('--model', model);
  if (approvalMode === 'yolo') {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  } else {
    args.push('--sandbox', approvalMode === 'autoEdit' ? 'workspace-write' : 'read-only');
  }
  args.push(input);
  return args;
}

async function sendGeminiPrompt({ input, workspace, model, approvalMode, files, signal, onContent }) {
  const prompt = appendSelectedFilesToPrompt(input, files, workspace);
  const args = buildGeminiArgs({ input: prompt, model, approvalMode }).slice(1);
  let lineBuffer = '';
  let content = '';
  const emitContent = (text) => {
    if (!text) return;
    content += text;
    onContent(text);
  };
  const handleStdout = (chunk) => {
    const lines = (lineBuffer + chunk.toString()).split(/\r?\n/);
    lineBuffer = lines.pop() || '';
    for (const line of lines) {
      const text = parseGeminiStreamJsonLine(line);
      emitContent(text);
    }
  };
  const result = await runProcess('gemini', args, {
    cwd: workspace || process.env.HOME || process.cwd(),
    signal,
    onStdout: handleStdout,
  });
  emitContent(parseGeminiStreamJsonLine(lineBuffer));
  if (content) return content;

  const fallback = extractGeminiStreamText(result.stdout) || result.stdout.trim();
  emitContent(fallback);
  return fallback;
}

async function sendCodexPrompt({ input, workspace, model, approvalMode, files, signal, onContent, onTool, onPlan }) {
  const prompt = appendSelectedFilesToPrompt(input, files, workspace);
  const args = buildCodexArgs({ input: prompt, model, approvalMode });
  let lineBuffer = '';
  let content = '';
  const emitContent = (text) => {
    if (!text) return;
    content += text;
    onContent(text);
  };
  const handleStdout = (chunk) => {
    const lines = (lineBuffer + chunk.toString()).split(/\r?\n/);
    lineBuffer = lines.pop() || '';
    for (const line of lines) {
      const event = parseCodexJsonEvent(line);
      emitContent(extractCodexEventText(event));
      const tool = extractCodexToolUpdate(event);
      if (tool) onTool?.(tool);
      const plan = extractCodexPlanUpdate(event);
      if (plan) onPlan?.(plan);
    }
  };
  const result = await runProcess('codex', args, {
    cwd: workspace || process.env.HOME || process.cwd(),
    signal,
    onStdout: handleStdout,
  });
  const trailingEvent = parseCodexJsonEvent(lineBuffer);
  emitContent(extractCodexEventText(trailingEvent));
  const trailingTool = extractCodexToolUpdate(trailingEvent);
  if (trailingTool) onTool?.(trailingTool);
  const trailingPlan = extractCodexPlanUpdate(trailingEvent);
  if (trailingPlan) onPlan?.(trailingPlan);
  if (content) return content;

  const fallback = extractCodexJsonText(result.stdout) || result.stdout.trim();
  emitContent(fallback);
  return fallback;
}

function normalizeSelectedFiles(primary, fallback, workspace) {
  const root = resolveLocalPath(workspace);
  const values = [
    ...(Array.isArray(fallback) ? fallback : []),
    ...(Array.isArray(primary) ? primary : []),
  ].filter((item) => typeof item === 'string' && item.trim());
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const rawPath = value.startsWith('/') || value.startsWith('~') ? value : join(root, value);
    const filePath = ensurePathInsideRoot(resolveLocalPath(rawPath), root);
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    result.push(filePath);
  }
  return result;
}

async function buildOpenCodeFileAttachments(files, workspace) {
  const root = resolveLocalPath(workspace);
  const attachments = [];
  for (const filePath of files) {
    try {
      const stats = await stat(filePath);
      if (!stats.isFile()) continue;
      attachments.push({
        uri: pathToFileURL(filePath).toString(),
        mime: fileMimeType(filePath),
        name: basename(filePath),
        description: normalizeRelativePath(relative(root, filePath)),
      });
    } catch {
      // Ignore files that disappeared between selection and send.
    }
  }
  return attachments;
}

async function buildOpenCodeCommandParts(files, workspace) {
  const parts = [];
  for (const filePath of files) {
    try {
      const stats = await stat(filePath);
      if (!stats.isFile()) continue;
      parts.push({
        type: 'file',
        mime: fileMimeType(filePath),
        filename: basename(filePath),
        url: pathToFileURL(filePath).toString(),
      });
    } catch {
      // Ignore files that disappeared between selection and send.
    }
  }
  return parts;
}

function appendSelectedFilesToPrompt(input, files, workspace) {
  if (!files.length) return input;
  const root = resolveLocalPath(workspace);
  const fileList = files.map((filePath) => '- ' + normalizeRelativePath(relative(root, filePath))).join('\n');
  return input + '\n\nSelected files:\n' + fileList;
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
    const signal = options.signal;
    if (signal?.aborted) {
      reject(signal.reason || new Error('Process aborted'));
      return;
    }
    const child = spawn(command, args, {
      cwd: options.cwd || process.env.HOME || process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const appendStdout = (chunk) => {
      stdout += chunk.toString();
      options.onStdout?.(chunk);
    };
    const appendStderr = (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    };
    const abort = () => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1500).unref?.();
    };
    if (signal) signal.addEventListener('abort', abort);
    child.stdout.on('data', appendStdout);
    child.stderr.on('data', appendStderr);
    child.on('error', reject);
    child.on('exit', (code) => {
      if (signal) signal.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(signal.reason || new Error('Process aborted'));
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(command + ' exited with code ' + code + ': ' + (stderr || stdout).slice(-1000)));
    });
  });
}

function isAbortError(error) {
  return (
    isRecord(error) &&
    (error.name === 'AbortError' || error.code === 'ABORT_ERR' || error.message === 'Generation stopped by user')
  );
}

function runtimeDisplayName(backend) {
  if (backend === 'opencode') return 'OpenCode';
  if (backend === 'gemini') return 'Gemini CLI';
  if (backend === 'codex') return 'Codex CLI';
  return 'Agent';
}

function formatRuntimeErrorMessage(error) {
  const rawMessage =
    isRecord(error) && typeof error.message === 'string'
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown runtime error';
  const message = redactRuntimeErrorText(rawMessage).trim();
  return message.length ? truncateRuntimeErrorText(message) : 'Unknown runtime error';
}

function redactRuntimeErrorText(text) {
  return text
    .replace(/\b(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/\b([A-Z0-9_]*(?:api[_-]?key|token|secret|password)[A-Z0-9_]*\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[redacted]');
}

function truncateRuntimeErrorText(text) {
  const maxLength = 600;
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

function extractGeminiStreamText(output) {
  return output
    .split(/\r?\n/)
    .map((line) => parseGeminiStreamJsonLine(line))
    .filter(Boolean)
    .join('');
}

function extractCodexJsonText(output) {
  return output
    .split(/\r?\n/)
    .map((line) => parseCodexJsonLine(line))
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

function parseCodexJsonLine(line) {
  return extractCodexEventText(parseCodexJsonEvent(line));
}

function parseCodexJsonEvent(line) {
  if (!line.trim()) return '';
  try {
    return JSON.parse(line);
  } catch {
    return '';
  }
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

function extractCodexEventText(value) {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return '';

  const item = isRecord(value.item) ? value.item : {};
  if (value.type === 'item.completed' && item.type === 'agent_message' && typeof item.text === 'string') {
    return item.text;
  }

  if (value.type === 'error' && typeof value.message === 'string') return value.message;
  if (value.type === 'turn.failed' && isRecord(value.error) && typeof value.error.message === 'string') {
    return value.error.message;
  }

  const direct =
    stringValue(value.text) ||
    stringValue(value.content) ||
    stringValue(value.delta) ||
    (isRecord(value.message) ? stringValue(value.message.content) : undefined);
  if (direct) return direct;

  if (isRecord(value.data)) return extractCodexEventText(value.data);
  return '';
}

function extractCodexToolUpdate(value) {
  if (!isRecord(value)) return null;
  const type = typeof value.type === 'string' ? value.type : '';
  if (!(type === 'item.started' || type === 'item.completed')) return null;
  const item = isRecord(value.item) ? value.item : {};
  if (item.type === 'agent_message') return null;
  if (item.type === 'todo_list') return null;
  if (item.type === 'command_execution') return codexCommandExecutionTool(type, item);
  if (item.type === 'web_search') return codexWebSearchTool(type, item);
  if (item.type === 'file_change') return codexFileChangeTool(type, item);
  if (item.type === 'mcp_tool_call') return codexMcpToolCallTool(type, item);
  return codexGenericTool(type, item);
}

function extractCodexPlanUpdate(value) {
  if (!isRecord(value)) return null;
  const type = typeof value.type === 'string' ? value.type : '';
  if (!(type === 'item.started' || type === 'item.updated' || type === 'item.completed')) return null;
  const item = isRecord(value.item) ? value.item : {};
  if (item.type !== 'todo_list') return null;
  return codexTodoListPlan(item);
}

function codexTodoListPlan(item) {
  const sessionId = stringValue(item.id);
  const items = Array.isArray(item.items) ? item.items.filter(isRecord) : [];
  if (!sessionId) return null;
  return {
    sessionId,
    entries: items.map((todo) => ({
      title: stringValue(todo.text) || '',
      status: todo.completed ? 'completed' : 'pending',
    })),
  };
}

function codexCommandExecutionTool(type, item) {
  const toolCallId = stringValue(item.id);
  if (!toolCallId) return null;
  const command = stringValue(item.command) || 'command';
  const output = stringValue(item.aggregated_output) || '';
  const description = [command, output.trim()].filter(Boolean).join('\n\n');
  return {
    toolCallId,
    kind: 'command_execution',
    title: command,
    description,
    status: codexToolStatus(type, item),
  };
}

function codexWebSearchTool(type, item) {
  const toolCallId = stringValue(item.id);
  if (!toolCallId) return null;
  const query = stringValue(item.query) || '';
  return {
    toolCallId,
    kind: 'web_search',
    subtype: type === 'item.started' ? 'web_search_begin' : 'web_search_end',
    title: query || 'Web search',
    description: query,
    status: type === 'item.started' ? 'executing' : 'success',
    data: { query },
  };
}

function codexFileChangeTool(type, item) {
  const toolCallId = stringValue(item.id);
  if (!toolCallId) return null;
  const changes = Array.isArray(item.changes) ? item.changes.filter(isRecord) : [];
  return {
    toolCallId,
    kind: 'file_change',
    title: codexFileChangeTitle(changes),
    description: codexFileChangeDescription(item),
    status: codexToolStatus(type, item),
    data: { changes },
  };
}

function codexMcpToolCallTool(type, item) {
  const toolCallId = stringValue(item.id);
  if (!toolCallId) return null;
  const server = stringValue(item.server) || '';
  const tool = stringValue(item.tool) || '';
  return {
    toolCallId,
    kind: 'mcp_tool_call',
    title: [server, tool].filter(Boolean).join('/') || 'MCP tool call',
    description: codexMcpToolDescription(item),
    status: codexToolStatus(type, item),
    data: { server, tool, arguments: item.arguments, result: item.result, error: item.error },
  };
}

function codexGenericTool(type, item) {
  const toolCallId = stringValue(item.id);
  if (!toolCallId) return null;
  const kind = stringValue(item.type) || 'tool';
  return {
    toolCallId,
    kind,
    title: codexToolTitle(item, kind),
    description: codexToolDescription(item),
    status: codexToolStatus(type, item),
  };
}

function codexFileChangeTitle(changes) {
  if (changes.length === 1) return codexFileChangeLabel(changes[0]);
  return changes.length ? changes.length + ' file changes' : 'File changes';
}

function codexFileChangeDescription(item) {
  const changes = Array.isArray(item.changes) ? item.changes.filter(isRecord) : [];
  return changes.map(codexFileChangeLabel).filter(Boolean).join('\n');
}

function codexFileChangeLabel(change) {
  const path = stringValue(change.path);
  const kind = stringValue(change.kind);
  return [kind, path].filter(Boolean).join(' ');
}

function codexMcpToolDescription(item) {
  const parts = [];
  if (item.arguments !== undefined) {
    parts.push('Arguments: ' + safeJsonStringify(item.arguments));
  }
  if (item.result !== undefined) {
    parts.push('Result: ' + safeJsonStringify(item.result));
  }
  if (isRecord(item.error) && typeof item.error.message === 'string') {
    parts.push('Error: ' + item.error.message);
  } else if (typeof item.error === 'string') {
    parts.push('Error: ' + item.error);
  }
  return parts.join('\n\n');
}

function codexToolStatus(type, item) {
  if (type === 'item.started' || item.status === 'in_progress') return 'executing';
  if (item.status === 'failed' || item.status === 'error') return 'error';
  if (typeof item.exit_code === 'number' && item.exit_code !== 0) return 'error';
  if (type === 'item.completed' || item.status === 'completed') return 'success';
  if (item.status === 'canceled' || item.status === 'cancelled') return 'canceled';
  return 'pending';
}

function codexToolTitle(item, fallback) {
  return stringValue(item.title) || stringValue(item.name) || stringValue(item.command) || fallback;
}

function codexToolDescription(item) {
  return (
    stringValue(item.description) ||
    stringValue(item.aggregated_output) ||
    stringValue(item.output) ||
    stringValue(item.error) ||
    ''
  );
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

async function addTextMessage(conversationId, msgId, position, content) {
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
  await saveStore();
  return message;
}

function upsertToolGroupMessage(conversationId, msgId, tool) {
  const list = messages.get(conversationId);
  const conversation = conversations.get(conversationId);
  if (!list || !conversation || !tool.callId) return;
  const now = Date.now();

  for (const message of list) {
    if (message.type !== 'tool_group' || !Array.isArray(message.content)) continue;
    const index = message.content.findIndex((item) => isRecord(item) && item.callId === tool.callId);
    if (index === -1) continue;
    message.content[index] = { ...message.content[index], ...tool };
    message.createdAt = message.createdAt || now;
    conversation.modifyTime = now;
    void saveStore();
    return;
  }

  list.push({
    id: randomId(),
    msg_id: msgId,
    conversation_id: conversationId,
    type: 'tool_group',
    content: [tool],
    createdAt: now,
  });
  conversation.modifyTime = now;
  void saveStore();
}

function upsertCodexToolCallMessage(conversationId, msgId, tool) {
  const list = messages.get(conversationId);
  const conversation = conversations.get(conversationId);
  if (!list || !conversation || !tool.toolCallId) return;
  const now = Date.now();

  for (const message of list) {
    if (message.type !== 'codex_tool_call' || !isRecord(message.content)) continue;
    if (message.content.toolCallId === tool.toolCallId) {
      message.content = { ...message.content, ...tool };
      message.createdAt = message.createdAt || now;
      conversation.modifyTime = now;
      void saveStore();
      return;
    }
  }

  list.push({
    id: randomId(),
    msg_id: msgId,
    conversation_id: conversationId,
    type: 'codex_tool_call',
    position: 'left',
    content: tool,
    createdAt: now,
  });
  conversation.modifyTime = now;
  void saveStore();
}

function upsertCodexPlanMessage(conversationId, msgId, plan) {
  const list = messages.get(conversationId);
  const conversation = conversations.get(conversationId);
  if (!list || !conversation || !plan.sessionId) return;
  const now = Date.now();

  for (const message of list) {
    if (message.type !== 'plan' || !isRecord(message.content)) continue;
    if (message.content.sessionId === plan.sessionId) {
      message.content = { ...message.content, ...plan };
      message.createdAt = message.createdAt || now;
      conversation.modifyTime = now;
      void saveStore();
      return;
    }
  }

  list.push({
    id: randomId(),
    msg_id: msgId,
    conversation_id: conversationId,
    type: 'plan',
    position: 'left',
    content: plan,
    createdAt: now,
  });
  conversation.modifyTime = now;
  void saveStore();
}

async function removeConversation(id, emit) {
  const existed = conversations.delete(id);
  messages.delete(id);
  artifacts.delete(id);
  openCodeSessions.delete(id);
  if (existed) {
    await saveStore();
    emitListChanged(emit, id, 'deleted');
  }
  return existed;
}

async function updateConversation(id, updates, emit) {
  const conversation = conversations.get(id);
  if (!conversation) return false;
  conversations.set(id, {
    ...conversation,
    ...updates,
    extra: isRecord(updates.extra) ? { ...conversation.extra, ...updates.extra } : conversation.extra,
    modifyTime: Date.now(),
  });
  await saveStore();
  emitListChanged(emit, id, 'updated');
  return true;
}

function emitListChanged(emit, conversationId, action) {
  emit('conversation.listChanged', { conversation_id: conversationId, action, source: 'local' });
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAuthorized(protocolHeader, expected) {
  if (Array.isArray(protocolHeader)) {
    return protocolHeader.includes(expected);
  }
  return protocolHeader === expected;
}

function requiredString(value) {
  if (typeof value !== 'string') throw new Error('Expected string bridge parameter');
  return value;
}

function artifactStatusParam(value) {
  if (value === 'active' || value === 'pending' || value === 'dismissed' || value === 'saved') return value;
  throw new Error("Unsupported artifact status '" + String(value) + "'");
}

function stringValue(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function safeJsonStringify(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function randomId() {
  return 'local_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

console.log('aicliui termux daemon listening on ws://127.0.0.1:' + port);`;
