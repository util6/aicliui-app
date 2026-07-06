import type { AgentInfo, Conversation, RuntimeStatus } from '@aicliui/shared';
import { BridgeRouter } from './bridge-router.js';
import { InMemoryConversationStore, type CreateConversationInput } from './conversation-store.js';

const startedAt = Date.now();

type DefaultRouterOptions = {
  store?: InMemoryConversationStore;
};

export function createDefaultRouter(options?: DefaultRouterOptions): BridgeRouter {
  const router = new BridgeRouter();
  const store = options?.store ?? new InMemoryConversationStore();

  router.register('runtime.get-status', () => getRuntimeStatus());
  router.register('acp.get-available-agents', () => ({
    success: true,
    data: getAvailableAgents(),
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
  router.register('chat.send.message', (data, context) => {
    const params = asRecord(data);
    const conversationId = stringParam(params.conversation_id);
    const input = stringParam(params.input);
    const userMsgId = typeof params.msg_id === 'string' ? params.msg_id : undefined;
    const assistantMsgId = `assistant_${userMsgId || Date.now().toString(36)}`;
    const assistantContent = `Local daemon received: ${input}`;

    store.addTextMessage({
      conversationId,
      msgId: userMsgId,
      position: 'right',
      content: input,
    });
    store.addTextMessage({
      conversationId,
      msgId: assistantMsgId,
      position: 'left',
      content: assistantContent,
    });

    context.emit('chat.response.stream', {
      type: 'start',
      msg_id: assistantMsgId,
      conversation_id: conversationId,
      data: null,
    });
    context.emit('chat.response.stream', {
      type: 'content',
      msg_id: assistantMsgId,
      conversation_id: conversationId,
      data: { content: assistantContent },
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
  return [
    { backend: 'opencode', name: 'opencode', label: 'OpenCode' },
    { backend: 'gemini', name: 'gemini', label: 'Gemini CLI' },
  ];
}

export function getRuntimeStatus(): RuntimeStatus {
  return {
    daemon: {
      version: '0.1.0',
      startedAt,
    },
    termux: {
      runCommandPermission: 'unknown',
      allowExternalApps: 'unknown',
    },
    agents: [
      { backend: 'opencode', state: 'missing' },
      { backend: 'gemini', state: 'missing' },
    ],
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

function isModel(value: unknown): value is { id: string; useModel: string } {
  return isRecord(value) && typeof value.id === 'string' && typeof value.useModel === 'string';
}
