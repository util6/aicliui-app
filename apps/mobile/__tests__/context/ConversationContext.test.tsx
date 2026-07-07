import React from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { ConversationProvider, useConversations, type Conversation } from '@/src/context/ConversationContext';
import { bridge } from '@/src/services/bridge';

jest.mock('@/src/services/bridge', () => ({
  bridge: {
    request: jest.fn(),
    on: jest.fn(() => jest.fn()),
  },
}));

jest.mock('@/src/context/ConnectionContext', () => ({
  useConnection: jest.fn(() => ({
    connectionState: 'connected',
    config: {},
  })),
}));

const mockRequest = bridge.request as jest.Mock;

function Probe() {
  const { conversations } = useConversations();
  return <Text testID='status'>{conversations.map((conversation) => conversation.status).join(',')}</Text>;
}

function conversationWithStatus(status: Conversation['status']): Conversation {
  return {
    id: 'conv-1',
    name: 'Agent task',
    type: 'acp',
    status,
    createTime: 1000,
    modifyTime: 1000,
    model: { id: '', useModel: '' },
    extra: { backend: 'opencode' },
  };
}

describe('ConversationContext stream status sync', () => {
  const listeners = new Map<string, (data: unknown) => void>();

  beforeEach(() => {
    listeners.clear();
    jest.useFakeTimers();
    mockRequest.mockReset();
    (bridge.on as jest.Mock).mockImplementation((name: string, handler: (data: unknown) => void) => {
      listeners.set(name, handler);
      return jest.fn();
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('marks a conversation running when a stream starts', async () => {
    mockRequest.mockImplementation((name: string) => {
      if (name === 'database.get-user-conversations') return Promise.resolve([conversationWithStatus('finished')]);
      return Promise.reject(new Error(`Unexpected bridge request ${name}`));
    });

    const screen = render(
      <ConversationProvider>
        <Probe />
      </ConversationProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').props.children).toBe('finished'));

    await act(async () => {
      listeners.get('chat.response.stream')?.({
        type: 'start',
        conversation_id: 'conv-1',
      });
    });

    expect(screen.getByTestId('status').props.children).toBe('running');
  });

  it('marks a conversation finished when a stream terminates', async () => {
    let persistedStatus: Conversation['status'] = 'running';
    mockRequest.mockImplementation((name: string) => {
      if (name === 'database.get-user-conversations') return Promise.resolve([conversationWithStatus(persistedStatus)]);
      return Promise.reject(new Error(`Unexpected bridge request ${name}`));
    });

    const screen = render(
      <ConversationProvider>
        <Probe />
      </ConversationProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').props.children).toBe('running'));

    await act(async () => {
      listeners.get('chat.response.stream')?.({
        type: 'finish',
        conversation_id: 'conv-1',
      });
    });

    expect(screen.getByTestId('status').props.children).toBe('finished');
    expect(mockRequest.mock.calls.filter(([name]) => name === 'database.get-user-conversations')).toHaveLength(1);

    persistedStatus = 'finished';
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await waitFor(() =>
      expect(mockRequest.mock.calls.filter(([name]) => name === 'database.get-user-conversations')).toHaveLength(2),
    );
  });
});
