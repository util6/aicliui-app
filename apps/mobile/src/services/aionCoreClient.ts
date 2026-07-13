import { api } from './api';
import { createTwoFilesPatch } from 'diff';

type RecordValue = Record<string, unknown>;

const SUPPORTED_LOCAL_BACKENDS = new Set(['opencode', 'gemini', 'codex']);

export async function requestAionCore<T = unknown>(name: string, data?: unknown): Promise<T> {
  const params = asRecord(data);

  switch (name) {
    case 'runtime.get-status':
      return (await getRuntimeStatus()) as T;
    case 'acp.get-available-agents':
      return ({ success: true, data: await getAvailableAgents() } as T);
    case 'acp.probe-model-info': {
      const agents = await getManagementAgents();
      const agent = agents.find((item) => item.backend === params.backend);
      return ({ success: true, data: { modelInfo: modelInfoFromAgent(agent) } } as T);
    }
    case 'agents.management.list':
      return (await get('/api/agents/management')) as T;
    case 'agents.health-check':
      return (await post(`/api/agents/${encode(requiredString(params.id))}/health-check`)) as T;
    case 'agents.set-enabled':
      return (await patch(`/api/agents/${encode(requiredString(params.id))}/enabled`, {
        enabled: params.enabled === true,
      })) as T;
    case 'agents.custom.test':
      return (await post('/api/agents/custom/try-connect', {
        command: requiredString(params.command),
        acp_args: stringArray(params.acp_args),
        env: isRecord(params.env) ? params.env : {},
      })) as T;
    case 'agents.custom.create':
      return (await post('/api/agents/custom', customAgentBody(params))) as T;
    case 'agents.custom.update':
      return (await put(
        `/api/agents/custom/${encode(requiredString(params.id))}`,
        customAgentBody(params),
      )) as T;
    case 'agents.custom.delete':
      return (await remove(`/api/agents/custom/${encode(requiredString(params.id))}`)) as T;
    case 'database.get-user-conversations': {
      const pageSize = numberParam(params.pageSize, 100);
      const result = await get('/api/conversations', { limit: pageSize });
      return paginatedItems(result).map(normalizeConversation) as T;
    }
    case 'database.get-conversation-messages': {
      const conversationId = requiredString(params.conversation_id);
      const result = await get(`/api/conversations/${encode(conversationId)}/messages`, { limit: 500 });
      return paginatedItems(result).map(normalizeMessage) as T;
    }
    case 'conversation.get':
      return normalizeConversation(
        await get(`/api/conversations/${encode(requiredString(params.conversation_id))}`),
      ) as T;
    case 'conversation.ensure-runtime':
      return (await post(
        `/api/conversations/${encode(requiredString(params.conversation_id))}/runtime/ensure`,
      )) as T;
    case 'conversation.set-config-option':
      return (await put(
        `/api/conversations/${encode(requiredString(params.conversation_id))}/config-options/${encode(requiredString(params.option_id))}`,
        { value: requiredString(params.value) },
      )) as T;
    case 'conversation.get-slash-commands':
      return (await get(
        `/api/conversations/${encode(requiredString(params.conversation_id))}/slash-commands`,
      )) as T;
    case 'conversation.list-artifacts':
      return (await get(
        `/api/conversations/${encode(requiredString(params.conversation_id))}/artifacts`,
      )) as T;
    case 'conversation.update-artifact':
      return (await patch(
        `/api/conversations/${encode(requiredString(params.conversation_id))}/artifacts/${encode(requiredString(params.artifact_id))}`,
        { status: requiredString(params.status) },
      )) as T;
    case 'create-conversation':
      return normalizeConversation(await post('/api/conversations', normalizeCreateConversation(params))) as T;
    case 'remove-conversation':
      return (await remove(`/api/conversations/${encode(requiredString(params.id))}`)) as T;
    case 'update-conversation':
      return (await patch(
        `/api/conversations/${encode(requiredString(params.id))}`,
        normalizeConversationUpdates(asRecord(params.updates)),
      )) as T;
    case 'chat.send.message':
      return (await post(
        `/api/conversations/${encode(requiredString(params.conversation_id))}/messages`,
        {
          content: requiredString(params.input),
          ...(stringArray(params.files).length ? { files: stringArray(params.files) } : {}),
        },
      )) as T;
    case 'chat.stop.stream': {
      const conversationId = requiredString(params.conversation_id);
      const conversation = asRecord(await get(`/api/conversations/${encode(conversationId)}`));
      const runtime = asRecord(conversation.runtime);
      return (await post(`/api/conversations/${encode(conversationId)}/cancel`, {
        turn_id: stringParam(runtime.turn_id, ''),
      })) as T;
    }
    case 'confirmation.list':
      return (await get(
        `/api/conversations/${encode(requiredString(params.conversation_id))}/confirmations`,
      )) as T;
    case 'confirmation.confirm':
      return (await post(
        `/api/conversations/${encode(requiredString(params.conversation_id))}/confirmations/${encode(requiredString(params.callId ?? params.call_id))}/confirm`,
        {
          msg_id: stringParam(params.msg_id, ''),
          data: params.data,
          always_allow: false,
        },
      )) as T;
    case 'conversation.get-workspace':
      return (await getWorkspace(params)) as T;
    case 'workspace.renameEntry':
      return (await post('/api/fs/rename', {
        path: requiredString(params.path),
        new_name: requiredString(params.newName ?? params.new_name),
        ...(typeof params.workspace === 'string' ? { workspace: params.workspace } : {}),
      })) as T;
    case 'workspace.removeEntry':
      return (await post('/api/fs/remove', {
        path: requiredString(params.path),
        ...(typeof params.workspace === 'string' ? { workspace: params.workspace } : {}),
      })) as T;
    case 'get-file-by-dir':
      return normalizeFileTree(
        await post('/api/fs/dir', {
          dir: requiredString(params.dir),
          root: requiredString(params.root),
        }),
      ) as T;
    case 'read-file':
      return (await post('/api/fs/read', { path: requiredString(params.path) })) as T;
    case 'get-image-base64':
      return (await post('/api/fs/image-base64', { path: requiredString(params.path) })) as T;
    case 'fileSnapshot.compare':
      return normalizeWorkspaceChanges(await post('/api/fs/snapshot/compare', { workspace: requiredString(params.workspace) })) as T;
    case 'fileSnapshot.diff':
      return (await getWorkspaceFileDiff(params)) as T;
    case 'fileSnapshot.stageFile':
      return (await post('/api/fs/snapshot/stage', snapshotFileBody(params))) as T;
    case 'fileSnapshot.stageAll':
      return (await post('/api/fs/snapshot/stage-all', { workspace: requiredString(params.workspace) })) as T;
    case 'fileSnapshot.unstageFile':
      return (await post('/api/fs/snapshot/unstage', snapshotFileBody(params))) as T;
    case 'fileSnapshot.unstageAll':
      return (await post('/api/fs/snapshot/unstage-all', { workspace: requiredString(params.workspace) })) as T;
    case 'fileSnapshot.discardFile':
      return (await post('/api/fs/snapshot/discard', {
        ...snapshotFileBody(params),
        operation: requiredString(params.operation),
      })) as T;
    default:
      throw new Error(`AionCore request mapping is not implemented for '${name}'`);
  }
}

async function getRuntimeStatus() {
  const agents = await getAvailableAgents();
  return {
    daemon: { version: 'AionCore 0.1.x', startedAt: 0 },
    agents: agents.filter((agent) => SUPPORTED_LOCAL_BACKENDS.has(agent.backend)).map((agent) => ({
      backend: agent.backend,
      state: agent.state,
      ...(agent.detail ? { detail: agent.detail } : {}),
    })),
  };
}

async function getAvailableAgents() {
  const agents = await getManagementAgents();
  return agents
    .filter((agent) => {
      if (agent.enabled === false) return false;
      const source = stringParam(agent.agent_source, 'builtin');
      const isExtensibleAgent = source === 'custom' || source === 'extension';
      const isSupportedBuiltin = typeof agent.backend === 'string' && SUPPORTED_LOCAL_BACKENDS.has(agent.backend);
      return (agent.agent_type === undefined || agent.agent_type === 'acp') && (isExtensibleAgent || isSupportedBuiltin);
    })
    .map((agent) => {
      const id = stringParam(agent.id, '');
      const source = stringParam(agent.agent_source, 'builtin');
      const backend = stringParam(agent.backend, id);
      const installed = agent.installed === true && agent.status !== 'missing';
      const state = !installed ? 'missing' : agent.status === 'offline' ? 'error' : 'ready';
      return {
        ...(id ? { id } : {}),
        backend,
        source,
        name: stringParam(agent.name, backend),
        label: stringParam(agent.name, backend),
        state,
        ...(typeof agent.last_check_error_message === 'string'
          ? { detail: agent.last_check_error_message }
          : {}),
      };
    });
}

async function getManagementAgents(): Promise<RecordValue[]> {
  const result = await get('/api/agents/management');
  return Array.isArray(result) ? result.filter(isRecord) : [];
}

function modelInfoFromAgent(agent: RecordValue | undefined) {
  if (!agent) return null;
  const config = asRecord(agent.config_options);
  const options = Array.isArray(config.config_options) ? config.config_options.filter(isRecord) : [];
  const model = options.find((option) => option.category === 'model' || option.id === 'model');
  if (!model) return null;
  const availableModels = Array.isArray(model.options)
    ? model.options.filter(isRecord).map((option) => ({
        id: stringParam(option.value, ''),
        label: stringParam(option.name ?? option.label ?? option.value, ''),
      }))
    : [];
  const currentModelId = stringOrNull(model.current_value ?? model.currentValue);
  return {
    currentModelId,
    currentModelLabel: availableModels.find((item) => item.id === currentModelId)?.label ?? currentModelId,
    availableModels,
    canSwitch: availableModels.length > 0,
    source: 'configOption',
    configOptionId: stringParam(model.id, 'model'),
  };
}

function normalizeCreateConversation(params: RecordValue) {
  const extra = asRecord(params.extra);
  return {
    type: params.type === 'aionrs' ? 'aionrs' : 'acp',
    name: params.name,
    extra,
  };
}

function normalizeConversationUpdates(updates: RecordValue) {
  const result: RecordValue = {};
  if (typeof updates.name === 'string') result.name = updates.name;
  if (typeof updates.pinned === 'boolean') result.pinned = updates.pinned;
  if (isRecord(updates.extra)) result.extra = updates.extra;
  return result;
}

function normalizeConversation(value: unknown): RecordValue {
  const conversation = asRecord(value);
  const extra = asRecord(conversation.extra);
  const model = asRecord(conversation.model);
  return {
    ...conversation,
    createTime: numberParam(conversation.created_at, 0),
    modifyTime: numberParam(conversation.modified_at, 0),
    pinned: conversation.pinned === true,
    pinnedAt: numberParam(conversation.pinned_at, 0),
    model: {
      id: stringParam(model.provider_id ?? extra.current_model_id ?? extra.currentModelId, ''),
      useModel: stringParam(model.use_model ?? model.model ?? extra.current_model_label ?? extra.currentModelLabel, ''),
    },
    extra,
  };
}

function normalizeMessage(value: unknown): RecordValue {
  const message = asRecord(value);
  return {
    ...message,
    createdAt: numberParam(message.created_at ?? message.createdAt, 0),
  };
}

async function getWorkspace(params: RecordValue) {
  const workspace = requiredString(params.workspace);
  const path = requiredString(params.path);
  const tree = normalizeFileTree(await post('/api/fs/dir', {
    dir: path,
    root: workspace,
  }));
  const search = stringParam(params.search, '').trim().toLowerCase();
  return search ? filterFileTree(tree, search) : tree;
}

function filterFileTree(items: unknown[], search: string): unknown[] {
  return items.flatMap((value) => {
    const item = asRecord(value);
    const children = Array.isArray(item.children) ? filterFileTree(item.children, search) : [];
    if (stringParam(item.name, '').toLowerCase().includes(search) || children.length > 0) {
      return [{
        ...item,
        ...(Array.isArray(item.children) ? { children } : {}),
      }];
    }
    return [];
  });
}

function normalizeFileTree(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    name: stringParam(item.name, ''),
    fullPath: stringParam(item.full_path ?? item.fullPath, ''),
    relativePath: stringParam(item.relative_path ?? item.relativePath, ''),
    isDir: item.is_dir === true || item.isDir === true,
    isFile: item.is_file === true || item.isFile === true,
    ...(Array.isArray(item.children) ? { children: normalizeFileTree(item.children) } : {}),
  }));
}

function normalizeWorkspaceChanges(value: unknown) {
  const result = asRecord(value);
  const normalize = (items: unknown) =>
    Array.isArray(items)
      ? items.filter(isRecord).map((item) => ({
          ...item,
          relativePath: stringParam(item.relative_path ?? item.relativePath, ''),
          additions: numberParam(item.additions, 0),
          deletions: numberParam(item.deletions, 0),
        }))
      : [];
  return {
    mode: stringParam(result.mode, 'snapshot'),
    branch: typeof result.branch === 'string' ? result.branch : null,
    staged: normalize(result.staged),
    unstaged: normalize(result.unstaged),
  };
}

function snapshotFileBody(params: RecordValue) {
  return {
    workspace: requiredString(params.workspace),
    file_path: requiredString(params.file_path ?? params.relativePath),
  };
}

function customAgentBody(params: RecordValue) {
  return {
    name: requiredString(params.name),
    command: requiredString(params.command),
    ...(typeof params.icon === 'string' && params.icon ? { icon: params.icon } : {}),
    args: stringArray(params.args),
    env: Array.isArray(params.env) ? params.env.filter(isRecord) : [],
    ...(isRecord(params.advanced) ? { advanced: params.advanced } : {}),
  };
}

async function getWorkspaceFileDiff(params: RecordValue) {
  const workspace = requiredString(params.workspace).replace(/\/$/, '');
  const relativePath = requiredString(params.relativePath ?? params.file_path);
  const source = params.source === 'staged' ? 'staged' : 'unstaged';
  const baseline = await post('/api/fs/snapshot/baseline', {
    workspace,
    file_path: relativePath,
  }).catch(() => null);
  const current = await post('/api/fs/read', {
    path: `${workspace}/${relativePath}`,
    workspace,
  }).catch(() => '');
  const before = typeof baseline === 'string' ? baseline : '';
  const after = typeof current === 'string' ? current : '';
  return {
    relativePath,
    source,
    diff: createTwoFilesPatch(`a/${relativePath}`, `b/${relativePath}`, before, after, '', ''),
  };
}

async function get(path: string, params?: RecordValue): Promise<unknown> {
  return unwrap((await api.get(path, params ? { params } : undefined)).data);
}

async function post(path: string, body?: unknown): Promise<unknown> {
  return unwrap((await api.post(path, body)).data);
}

async function put(path: string, body?: unknown): Promise<unknown> {
  return unwrap((await api.put(path, body)).data);
}

async function patch(path: string, body?: unknown): Promise<unknown> {
  return unwrap((await api.patch(path, body)).data);
}

async function remove(path: string): Promise<unknown> {
  return unwrap((await api.delete(path)).data);
}

function unwrap(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (value.success === false) {
    throw new Error(stringParam(value.error, 'AionCore request failed'));
  }
  return Object.prototype.hasOwnProperty.call(value, 'data') ? value.data : value;
}

function paginatedItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const result = asRecord(value);
  return Array.isArray(result.items) ? result.items : [];
}

function encode(value: string): string {
  return encodeURIComponent(value);
}

function asRecord(value: unknown): RecordValue {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value;
  throw new Error('Expected non-empty AionCore request parameter');
}

function stringParam(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberParam(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
