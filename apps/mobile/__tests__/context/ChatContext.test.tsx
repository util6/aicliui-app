import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { ChatProvider, useChat } from '@/src/context/ChatContext';
import { bridge } from '@/src/services/bridge';

jest.mock('@/src/services/bridge', () => ({
  bridge: {
    request: jest.fn(),
    on: jest.fn(() => jest.fn()),
  },
}));

const mockRequest = bridge.request as jest.Mock;

function Probe() {
  const { loadConversation, slashCommands } = useChat();

  useEffect(() => {
    loadConversation('conv-1');
  }, [loadConversation]);

  return <Text>{slashCommands.map((command) => command.name).join(',')}</Text>;
}

describe('ChatContext slash commands', () => {
  const listeners = new Map<string, (data: unknown) => void>();

  beforeEach(() => {
    listeners.clear();
    mockRequest.mockReset();
    (bridge.on as jest.Mock).mockImplementation((name: string, handler: (data: unknown) => void) => {
      listeners.set(name, handler);
      return jest.fn();
    });
  });

  it('loads slash commands when a conversation is opened', async () => {
    mockRequest.mockImplementation((name: string) => {
      if (name === 'database.get-conversation-messages') return Promise.resolve([]);
      if (name === 'conversation.get-slash-commands') {
        return Promise.resolve([
          {
            command: 'review',
            description: 'Review current changes',
            hint: 'focus on regressions',
          },
        ]);
      }
      return Promise.reject(new Error(`Unexpected bridge request ${name}`));
    });

    const screen = render(
      <ChatProvider>
        <Probe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByText('review')).toBeTruthy());
    expect(mockRequest).toHaveBeenCalledWith('conversation.get-slash-commands', {
      conversation_id: 'conv-1',
    });
  });

  it('refreshes slash commands when the agent reports command updates', async () => {
    mockRequest.mockImplementation((name: string) => {
      if (name === 'database.get-conversation-messages') return Promise.resolve([]);
      if (name === 'conversation.get-slash-commands') {
        const command = mockRequest.mock.calls.filter(([requestName]) => requestName === name).length === 1
          ? 'review'
          : 'test';
        return Promise.resolve([
          {
            command,
            description: `${command} command`,
          },
        ]);
      }
      return Promise.reject(new Error(`Unexpected bridge request ${name}`));
    });

    const screen = render(
      <ChatProvider>
        <Probe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByText('review')).toBeTruthy());

    await act(async () => {
      listeners.get('chat.response.stream')?.({
        type: 'slash_commands_updated',
        msg_id: 'assistant-1',
        conversation_id: 'conv-1',
        data: null,
      });
    });

    await waitFor(() => expect(screen.getByText('test')).toBeTruthy());
    expect(mockRequest).toHaveBeenCalledWith('conversation.get-slash-commands', {
      conversation_id: 'conv-1',
    });
    expect(mockRequest.mock.calls.filter(([name]) => name === 'conversation.get-slash-commands')).toHaveLength(2);
  });
});
