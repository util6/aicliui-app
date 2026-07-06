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
});
