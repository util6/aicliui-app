export const BRIDGE_SUBSCRIBE_PREFIX = 'subscribe-';
export const BRIDGE_CALLBACK_PREFIX = 'subscribe.callback-';

export type BridgeMessage = {
  name: string;
  data?: unknown;
};

export type BridgeRequest = {
  key: string;
  id: string;
  data: unknown;
};

export function createBridgeRequestName(key: string): string {
  return `${BRIDGE_SUBSCRIBE_PREFIX}${key}`;
}

export function createBridgeCallbackName(key: string, id: string): string {
  return `${BRIDGE_CALLBACK_PREFIX}${key}${id}`;
}

export function parseBridgeRequestMessage(message: BridgeMessage): BridgeRequest | null {
  if (!message.name.startsWith(BRIDGE_SUBSCRIBE_PREFIX)) {
    return null;
  }

  if (!isRecord(message.data) || typeof message.data.id !== 'string') {
    return null;
  }

  return {
    key: message.name.slice(BRIDGE_SUBSCRIBE_PREFIX.length),
    id: message.data.id,
    data: message.data.data,
  };
}

export function createBridgeCallbackMessage(key: string, id: string, data: unknown): BridgeMessage {
  return {
    name: createBridgeCallbackName(key, id),
    data,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
