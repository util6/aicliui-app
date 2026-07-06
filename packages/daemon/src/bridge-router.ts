import {
  createBridgeCallbackMessage,
  type BridgeError,
  type BridgeMessage,
  parseBridgeRequestMessage,
} from '@aicliui/shared';

export type BridgeRouteContext = {
  key: string;
  id: string;
};

export type BridgeRouteHandler = (data: unknown, context: BridgeRouteContext) => Promise<unknown> | unknown;

export class BridgeRouter {
  private readonly handlers = new Map<string, BridgeRouteHandler>();

  register(key: string, handler: BridgeRouteHandler): void {
    this.handlers.set(key, handler);
  }

  async handleIncoming(message: BridgeMessage): Promise<BridgeMessage[]> {
    const request = parseBridgeRequestMessage(message);
    if (!request) {
      return [];
    }

    const handler = this.handlers.get(request.key);
    if (!handler) {
      return [
        createBridgeCallbackMessage(
          request.key,
          request.id,
          bridgeError('BRIDGE_ROUTE_NOT_FOUND', `No bridge handler registered for '${request.key}'`),
        ),
      ];
    }

    try {
      const data = await handler(request.data, { key: request.key, id: request.id });
      return [createBridgeCallbackMessage(request.key, request.id, data)];
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bridge route failed';
      return [
        createBridgeCallbackMessage(
          request.key,
          request.id,
          bridgeError('BRIDGE_ROUTE_FAILED', message),
        ),
      ];
    }
  }
}

function bridgeError(code: string, message: string): BridgeError {
  return {
    success: false,
    error: {
      code,
      message,
    },
  };
}
