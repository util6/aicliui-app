import { describe, expect, it } from 'vitest';
import { createDefaultRouter } from './default-router.js';
import { InMemoryConversationStore } from './conversation-store.js';

describe('default bridge routes', () => {
  it('creates conversations and lists them in AionUi mobile shape', async () => {
    const store = new InMemoryConversationStore({ now: () => 1000, id: () => 'conv-1' });
    const router = createDefaultRouter({ store });

    const [created] = await router.handleIncoming({
      name: 'subscribe-create-conversation',
      data: {
        id: 'm_create',
        data: {
          type: 'acp',
          name: 'hello',
          model: { id: '', useModel: '' },
          extra: { backend: 'opencode', agentName: 'opencode' },
        },
      },
    });
    const [listed] = await router.handleIncoming({
      name: 'subscribe-database.get-user-conversations',
      data: { id: 'm_list', data: { page: 0, pageSize: 100 } },
    });

    expect(created.data).toMatchObject({
      id: 'conv-1',
      name: 'hello',
      type: 'acp',
      extra: { backend: 'opencode' },
    });
    expect(listed.data).toEqual([created.data]);
  });

  it('stores user messages and emits assistant stream events for mobile chat UI', async () => {
    let nextId = 0;
    const store = new InMemoryConversationStore({
      now: () => 2000 + nextId,
      id: () => `id-${++nextId}`,
    });
    const router = createDefaultRouter({ store });

    await router.handleIncoming({
      name: 'subscribe-create-conversation',
      data: {
        id: 'm_create',
        data: {
          type: 'acp',
          name: 'hello',
          model: { id: '', useModel: '' },
          extra: { backend: 'opencode' },
        },
      },
    });

    const messages = await router.handleIncoming({
      name: 'subscribe-chat.send.message',
      data: {
        id: 'm_send',
        data: { conversation_id: 'id-1', msg_id: 'user-msg-1', input: 'hello daemon' },
      },
    });

    expect(messages.map((message) => message.name)).toEqual([
      'subscribe.callback-chat.send.messagem_send',
      'chat.response.stream',
      'chat.response.stream',
      'chat.response.stream',
    ]);
    expect(messages[1].data).toMatchObject({ type: 'start', conversation_id: 'id-1' });
    expect(messages[2].data).toMatchObject({
      type: 'content',
      conversation_id: 'id-1',
      data: { content: 'Local daemon received: hello daemon' },
    });
    expect(messages[3].data).toMatchObject({ type: 'finish', conversation_id: 'id-1' });

    const [history] = await router.handleIncoming({
      name: 'subscribe-database.get-conversation-messages',
      data: { id: 'm_history', data: { conversation_id: 'id-1' } },
    });
    expect(history.data).toMatchObject([
      {
        msg_id: 'user-msg-1',
        type: 'text',
        position: 'right',
        content: { content: 'hello daemon' },
      },
      {
        type: 'text',
        position: 'left',
        content: { content: 'Local daemon received: hello daemon' },
      },
    ]);
  });
});
