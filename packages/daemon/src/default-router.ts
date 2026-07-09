import type {
  AgentConfigOption,
  AgentInfo,
  AgentModelInfo,
  Conversation,
  ConversationArtifact,
  ConversationArtifactStatus,
  ConversationListChangedEvent,
  ConversationRuntimeSummary,
  ConversationStatus,
  ConversationTurnCompletedEvent,
  ConversationUserCreatedEvent,
  EnsureConversationRuntimeResponse,
  RuntimeStatus,
  SetConfigOptionResponse,
} from '@aicliui/shared';
import { getAgentModes } from '@aicliui/shared';
import { createDefaultAgentAdapterRegistry } from './agent-adapters/default-registry.js';
import type { AgentAdapterRegistry } from './agent-adapters/registry.js';
import { BridgeRouter } from './bridge-router.js';
import { InMemoryConversationStore, type CreateConversationInput, type StoredMessage } from './conversation-store.js';
import {
  compareWorkspaceChanges,
  getFileTreeByDir,
  getWorkspaceTree,
  readImageBase64,
  readTextFile,
} from './local-files.js';
import type { CliConfirmation } from './agent-adapters/types.js';

const startedAt = Date.now();

type DefaultRouterOptions = {
  store?: InMemoryConversationStore;
  adapters?: AgentAdapterRegistry;
};

type PendingConfirmationRecord = {
  backend: string;
  confirmation: CliConfirmation;
};

export function createDefaultRouter(options?: DefaultRouterOptions): BridgeRouter {
  const router = new BridgeRouter();
  const store = options?.store ?? new InMemoryConversationStore();
  const adapters = options?.adapters ?? createDefaultAgentAdapterRegistry();
  const pendingConfirmations = new Map<string, PendingConfirmationRecord>();
  const activeRuns = new Map<string, AbortController>();
  const activeRunBackends = new Map<string, string>();
  const activeTurnIds = new Map<string, string>();

  router.register('runtime.get-status', async () => getRuntimeStatus(adapters));
  router.register('acp.get-available-agents', () => ({
    success: true,
    data: adapters.listAgents(),
  }));
  router.register('acp.probe-model-info', async (data) => ({
    success: true,
    data: { modelInfo: await getAdapterModelInfo(adapters, stringParam(asRecord(data).backend, '')) },
  }));
  router.register('conversation.ensure-runtime', async (data): Promise<EnsureConversationRuntimeResponse> => {
    const conversation = requireConversation(store, stringParam(asRecord(data).conversation_id));
    const configOptions = await buildConversationConfigOptions(adapters, conversation);
    return {
      recovered: false,
      runtime: conversation.runtime ?? idleRuntimeSummary('finished', pendingConfirmationCount(pendingConfirmations, conversation.id)),
      config_options: configOptions,
      modelInfo: modelInfoFromConfigOptions(configOptions),
    };
  });
  router.register('conversation.set-config-option', async (data, context): Promise<SetConfigOptionResponse> => {
    const params = asRecord(data);
    const conversationId = stringParam(params.conversation_id);
    const optionId = stringParam(params.option_id);
    const value = stringParam(params.value);
    const conversation = requireConversation(store, conversationId);
    const currentConfigOptions = await buildConversationConfigOptions(adapters, conversation);
    const option = currentConfigOptions.find((candidate) => candidate.id === optionId);
    if (!option) {
      throw new Error(`Config option '${optionId}' was not found`);
    }

    const selected = option.options.find((candidate) => candidate.value === value);
    if (option.options.length > 0 && !selected) {
      throw new Error(`Config option '${optionId}' does not support value '${value}'`);
    }

    const updates = getConfigOptionConversationUpdates(option, value, selected);
    store.updateConversation(conversationId, updates);
    emitConversationListChanged(context, conversationId, 'updated');
    const updatedConversation = requireConversation(store, conversationId);
    const configOptions = await buildConversationConfigOptions(adapters, updatedConversation);
    return {
      confirmation: 'observed',
      config_options: configOptions,
      modelInfo: modelInfoFromConfigOptions(configOptions),
    };
  });
  router.register('database.get-user-conversations', (data) => {
    const params = asRecord(data);
    return store.listConversations(numberParam(params.page, 0), numberParam(params.pageSize, 100));
  });
  router.register('database.get-conversation-messages', (data) => {
    const params = asRecord(data);
    return store.getMessages(stringParam(params.conversation_id));
  });
  router.register('conversation.get', (data) => {
    const params = asRecord(data);
    return store.getConversation(stringParam(params.conversation_id)) ?? null;
  });
  router.register('conversation.list-artifacts', (data) => {
    const params = asRecord(data);
    return store.listArtifacts(stringParam(params.conversation_id));
  });
  router.register('conversation.update-artifact', (data, context) => {
    const params = asRecord(data);
    const conversationId = stringParam(params.conversation_id);
    const artifactId = stringParam(params.artifact_id);
    const status = artifactStatusParam(params.status);
    const artifact = store.updateArtifactStatus(conversationId, artifactId, status);
    if (!artifact) {
      throw new Error(`Artifact '${artifactId}' was not found`);
    }
    context.emit('conversation.artifact', artifact);
    return artifact;
  });
  router.register('conversation.get-slash-commands', async (data) => {
    const params = asRecord(data);
    const conversationId = stringParam(params.conversation_id);
    const conversation = store.getConversation(conversationId);
    if (!conversation) return [];

    const backend = conversation.extra.backend || 'opencode';
    const adapter = adapters.get(backend);
    if (!adapter?.getSlashCommands) return [];

    return adapter.getSlashCommands({
      conversationId,
      workspace: conversation.extra.workspace,
    });
  });
  router.register('create-conversation', (data, context) => {
    const params = asRecord(data);
    const extra = isRecord(params.extra) ? (params.extra as Conversation['extra']) : {};
    const conversation = store.createConversation({
      type: stringParam(params.type, 'acp'),
      name: stringParam(params.name, 'New conversation'),
      model: normalizeConversationModel(params.model, extra),
      extra,
    } satisfies CreateConversationInput);
    emitConversationListChanged(context, conversation.id, 'created');
    return conversation;
  });
  router.register('remove-conversation', (data, context) => {
    const params = asRecord(data);
    const conversationId = stringParam(params.id);
    const removed = store.removeConversation(conversationId);
    if (removed) {
      emitConversationListChanged(context, conversationId, 'deleted');
    }
    return removed;
  });
  router.register('update-conversation', (data, context) => {
    const params = asRecord(data);
    const conversationId = stringParam(params.id);
    const updated = store.updateConversation(conversationId, asRecord(params.updates) as Partial<Conversation>);
    if (updated) {
      emitConversationListChanged(context, conversationId, 'updated');
    }
    return updated;
  });
  router.register('chat.send.message', async (data, context) => {
    const params = asRecord(data);
    const conversationId = stringParam(params.conversation_id);
    const input = stringParam(params.input);
    const userMsgId = typeof params.msg_id === 'string' ? params.msg_id : undefined;
    const assistantMsgId = `assistant_${userMsgId || Date.now().toString(36)}`;
    const conversation = requireConversation(store, conversationId);
    const files = mergeFiles(conversation.extra.defaultFiles, params.files);
    const backend = conversation.extra.backend || 'opencode';
    const adapter = adapters.get(backend);
    if (!adapter) {
      throw new Error(`Agent adapter '${backend}' was not found`);
    }
    await stopActiveRun(activeRuns, activeRunBackends, adapters, conversationId);
    const runController = new AbortController();
    const acceptedRuntime = runningRuntimeSummary(
      'running',
      assistantMsgId,
      pendingConfirmationCount(pendingConfirmations, conversationId),
    );
    activeRuns.set(conversationId, runController);
    activeRunBackends.set(conversationId, backend);
    activeTurnIds.set(conversationId, assistantMsgId);
    store.updateConversation(conversationId, {
      status: 'running',
      runtime: acceptedRuntime,
    });

    const userMessage = store.addTextMessage({
      conversationId,
      msgId: userMsgId,
      position: 'right',
      content: input,
    });
    context.emit('message.userCreated', buildUserCreatedEvent(userMessage));

    context.emit('chat.response.stream', {
      type: 'start',
      msg_id: assistantMsgId,
      conversation_id: conversationId,
      data: null,
    });

    context.runDetached(async () => {
      let assistantContent = '';
      try {
        for await (const event of adapter.sendMessage({
          conversationId,
          input,
          msgId: userMessage.msg_id,
          workspace: conversation.extra.workspace,
          model:
            typeof conversation.extra.currentModelId === 'string'
              ? conversation.extra.currentModelId
              : undefined,
          sessionMode:
            typeof conversation.extra.sessionMode === 'string' ? conversation.extra.sessionMode : undefined,
          signal: runController.signal,
          ...(files.length ? { files } : {}),
        })) {
          switch (event.type) {
            case 'thought':
              emitChatStream(context, conversationId, assistantMsgId, 'thought', {
                subject: event.subject,
                description: event.description,
              });
              break;
            case 'thinking':
              emitChatStream(context, conversationId, assistantMsgId, 'thinking', {
                content: event.content,
                ...(event.subject ? { subject: event.subject } : {}),
                ...(event.duration !== undefined ? { duration: event.duration } : {}),
                status: event.status ?? 'thinking',
              });
              break;
            case 'tool_call':
              emitChatStream(context, conversationId, assistantMsgId, 'tool_call', event.data);
              break;
            case 'tool_group':
              emitChatStream(context, conversationId, assistantMsgId, 'tool_group', event.tools);
              break;
            case 'acp_tool_call':
              emitChatStream(context, conversationId, assistantMsgId, 'acp_tool_call', event.data);
              break;
            case 'codex_tool_call':
              emitChatStream(context, conversationId, assistantMsgId, 'codex_tool_call', event.data);
              break;
            case 'plan':
              emitChatStream(context, conversationId, assistantMsgId, 'plan', event.data);
              break;
            case 'context_usage':
              store.updateConversation(conversationId, {
                extra: {
                  lastContextUsage: {
                    used: event.used,
                    size: event.size,
                  },
                },
              });
              emitChatStream(context, conversationId, assistantMsgId, 'acp_context_usage', {
                used: event.used,
                size: event.size,
              });
              break;
            case 'artifact': {
              const artifact = store.upsertArtifact(normalizeAdapterArtifact(event.artifact, conversationId));
              context.emit('conversation.artifact', artifact);
              break;
            }
            case 'agent_status':
              emitChatStream(context, conversationId, assistantMsgId, 'agent_status', event.data);
              break;
            case 'available_commands':
              emitChatStream(context, conversationId, assistantMsgId, 'available_commands', {
                commands: event.commands,
              });
              break;
            case 'permission': {
              const confirmation = normalizeConfirmation(event.confirmation, conversationId, assistantMsgId);
              pendingConfirmations.set(confirmation.id, { backend, confirmation });
              store.updateConversation(conversationId, {
                status: 'waiting_confirmation',
                runtime: runningRuntimeSummary(
                  'waiting_confirmation',
                  assistantMsgId,
                  pendingConfirmationCount(pendingConfirmations, conversationId),
                ),
              });
              context.emit('confirmation.add', confirmation);
              break;
            }
            case 'permission_resolved':
              if (pendingConfirmations.delete(event.confirmationId)) {
                if (activeRuns.get(conversationId) === runController) {
                  store.updateConversation(conversationId, {
                    status: 'running',
                    runtime: runningRuntimeSummary(
                      'running',
                      assistantMsgId,
                      pendingConfirmationCount(pendingConfirmations, conversationId),
                    ),
                  });
                }
                context.emit('confirmation.remove', { conversation_id: conversationId, id: event.confirmationId });
              }
              break;
            case 'content':
              assistantContent += event.content;
              emitChatStream(context, conversationId, assistantMsgId, 'content', { content: event.content });
              break;
          }
        }
        if (runController.signal.aborted && !assistantContent) {
          assistantContent = 'Generation stopped.';
          emitChatStream(context, conversationId, assistantMsgId, 'content', { content: assistantContent });
        }
      } catch (error) {
        if (runController.signal.aborted || isAbortError(error)) {
          if (!assistantContent) {
            assistantContent = 'Generation stopped.';
            emitChatStream(context, conversationId, assistantMsgId, 'content', { content: assistantContent });
          }
        } else {
          const failureContent = formatRuntimeFailureContent(backend, error);
          const contentChunk = assistantContent ? `\n\n${failureContent}` : failureContent;
          assistantContent += contentChunk;
          emitChatStream(context, conversationId, assistantMsgId, 'content', { content: contentChunk });
        }
      } finally {
        const activeRun = activeRuns.get(conversationId);
        if (activeRun === runController) {
          activeRuns.delete(conversationId);
          activeRunBackends.delete(conversationId);
          activeTurnIds.delete(conversationId);
        }
        if (activeRun === runController || activeRun === undefined) {
          store.updateConversation(conversationId, {
            status: 'finished',
            runtime: idleRuntimeSummary('finished', pendingConfirmationCount(pendingConfirmations, conversationId)),
          });
        }
      }

      const assistantMessage = store.addTextMessage({
        conversationId,
        msgId: assistantMsgId,
        position: 'left',
        content: assistantContent,
      });
      context.emit('chat.response.stream', {
        type: 'finish',
        msg_id: assistantMsgId,
        conversation_id: conversationId,
        data: null,
      });
      const completedConversation = requireConversation(store, conversationId);
      context.emit(
        'turn.completed',
        buildTurnCompletedEvent({
          conversation: completedConversation,
          conversationId,
          turnId: assistantMsgId,
          backend,
          assistantMessage,
        }),
      );
    });

    return {
      success: true,
      msg_id: userMessage.msg_id,
      turn_id: assistantMsgId,
      runtime: acceptedRuntime,
    };
  });
  router.register('chat.stop.stream', async (data) => {
    const conversationId = stringParam(asRecord(data).conversation_id);
    const stopped = await stopActiveRun(activeRuns, activeRunBackends, adapters, conversationId);
    activeTurnIds.delete(conversationId);
    const runtime = idleRuntimeSummary('finished', pendingConfirmationCount(pendingConfirmations, conversationId));
    if (stopped) {
      store.updateConversation(conversationId, {
        status: 'finished',
        runtime,
      });
    }
    return {
      success: true,
      stopped,
      runtime: stopped ? runtime : (store.getConversation(conversationId)?.runtime ?? runtime),
    };
  });
  router.register('confirmation.list', (data) => {
    const params = asRecord(data);
    const conversationId = stringParam(params.conversation_id);
    return [...pendingConfirmations.values()]
      .map((record) => record.confirmation)
      .filter((confirmation) => confirmation.conversation_id === conversationId);
  });
  router.register('confirmation.confirm', async (data, context) => {
    const params = asRecord(data);
    const confirmationId = stringParam(params.msg_id ?? params.id);
    const record = pendingConfirmations.get(confirmationId);
    if (!record) {
      return {
        success: false,
        error: { code: 'CONFIRMATION_NOT_FOUND', message: `Confirmation not found: ${confirmationId}` },
      };
    }

    const adapter = adapters.get(record.backend);
    const recordConversationId = stringParam(record.confirmation.conversation_id);
    const callId =
      typeof params.callId === 'string'
        ? params.callId
        : typeof params.call_id === 'string'
          ? params.call_id
          : record.confirmation.callId ?? record.confirmation.call_id;
    const result = await adapter?.confirm?.({
      conversationId: recordConversationId,
      confirmationId,
      ...(callId ? { callId } : {}),
      data: params.data,
    });

    pendingConfirmations.delete(confirmationId);
    if (activeRuns.has(recordConversationId)) {
      store.updateConversation(recordConversationId, {
        status: 'running',
        runtime: runningRuntimeSummary(
          'running',
          activeTurnIds.get(recordConversationId) ?? null,
          pendingConfirmationCount(pendingConfirmations, recordConversationId),
        ),
      });
    }
    context.emit('confirmation.remove', {
      conversation_id: record.confirmation.conversation_id,
      id: confirmationId,
    });
    return result ?? { success: true };
  });
  router.register('conversation.get-workspace', async (data) => await getWorkspaceTree(asRecord(data)));
  router.register('fileSnapshot.compare', async (data) => await compareWorkspaceChanges(asRecord(data)));
  router.register('get-file-by-dir', async (data) => await getFileTreeByDir(asRecord(data)));
  router.register('read-file', async (data) => await readTextFile(stringParam(asRecord(data).path)));
  router.register('get-image-base64', async (data) => await readImageBase64(stringParam(asRecord(data).path)));

  return router;
}

function runningRuntimeSummary(
  status: Extract<ConversationStatus, 'running' | 'waiting_confirmation'>,
  turnId: string | null,
  pendingConfirmations: number,
): ConversationRuntimeSummary {
  return {
    state: status,
    can_send_message: false,
    has_task: true,
    task_status: status,
    is_processing: true,
    pending_confirmations: pendingConfirmations,
    turn_id: turnId,
  };
}

function idleRuntimeSummary(
  status: Extract<ConversationStatus, 'finished'>,
  pendingConfirmations: number,
): ConversationRuntimeSummary {
  return {
    state: 'idle',
    can_send_message: true,
    has_task: false,
    task_status: status,
    is_processing: false,
    pending_confirmations: pendingConfirmations,
    turn_id: null,
  };
}

function pendingConfirmationCount(
  pendingConfirmations: Map<string, PendingConfirmationRecord>,
  conversationId: string,
): number {
  let count = 0;
  for (const { confirmation } of pendingConfirmations.values()) {
    if (confirmation.conversation_id === conversationId) count += 1;
  }
  return count;
}

async function stopActiveRun(
  activeRuns: Map<string, AbortController>,
  activeRunBackends: Map<string, string>,
  adapters: AgentAdapterRegistry,
  conversationId: string,
): Promise<boolean> {
  const controller = activeRuns.get(conversationId);
  if (!controller) return false;
  const backend = activeRunBackends.get(conversationId);
  controller.abort(new Error('Generation stopped by user'));
  activeRuns.delete(conversationId);
  activeRunBackends.delete(conversationId);
  if (backend) {
    try {
      await adapters.get(backend)?.abort?.({ conversationId });
    } catch {
      // Local cancellation should still complete if the backend session is already idle or gone.
    }
  }
  return true;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (error instanceof Error && error.message.toLowerCase().includes('aborted'))
  );
}

function formatRuntimeFailureContent(backend: string, error: unknown): string {
  return `${runtimeDisplayName(backend)} runtime failed: ${runtimeErrorMessage(error)}`;
}

function runtimeDisplayName(backend: string): string {
  if (backend === 'opencode') return 'OpenCode';
  if (backend === 'gemini') return 'Gemini CLI';
  if (backend === 'codex') return 'Codex CLI';
  return 'Agent';
}

function runtimeErrorMessage(error: unknown): string {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown runtime error';
  const message = redactRuntimeErrorText(rawMessage).trim();
  return message.length ? truncateRuntimeErrorText(message) : 'Unknown runtime error';
}

function redactRuntimeErrorText(text: string): string {
  return text
    .replace(/\b(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/\b([A-Z0-9_]*(?:api[_-]?key|token|secret|password)[A-Z0-9_]*\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[redacted]');
}

function truncateRuntimeErrorText(text: string): string {
  const maxLength = 600;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function emitChatStream(
  context: { emit: (name: string, data?: unknown) => void },
  conversationId: string,
  msgId: string,
  type: string,
  data: unknown,
): void {
  context.emit('chat.response.stream', {
    type,
    msg_id: msgId,
    conversation_id: conversationId,
    data,
  });
}

function normalizeAdapterArtifact(artifact: ConversationArtifact, conversationId: string): ConversationArtifact {
  if (artifact.conversation_id === conversationId) return artifact;
  return {
    ...artifact,
    conversation_id: conversationId,
  };
}

function buildTurnCompletedEvent({
  conversation,
  conversationId,
  turnId,
  backend,
  assistantMessage,
}: {
  conversation: Conversation;
  conversationId: string;
  turnId: string;
  backend: string;
  assistantMessage: StoredMessage;
}): ConversationTurnCompletedEvent {
  const runtime = conversation.runtime ?? idleRuntimeSummary('finished', 0);
  return {
    session_id: conversationId,
    turn_id: turnId,
    status: conversation.status ?? 'finished',
    state: turnStateFromRuntime(runtime),
    detail: '',
    can_send_message: runtime.can_send_message,
    runtime,
    workspace: conversation.extra.workspace ?? '',
    model: {
      platform: backend,
      name: conversation.extra.agentName || runtimeDisplayName(backend),
      use_model: conversation.model.useModel || conversation.extra.currentModelLabel || conversation.extra.currentModelId || '',
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

function buildUserCreatedEvent(message: StoredMessage): ConversationUserCreatedEvent {
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

function emitConversationListChanged(
  context: { emit: (name: string, data?: unknown) => void },
  conversationId: string,
  action: ConversationListChangedEvent['action'],
): void {
  context.emit('conversation.listChanged', {
    conversation_id: conversationId,
    action,
    source: 'local',
  } satisfies ConversationListChangedEvent);
}

function turnStateFromRuntime(runtime: ConversationRuntimeSummary): string {
  if (runtime.state === 'idle') return 'ai_waiting_input';
  if (runtime.state === 'waiting_confirmation') return 'ai_waiting_confirmation';
  if (runtime.state === 'starting') return 'initializing';
  if (runtime.state === 'cancelling') return 'stopped';
  if (runtime.state === 'running') return 'ai_generating';
  return 'unknown';
}

function normalizeConfirmation(
  confirmation: CliConfirmation,
  conversationId: string,
  msgId: string,
): CliConfirmation {
  const callId = confirmation.callId ?? confirmation.call_id;
  return {
    ...confirmation,
    msg_id: confirmation.msg_id ?? msgId,
    conversation_id: confirmation.conversation_id ?? conversationId,
    ...(callId ? { callId, call_id: confirmation.call_id ?? callId } : {}),
  };
}

export function getAvailableAgents(): AgentInfo[] {
  return createDefaultAgentAdapterRegistry().listAgents();
}

async function getAdapterModelInfo(adapters: AgentAdapterRegistry, backend: string) {
  const adapter = adapters.get(backend);
  if (!adapter?.getModelInfo) return null;
  try {
    return await adapter.getModelInfo();
  } catch {
    return null;
  }
}

function requireConversation(store: InMemoryConversationStore, conversationId: string): Conversation {
  const conversation = store.getConversation(conversationId);
  if (!conversation) {
    throw new Error(`Conversation '${conversationId}' was not found`);
  }
  return conversation;
}

async function buildConversationConfigOptions(
  adapters: AgentAdapterRegistry,
  conversation: Conversation,
): Promise<AgentConfigOption[]> {
  const backend = conversation.extra.backend || conversation.type;
  const configOptions: AgentConfigOption[] = [];
  const modelInfo = await getAdapterModelInfo(adapters, backend);

  if (modelInfo?.canSwitch && modelInfo.availableModels.length > 0) {
    configOptions.push({
      id: 'model',
      name: 'Model',
      label: 'Model',
      category: 'model',
      type: 'select',
      option_type: 'select',
      current_value: conversation.extra.currentModelId ?? modelInfo.currentModelId ?? null,
      options: modelInfo.availableModels.map((model) => ({
        value: model.id,
        label: model.label,
      })),
    });
  }

  const modes = getAgentModes(backend);
  if (modes.length > 0) {
    configOptions.push({
      id: 'mode',
      name: 'Permission',
      label: 'Permission',
      category: 'mode',
      type: 'select',
      option_type: 'select',
      current_value: conversation.extra.sessionMode ?? modes[0]?.value ?? null,
      options: modes.map((mode) => ({
        value: mode.value,
        label: mode.label,
        ...(mode.description ? { description: mode.description } : {}),
      })),
    });
  }

  return configOptions;
}

function modelInfoFromConfigOptions(configOptions: AgentConfigOption[]): AgentModelInfo | null {
  const modelOption = configOptions.find((option) => option.category === 'model' || option.id === 'model');
  if (!modelOption) return null;
  const currentModelId = modelOption.current_value ?? null;
  const currentModel = modelOption.options.find((option) => option.value === currentModelId);
  return {
    currentModelId,
    currentModelLabel: currentModel?.label ?? currentModel?.name ?? currentModelId,
    availableModels: modelOption.options.map((option) => ({
      id: option.value,
      label: option.label || option.name || option.value,
    })),
    canSwitch: modelOption.options.length > 0,
    source: 'configOption',
    configOptionId: modelOption.id,
  };
}

function getConfigOptionConversationUpdates(
  option: AgentConfigOption,
  value: string,
  selected: AgentConfigOption['options'][number] | undefined,
): Partial<Conversation> {
  const category = option.category || option.id;
  if (category === 'model' || option.id === 'model') {
    const label = selected?.label || selected?.name || value;
    return {
      model: {
        id: value,
        useModel: label,
      },
      extra: {
        currentModelId: value,
        currentModelLabel: label,
      },
    };
  }

  if (category === 'mode' || option.id === 'mode') {
    return {
      extra: {
        sessionMode: value,
      },
    };
  }

  return {};
}

export async function getRuntimeStatus(adapters = createDefaultAgentAdapterRegistry()): Promise<RuntimeStatus> {
  return {
    daemon: {
      version: '0.1.0',
      startedAt,
    },
    termux: {
      runCommandPermission: 'unknown',
      allowExternalApps: 'unknown',
    },
    agents: await adapters.probeAll(),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringParam(value: unknown, fallback?: string): string {
  if (typeof value === 'string') return value;
  if (fallback !== undefined) return fallback;
  throw new Error('Expected string bridge parameter');
}

function numberParam(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function artifactStatusParam(value: unknown): ConversationArtifactStatus {
  if (value === 'active' || value === 'pending' || value === 'dismissed' || value === 'saved') return value;
  throw new Error(`Unsupported artifact status '${String(value)}'`);
}

function stringArrayParam(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function mergeFiles(fallback: unknown, primary: unknown): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const filePath of [...stringArrayParam(fallback), ...stringArrayParam(primary)]) {
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    files.push(filePath);
  }
  return files;
}

function isModel(value: unknown): value is { id: string; useModel: string } {
  return isRecord(value) && typeof value.id === 'string' && typeof value.useModel === 'string';
}

function normalizeConversationModel(model: unknown, extra: Conversation['extra']): { id: string; useModel: string } {
  if (isModel(model) && (model.id || model.useModel)) {
    return model;
  }

  if (typeof extra.currentModelId !== 'string' || extra.currentModelId.length === 0) {
    return { id: '', useModel: '' };
  }

  return {
    id: extra.currentModelId,
    useModel: typeof extra.currentModelLabel === 'string' && extra.currentModelLabel.length > 0 ? extra.currentModelLabel : extra.currentModelId,
  };
}
