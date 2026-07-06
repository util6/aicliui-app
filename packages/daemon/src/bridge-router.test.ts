import { describe, expect, it } from 'vitest';
import { BridgeRouter } from './bridge-router.js';

describe('BridgeRouter', () => {
  it('routes AionUi subscribe requests and returns the matching callback envelope', async () => {
    const router = new BridgeRouter();
    router.register('database.get-user-conversations', async () => [{ id: 'conv-1' }]);

    const messages = await router.handleIncoming({
      name: 'subscribe-database.get-user-conversations',
      data: { id: 'm_1', data: { page: 0, pageSize: 100 } },
    });

    expect(messages).toEqual([
      {
        name: 'subscribe.callback-database.get-user-conversationsm_1',
        data: [{ id: 'conv-1' }],
      },
    ]);
  });

  it('returns a structured bridge error for unknown routes', async () => {
    const router = new BridgeRouter();

    const messages = await router.handleIncoming({
      name: 'subscribe-missing.route',
      data: { id: 'm_2', data: undefined },
    });

    expect(messages).toEqual([
      {
        name: 'subscribe.callback-missing.routem_2',
        data: {
          success: false,
          error: {
            code: 'BRIDGE_ROUTE_NOT_FOUND',
            message: "No bridge handler registered for 'missing.route'",
          },
        },
      },
    ]);
  });

  it('ignores non-request push messages', async () => {
    const router = new BridgeRouter();
    await expect(router.handleIncoming({ name: 'pong', data: { timestamp: 1 } })).resolves.toEqual([]);
  });

  it('allows handlers to emit server-push events alongside the callback', async () => {
    const router = new BridgeRouter();
    router.register('chat.send.message', async (_data, context) => {
      context.emit('chat.response.stream', { type: 'start', conversation_id: 'conv-1' });
      context.emit('chat.response.stream', { type: 'finish', conversation_id: 'conv-1' });
      return { success: true };
    });

    const messages = await router.handleIncoming({
      name: 'subscribe-chat.send.message',
      data: { id: 'm_3', data: { conversation_id: 'conv-1', input: 'hello' } },
    });

    expect(messages).toEqual([
      {
        name: 'subscribe.callback-chat.send.messagem_3',
        data: { success: true },
      },
      {
        name: 'chat.response.stream',
        data: { type: 'start', conversation_id: 'conv-1' },
      },
      {
        name: 'chat.response.stream',
        data: { type: 'finish', conversation_id: 'conv-1' },
      },
    ]);
  });
});
