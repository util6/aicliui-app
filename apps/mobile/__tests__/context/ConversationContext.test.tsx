import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
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

function NewChatProbe() {
  const { startNewChat, commitNewChat } = useConversations();

  React.useEffect(() => {
    startNewChat({ backend: 'opencode', name: 'opencode', label: 'OpenCode' });
  }, [startNewChat]);

  return (
    <Text
      testID='commit'
      onPress={() => {
        void commitNewChat('Inspect this workspace', {
          workspace: '/tmp/project',
          customWorkspace: true,
          defaultFiles: ['/tmp/project/README.md'],
          sessionMode: 'plan',
          currentModelId: 'anthropic/claude-sonnet-4',
          currentModelLabel: 'Claude Sonnet 4',
        });
      }}
    >
      commit
    </Text>
  );
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

  it('marks a conversation running when generation output arrives before start', async () => {
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
        type: 'thought',
        conversation_id: 'conv-1',
      });
    });

    expect(screen.getByTestId('status').props.children).toBe('running');
  });

  it('marks a conversation waiting while a confirmation is pending', async () => {
    mockRequest.mockImplementation((name: string) => {
      if (name === 'database.get-user-conversations') return Promise.resolve([conversationWithStatus('running')]);
      return Promise.reject(new Error(`Unexpected bridge request ${name}`));
    });

    const screen = render(
      <ConversationProvider>
        <Probe />
      </ConversationProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').props.children).toBe('running'));

    await act(async () => {
      listeners.get('confirmation.add')?.({
        id: 'permission-1',
        conversation_id: 'conv-1',
      });
    });

    expect(screen.getByTestId('status').props.children).toBe('waiting_confirmation');

    await act(async () => {
      listeners.get('confirmation.remove')?.({
        id: 'permission-1',
        conversation_id: 'conv-1',
      });
    });

    expect(screen.getByTestId('status').props.children).toBe('running');
  });

  it('marks stream permission messages as waiting for confirmation', async () => {
    mockRequest.mockImplementation((name: string) => {
      if (name === 'database.get-user-conversations') return Promise.resolve([conversationWithStatus('running')]);
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
        type: 'acp_permission',
        conversation_id: 'conv-1',
      });
    });

    expect(screen.getByTestId('status').props.children).toBe('waiting_confirmation');
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

  it('ignores late generation output after a stream terminates until the next start', async () => {
    mockRequest.mockImplementation((name: string) => {
      if (name === 'database.get-user-conversations') return Promise.resolve([conversationWithStatus('running')]);
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
      listeners.get('chat.response.stream')?.({
        type: 'thought',
        conversation_id: 'conv-1',
      });
      listeners.get('chat.response.stream')?.({
        type: 'acp_permission',
        conversation_id: 'conv-1',
      });
      listeners.get('confirmation.add')?.({
        id: 'permission-late',
        conversation_id: 'conv-1',
      });
    });

    expect(screen.getByTestId('status').props.children).toBe('finished');

    await act(async () => {
      listeners.get('chat.response.stream')?.({
        type: 'start',
        conversation_id: 'conv-1',
      });
    });

    expect(screen.getByTestId('status').props.children).toBe('running');
  });
});

describe('ConversationContext new chat context', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    (bridge.on as jest.Mock).mockImplementation(() => jest.fn());
  });

  it('persists selected execution context when committing a pending mobile chat', async () => {
    mockRequest.mockImplementation((name: string, data?: unknown) => {
      if (name === 'database.get-user-conversations') return Promise.resolve([]);
      if (name === 'create-conversation') {
        return Promise.resolve({
          id: 'new-chat-1',
          name: 'Inspect this workspace',
          type: 'acp',
          status: 'pending',
          createTime: 1000,
          modifyTime: 1000,
          model: { id: '', useModel: '' },
          extra: (data as { extra?: unknown }).extra,
        });
      }
      return Promise.reject(new Error(`Unexpected bridge request ${name}`));
    });

    const screen = render(
      <ConversationProvider>
        <NewChatProbe />
      </ConversationProvider>,
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('commit'));
    });

    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith(
        'create-conversation',
        expect.objectContaining({
          type: 'acp',
          name: 'Inspect this workspace',
          extra: expect.objectContaining({
            backend: 'opencode',
            agentName: 'opencode',
            workspace: '/tmp/project',
            customWorkspace: true,
            defaultFiles: ['/tmp/project/README.md'],
            sessionMode: 'plan',
            currentModelId: 'anthropic/claude-sonnet-4',
            currentModelLabel: 'Claude Sonnet 4',
          }),
        }),
      ),
    );
  });
});
