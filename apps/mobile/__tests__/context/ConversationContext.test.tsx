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

function RuntimeProbe() {
  const { conversations } = useConversations();
  const conversation = conversations.find((item) => item.id === 'conv-1');
  return (
    <Text testID='runtime'>
      {conversation
        ? `${conversation.status}|${conversation.runtime?.state ?? ''}|${String(conversation.runtime?.can_send_message)}|${conversation.runtime?.turn_id ?? ''}`
        : ''}
    </Text>
  );
}

function ListProbe() {
  const { conversations, activeConversationId } = useConversations();
  return (
    <>
      <Text testID='conversation-ids'>{conversations.map((conversation) => conversation.id).join(',')}</Text>
      <Text testID='active-conversation'>{activeConversationId ?? ''}</Text>
    </>
  );
}

function AgentsProbe() {
  const { availableAgents, fetchAgents, startNewChat, pendingAgent } = useConversations();
  return (
    <>
      <Text testID='agents'>{availableAgents.map((agent) => `${agent.backend}:${agent.state}:${agent.detail ?? ''}`).join('|')}</Text>
      <Text testID='pending-agent'>{pendingAgent?.backend ?? ''}</Text>
      <Text
        testID='fetch-agents'
        onPress={() => {
          void fetchAgents();
        }}
      >
        fetch-agents
      </Text>
      <Text
        testID='start-opencode'
        onPress={() => {
          startNewChat(availableAgents[0]);
        }}
      >
        start-opencode
      </Text>
    </>
  );
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

function CustomAgentNewChatProbe() {
  const { startNewChat, commitNewChat } = useConversations();

  React.useEffect(() => {
    startNewChat({
      id: 'custom-1',
      backend: 'custom-1',
      source: 'custom',
      name: 'My CLI',
      label: 'My CLI',
    });
  }, [startNewChat]);

  return <Text testID='commit-custom' onPress={() => void commitNewChat('Run custom task')}>commit</Text>;
}

function ExecutionContextProbe() {
  const { conversations, updateConversationExecutionContext } = useConversations();
  const conversation = conversations.find((item) => item.id === 'conv-1');

  return (
    <>
      <Text testID='execution-context'>
        {conversation
          ? `${conversation.extra.currentModelLabel ?? ''}|${conversation.extra.sessionMode ?? ''}|${conversation.extra.workspace ?? ''}`
          : ''}
      </Text>
      <Text
        testID='update-execution-context'
        onPress={() => {
          void updateConversationExecutionContext('conv-1', {
            currentModelId: 'gpt-5-codex',
            currentModelLabel: 'GPT-5 Codex',
            sessionMode: 'autoEdit',
          });
        }}
      >
        update-execution-context
      </Text>
    </>
  );
}

function PinProbe() {
  const { conversations, setConversationPinned } = useConversations();
  const conversation = conversations.find((item) => item.id === 'conv-1');

  return (
    <>
      <Text testID='pin-state'>{String(conversation?.pinned ?? false)}</Text>
      <Text
        testID='pin-conversation'
        onPress={() => {
          void setConversationPinned('conv-1', true);
        }}
      >
        pin-conversation
      </Text>
    </>
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

  it('refreshes the conversation list when AionUi listChanged reports create or update', async () => {
    let conversations = [conversationWithStatus('finished')];
    mockRequest.mockImplementation((name: string) => {
      if (name === 'database.get-user-conversations') return Promise.resolve(conversations);
      return Promise.reject(new Error(`Unexpected bridge request ${name}`));
    });

    const screen = render(
      <ConversationProvider>
        <ListProbe />
      </ConversationProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('conversation-ids').props.children).toBe('conv-1'));

    conversations = [
      { ...conversationWithStatus('running'), name: 'Updated task' },
      {
        ...conversationWithStatus('finished'),
        id: 'conv-2',
        name: 'New task',
      },
    ];

    await act(async () => {
      listeners.get('conversation.listChanged')?.({
        conversation_id: 'conv-2',
        action: 'created',
      });
    });

    await waitFor(() => expect(screen.getByTestId('conversation-ids').props.children).toBe('conv-1,conv-2'));
    expect(mockRequest.mock.calls.filter(([name]) => name === 'database.get-user-conversations')).toHaveLength(2);
  });

  it('removes deleted conversations from local state and reselects the next conversation', async () => {
    let conversations = [
      conversationWithStatus('finished'),
      {
        ...conversationWithStatus('finished'),
        id: 'conv-2',
        name: 'Second task',
      },
    ];
    mockRequest.mockImplementation((name: string) => {
      if (name === 'database.get-user-conversations') return Promise.resolve(conversations);
      return Promise.reject(new Error(`Unexpected bridge request ${name}`));
    });

    const screen = render(
      <ConversationProvider>
        <ListProbe />
      </ConversationProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('conversation-ids').props.children).toBe('conv-1,conv-2'));
    expect(screen.getByTestId('active-conversation').props.children).toBe('conv-1');

    conversations = [conversations[1]];
    await act(async () => {
      listeners.get('conversation.listChanged')?.({
        conversation_id: 'conv-1',
        action: 'deleted',
      });
    });

    expect(screen.getByTestId('conversation-ids').props.children).toBe('conv-2');
    expect(screen.getByTestId('active-conversation').props.children).toBe('conv-2');
    await waitFor(() => expect(mockRequest.mock.calls.filter(([name]) => name === 'database.get-user-conversations')).toHaveLength(2));
  });

  it('applies turn.completed runtime summaries from the local daemon', async () => {
    mockRequest.mockImplementation((name: string) => {
      if (name === 'database.get-user-conversations') {
        return Promise.resolve([
          {
            ...conversationWithStatus('running'),
            runtime: {
              state: 'running',
              can_send_message: false,
              has_task: true,
              task_status: 'running',
              is_processing: true,
              pending_confirmations: 0,
              turn_id: 'assistant_user-msg-turn',
            },
          },
        ]);
      }
      return Promise.reject(new Error(`Unexpected bridge request ${name}`));
    });

    const screen = render(
      <ConversationProvider>
        <RuntimeProbe />
      </ConversationProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('runtime').props.children).toBe('running|running|false|assistant_user-msg-turn'),
    );

    await act(async () => {
      listeners.get('turn.completed')?.({
        session_id: 'conv-1',
        turn_id: 'assistant_user-msg-turn',
        status: 'finished',
        runtime: {
          state: 'idle',
          can_send_message: true,
          has_task: false,
          task_status: 'finished',
          is_processing: false,
          pending_confirmations: 0,
          turn_id: null,
        },
      });
    });

    expect(screen.getByTestId('runtime').props.children).toBe('finished|idle|true|');
  });

  it('accepts AionUi bridge aliases on turn.completed runtime summaries', async () => {
    mockRequest.mockImplementation((name: string) => {
      if (name === 'database.get-user-conversations') {
        return Promise.resolve([
          {
            ...conversationWithStatus('running'),
            runtime: {
              state: 'running',
              can_send_message: false,
              has_task: true,
              task_status: 'running',
              is_processing: true,
              pending_confirmations: 0,
              turn_id: 'assistant_user-msg-turn',
            },
          },
        ]);
      }
      return Promise.reject(new Error(`Unexpected bridge request ${name}`));
    });

    const screen = render(
      <ConversationProvider>
        <RuntimeProbe />
      </ConversationProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('runtime').props.children).toBe('running|running|false|assistant_user-msg-turn'),
    );

    await act(async () => {
      listeners.get('turn.completed')?.({
        sessionId: 'conv-1',
        runtime: {
          state: 'idle',
          canSendMessage: true,
          hasTask: false,
          taskStatus: 'finished',
          isProcessing: false,
          pendingConfirmations: 0,
          turnId: null,
        },
      });
    });

    expect(screen.getByTestId('runtime').props.children).toBe('finished|idle|true|');
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

  it('persists the catalog id and source required to launch a custom ACP agent', async () => {
    mockRequest.mockImplementation((name: string, data?: unknown) => {
      if (name === 'database.get-user-conversations') return Promise.resolve([]);
      if (name === 'create-conversation') {
        return Promise.resolve({
          id: 'custom-chat-1',
          name: 'Run custom task',
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
        <CustomAgentNewChatProbe />
      </ConversationProvider>,
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('commit-custom'));
    });

    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith(
      'create-conversation',
      expect.objectContaining({
        type: 'acp',
        extra: expect.objectContaining({
          backend: 'custom-1',
          agent_id: 'custom-1',
          agent_source: 'custom',
        }),
      }),
    ));
  });

  it('merges local runtime health into available agent rows', async () => {
    mockRequest.mockImplementation((name: string) => {
      if (name === 'database.get-user-conversations') return Promise.resolve([]);
      if (name === 'acp.get-available-agents') {
        return Promise.resolve({
          success: true,
          data: [
            { backend: 'opencode', name: 'opencode', label: 'OpenCode' },
            { backend: 'codex', name: 'codex', label: 'Codex CLI' },
          ],
        });
      }
      if (name === 'runtime.get-status') {
        return Promise.resolve({
          daemon: { version: '0.1.0', startedAt: 1000 },
          agents: [
            { backend: 'opencode', state: 'ready', version: '1.0.0' },
            { backend: 'codex', state: 'missing', detail: 'codex command not found' },
          ],
        });
      }
      return Promise.reject(new Error(`Unexpected bridge request ${name}`));
    });

    const screen = render(
      <ConversationProvider>
        <AgentsProbe />
      </ConversationProvider>,
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('fetch-agents'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('agents').props.children).toBe(
        'opencode:ready:|codex:missing:codex command not found',
      ),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId('start-opencode'));
    });
    expect(screen.getByTestId('pending-agent').props.children).toBe('opencode');
  });
});

describe('ConversationContext execution context updates', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    (bridge.on as jest.Mock).mockImplementation(() => jest.fn());
  });

  it('persists active conversation model and mode changes without dropping existing extra metadata', async () => {
    let conversation: Conversation = {
      id: 'conv-1',
      name: 'Inspect project',
      type: 'acp',
      status: 'finished',
      createTime: 1000,
      modifyTime: 1000,
      model: { id: '', useModel: '' },
      extra: {
        backend: 'codex',
        workspace: '/tmp/project',
        currentModelId: 'gpt-4.1',
        currentModelLabel: 'GPT-4.1',
        sessionMode: 'default',
      },
    };

    mockRequest.mockImplementation((name: string, data?: unknown) => {
      if (name === 'database.get-user-conversations') return Promise.resolve([conversation]);
      if (name === 'update-conversation') {
        const updates = (data as { updates?: Partial<Conversation> }).updates ?? {};
        conversation = {
          ...conversation,
          ...updates,
          extra: {
            ...conversation.extra,
            ...(updates.extra ?? {}),
          },
        };
        return Promise.resolve(true);
      }
      return Promise.reject(new Error(`Unexpected bridge request ${name}`));
    });

    const screen = render(
      <ConversationProvider>
        <ExecutionContextProbe />
      </ConversationProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('execution-context').props.children).toBe('GPT-4.1|default|/tmp/project'));

    await act(async () => {
      fireEvent.press(screen.getByTestId('update-execution-context'));
    });

    expect(mockRequest).toHaveBeenCalledWith('update-conversation', {
      id: 'conv-1',
      updates: {
        extra: {
          currentModelId: 'gpt-5-codex',
          currentModelLabel: 'GPT-5 Codex',
          sessionMode: 'autoEdit',
        },
      },
    });
    await waitFor(() => expect(screen.getByTestId('execution-context').props.children).toBe('GPT-5 Codex|autoEdit|/tmp/project'));
  });

  it('updates the canonical pinned field through the conversation endpoint', async () => {
    let conversation = conversationWithStatus('finished');

    mockRequest.mockImplementation((name: string, data?: unknown) => {
      if (name === 'database.get-user-conversations') return Promise.resolve([conversation]);
      if (name === 'update-conversation') {
        const updates = (data as { updates?: Partial<Conversation> }).updates ?? {};
        conversation = { ...conversation, ...updates };
        return Promise.resolve(true);
      }
      return Promise.reject(new Error(`Unexpected bridge request ${name}`));
    });

    const screen = render(
      <ConversationProvider>
        <PinProbe />
      </ConversationProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('pin-state').props.children).toBe('false'));

    await act(async () => {
      fireEvent.press(screen.getByTestId('pin-conversation'));
    });

    expect(mockRequest).toHaveBeenCalledWith('update-conversation', {
      id: 'conv-1',
      updates: { pinned: true },
    });
    await waitFor(() => expect(screen.getByTestId('pin-state').props.children).toBe('true'));
  });
});
