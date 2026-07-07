import type { AgentInfo, Conversation, RuntimeStatus } from '@aicliui/shared';
import { createDefaultAgentAdapterRegistry } from './agent-adapters/default-registry.js';
import type { AgentAdapterRegistry } from './agent-adapters/registry.js';
import { BridgeRouter } from './bridge-router.js';
import { InMemoryConversationStore, type CreateConversationInput } from './conversation-store.js';

const startedAt = Date.now();

type DefaultRouterOptions = {
  store?: InMemoryConversationStore;
  adapters?: AgentAdapterRegistry;
};

export function createDefaultRouter(options?: DefaultRouterOptions): BridgeRouter {
  const router = new BridgeRouter();
  const store = options?.store ?? new InMemoryConversationStore();
  const adapters = options?.adapters ?? createDefaultAgentAdapterRegistry();

  router.register('runtime.get-status', async () => getRuntimeStatus(adapters));
  router.register('acp.get-available-agents', () => ({
    success: true,
    data: adapters.listAgents(),
  }));
  router.register('acp.probe-model-info', () => ({
    success: true,
    data: { modelInfo: null },
  }));
  router.register('database.get-user-conversations', (data) => {
    const params = asRecord(data);
    return store.listConversations(numberParam(params.page, 0), numberParam(params.pageSize, 100));
  });
  router.register('database.get-conversation-messages', (data) => {
    const params = asRecord(data);
    return store.getMessages(stringParam(params.conversation_id));
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
  router.register('create-conversation', (data) => {
    const params = asRecord(data);
    return store.createConversation({
      type: stringParam(params.type, 'acp'),
      name: stringParam(params.name, 'New conversation'),
      model: isModel(params.model) ? params.model : { id: '', useModel: '' },
      extra: isRecord(params.extra) ? (params.extra as Conversation['extra']) : {},
    } satisfies CreateConversationInput);
  });
  router.register('remove-conversation', (data) => {
    const params = asRecord(data);
    return store.removeConversation(stringParam(params.id));
  });
  router.register('update-conversation', (data) => {
    const params = asRecord(data);
    return store.updateConversation(stringParam(params.id), asRecord(params.updates) as Partial<Conversation>);
  });
  router.register('chat.send.message', async (data, context) => {
    const params = asRecord(data);
    const conversationId = stringParam(params.conversation_id);
    const input = stringParam(params.input);
    const files = stringArrayParam(params.files);
    const userMsgId = typeof params.msg_id === 'string' ? params.msg_id : undefined;
    const assistantMsgId = `assistant_${userMsgId || Date.now().toString(36)}`;
    const conversation = store.getConversation(conversationId);
    const backend = conversation?.extra.backend || 'opencode';
    const adapter = adapters.get(backend);
    if (!adapter) {
      throw new Error(`Agent adapter '${backend}' was not found`);
    }

    store.addTextMessage({
      conversationId,
      msgId: userMsgId,
      position: 'right',
      content: input,
    });

    context.emit('chat.response.stream', {
      type: 'start',
      msg_id: assistantMsgId,
      conversation_id: conversationId,
      data: null,
    });

    let assistantContent = '';
    for await (const event of adapter.sendMessage({
      conversationId,
      input,
      msgId: userMsgId,
      workspace: conversation?.extra.workspace,
      model: typeof conversation?.extra.currentModelId === 'string' ? conversation.extra.currentModelId : undefined,
      sessionMode: typeof conversation?.extra.sessionMode === 'string' ? conversation.extra.sessionMode : undefined,
      ...(files.length ? { files } : {}),
    })) {
      if (event.type === 'thought') {
        context.emit('chat.response.stream', {
          type: 'thought',
          msg_id: assistantMsgId,
          conversation_id: conversationId,
          data: { subject: event.subject, description: event.description },
        });
        continue;
      }

      assistantContent += event.content;
      context.emit('chat.response.stream', {
        type: 'content',
        msg_id: assistantMsgId,
        conversation_id: conversationId,
        data: { content: event.content },
      });
    }

    store.addTextMessage({
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

    return { success: true };
  });
  router.register('chat.stop.stream', () => ({ success: true }));
  router.register('confirmation.list', () => []);
  router.register('confirmation.confirm', () => ({ success: true }));
  router.register('conversation.get-workspace', () => []);
  router.register('read-file', () => {
    throw new Error('File reading is not wired yet');
  });
  router.register('get-image-base64', () => {
    throw new Error('Image reading is not wired yet');
  });

  return router;
}

export function getAvailableAgents(): AgentInfo[] {
  return createDefaultAgentAdapterRegistry().listAgents();
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

function stringArrayParam(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isModel(value: unknown): value is { id: string; useModel: string } {
  return isRecord(value) && typeof value.id === 'string' && typeof value.useModel === 'string';
}
