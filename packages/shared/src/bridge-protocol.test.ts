import { describe, expect, it } from 'vitest';
import {
  createBridgeCallbackName,
  createBridgeRequestName,
  parseBridgeRequestMessage,
} from './bridge-protocol.js';

describe('AionUi-compatible bridge protocol', () => {
  it('formats subscribe request names exactly as AionUi mobile sends them', () => {
    expect(createBridgeRequestName('chat.send.message')).toBe('subscribe-chat.send.message');
  });

  it('formats callback names with the request id appended without a separator', () => {
    expect(createBridgeCallbackName('chat.send.message', 'm_1')).toBe(
      'subscribe.callback-chat.send.messagem_1',
    );
  });

  it('parses a valid subscribe message into route key, request id, and data', () => {
    expect(
      parseBridgeRequestMessage({
        name: 'subscribe-database.get-user-conversations',
        data: { id: 'm_2', data: { page: 0, pageSize: 100 } },
      }),
    ).toEqual({
      key: 'database.get-user-conversations',
      id: 'm_2',
      data: { page: 0, pageSize: 100 },
    });
  });

  it('rejects direct push events and malformed subscribe payloads', () => {
    expect(parseBridgeRequestMessage({ name: 'chat.response.stream', data: {} })).toBeNull();
    expect(parseBridgeRequestMessage({ name: 'subscribe-chat.send.message', data: {} })).toBeNull();
    expect(parseBridgeRequestMessage({ name: 'subscribe-chat.send.message', data: { id: 42 } })).toBeNull();
  });
});
