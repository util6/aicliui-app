import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ChatProvider, useChat } from '@/src/context/ChatContext';
import { bridge } from '@/src/services/bridge';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@/src/services/bridge', () => ({
  bridge: {
    request: jest.fn(),
    on: jest.fn(() => jest.fn()),
  },
}));

const mockRequest = bridge.request as jest.Mock;
const mockAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

function Probe() {
  const { loadConversation, slashCommands } = useChat();

  useEffect(() => {
    loadConversation('conv-1');
  }, [loadConversation]);

  return <Text>{slashCommands.map((command) => command.name).join(',')}</Text>;
}

function RuntimeProbe() {
  const {
    loadConversation,
    isStreaming,
    canSendMessage,
    queuedCommands,
    queuedCommandWarning,
    queuedCommandDraft,
    thought,
    messages,
    contextUsage,
    confirmations,
    artifacts,
    sendMessage,
    removeQueuedCommand,
    editQueuedCommand,
    clearQueuedCommandDraft,
    clearQueuedCommands,
    isQueuePaused,
    resumeQueuedCommands,
    moveQueuedCommand,
    updateArtifactStatus,
  } = useChat();

  useEffect(() => {
    loadConversation('conv-1');
  }, [loadConversation]);

  return (
    <>
      <Text testID='streaming'>{isStreaming ? 'streaming' : 'idle'}</Text>
      <Text testID='can-send'>{canSendMessage ? 'can-send' : 'blocked'}</Text>
      <Text testID='queued-count'>{queuedCommands.length}</Text>
      <Text testID='queued-items'>
        {queuedCommands.map((command) => `${command.input}:${command.files.length}`).join('|')}
      </Text>
      <Text testID='queue-paused'>{isQueuePaused ? 'paused' : 'active'}</Text>
      <Text testID='queue-warning'>{queuedCommandWarning ?? ''}</Text>
      <Text testID='queue-draft'>
        {queuedCommandDraft
          ? `${queuedCommandDraft.text}:${queuedCommandDraft.files.length}`
          : ''}
      </Text>
      <Text testID='thought'>{thought?.subject ?? ''}</Text>
      <Text testID='messages'>{messages.map((message) => message.content?.content ?? '').join('|')}</Text>
      <Text testID='message-count'>{messages.length}</Text>
      <Text testID='message-types'>{messages.map((message) => message.type).join('|')}</Text>
      <Text testID='message-meta'>
        {messages
          .map((message) => `${message.msg_id ?? ''}:${message.position ?? ''}:${message.status ?? ''}:${message.created_at ?? message.createdAt ?? ''}`)
          .join('|')}
      </Text>
      <Text testID='permission-titles'>
        {messages
          .filter((message) => message.type === 'acp_permission')
          .map((message) => message.content?.title ?? '')
          .join('|')}
      </Text>
      <Text testID='confirmations'>{confirmations.map((confirmation) => confirmation.id).join('|')}</Text>
      <Text testID='artifacts'>{artifacts.map((artifact) => `${artifact.id}:${artifact.status}`).join('|')}</Text>
      <Text testID='confirmation-titles'>
        {confirmations.map((confirmation) => confirmation.title ?? '').join('|')}
      </Text>
      <Text testID='context-usage'>
        {contextUsage ? `${contextUsage.used}/${contextUsage.size}` : ''}
      </Text>
      <Text testID='thinking-status'>
        {messages.filter((message) => message.type === 'thinking').map((message) => message.content?.status).join('|')}
      </Text>
      <Text testID='thinking-duration'>
        {messages.filter((message) => message.type === 'thinking').map((message) => message.content?.duration ?? '').join('|')}
      </Text>
      <Text testID='send' onPress={() => sendMessage('hello')}>
        send
      </Text>
      <Text testID='send-second' onPress={() => sendMessage('second')}>
        send-second
      </Text>
      <Text testID='send-third' onPress={() => sendMessage('third')}>
        send-third
      </Text>
      <Text testID='send-files' onPress={() => sendMessage('with files', ['src/App.tsx', 'src/App.tsx', ''])}>
        send-files
      </Text>
      <Text
        testID='send-too-many-files'
        onPress={() => sendMessage(
          'too many files',
          Array.from({ length: 51 }, (_, index) => `src/file-${index}.ts`),
        )}
      >
        send-too-many-files
      </Text>
      <Text testID='remove-first-queued' onPress={() => {
        const [first] = queuedCommands;
        if (first) removeQueuedCommand(first.id);
      }}>
        remove-first-queued
      </Text>
      <Text testID='edit-first-queued' onPress={() => {
        const [first] = queuedCommands;
        if (first) editQueuedCommand(first.id);
      }}>
        edit-first-queued
      </Text>
      <Text
        testID='clear-queue-draft'
        onPress={() => {
          if (queuedCommandDraft) clearQueuedCommandDraft(queuedCommandDraft.id);
        }}
      >
        clear-queue-draft
      </Text>
      <Text testID='clear-queue' onPress={clearQueuedCommands}>
        clear-queue
      </Text>
      <Text testID='resume-queue' onPress={resumeQueuedCommands}>
        resume-queue
      </Text>
      <Text
        testID='dismiss-first-artifact'
        onPress={() => {
          const [first] = artifacts;
          if (first) void updateArtifactStatus(first.id, 'dismissed');
        }}
      >
        dismiss-first-artifact
      </Text>
      <Text
        testID='move-last-up'
        onPress={() => {
          const last = queuedCommands.at(-1);
          if (last) moveQueuedCommand(last.id, 'up');
        }}
      >
        move-last-up
      </Text>
      <Text
        testID='move-first-down'
        onPress={() => {
          const [first] = queuedCommands;
          if (first) moveQueuedCommand(first.id, 'down');
        }}
      >
        move-first-down
      </Text>
    </>
  );
}

function ConfirmProbe() {
  const { loadConversation, confirmAction } = useChat();
  const [status, setStatus] = useState('');

  useEffect(() => {
    loadConversation('conv-1');
  }, [loadConversation]);

  return (
    <Text
      testID='confirm-action'
      onPress={() => {
        void confirmAction('permission-1', 'call-1', 'reject')
          .then(() => setStatus('sent'))
          .catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
      }}
    >
      {status}
    </Text>
  );
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
      if (name === 'conversation.get') return Promise.resolve(null);
      if (name === 'confirmation.list') return Promise.resolve([]);
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
      if (name === 'conversation.get') return Promise.resolve(null);
      if (name === 'confirmation.list') return Promise.resolve([]);
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

describe('ChatContext runtime state', () => {
  const listeners = new Map<string, (data: unknown) => void>();

  beforeEach(() => {
    listeners.clear();
    mockRequest.mockReset();
    mockAsyncStorage.getItem.mockReset();
    mockAsyncStorage.setItem.mockReset();
    mockAsyncStorage.removeItem.mockReset();
    mockAsyncStorage.getItem.mockResolvedValue(null);
    mockAsyncStorage.setItem.mockResolvedValue(undefined);
    mockAsyncStorage.removeItem.mockResolvedValue(undefined);
    mockRequest.mockImplementation((name: string) => {
      if (name === 'database.get-conversation-messages') return Promise.resolve([]);
      if (name === 'conversation.get') return Promise.resolve(null);
      if (name === 'conversation.get-slash-commands') return Promise.resolve([]);
      if (name === 'conversation.list-artifacts') return Promise.resolve([]);
      if (name === 'confirmation.list') return Promise.resolve([]);
      if (name === 'chat.send.message') return Promise.resolve({ success: true });
      if (name === 'conversation.update-artifact') {
        return Promise.resolve({
          id: 'artifact-1',
          conversation_id: 'conv-1',
          kind: 'skill_suggest',
          status: 'dismissed',
          payload: {
            cron_job_id: 'cron-1',
            name: 'Review skill',
            description: 'Review local changes',
            skill_content: '# Review',
          },
          created_at: 1200,
          updated_at: 1300,
        });
      }
      return Promise.reject(new Error(`Unexpected bridge request ${name}`));
    });
    (bridge.on as jest.Mock).mockImplementation((name: string, handler: (data: unknown) => void) => {
      listeners.set(name, handler);
      return jest.fn();
    });
  });

  it('stops streaming and renders an error tip when the agent reports an error', async () => {
    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('streaming').props.children).toBe('idle'));

    await act(async () => {
      listeners.get('chat.response.stream')?.({
        type: 'start',
        msg_id: 'assistant-1',
        conversation_id: 'conv-1',
        data: null,
      });
    });
    expect(screen.getByTestId('streaming').props.children).toBe('streaming');

    await act(async () => {
      listeners.get('chat.response.stream')?.({
        type: 'error',
        msg_id: 'assistant-1',
        conversation_id: 'conv-1',
        data: { message: 'OpenCode runtime failed' },
      });
    });

    expect(screen.getByTestId('streaming').props.children).toBe('idle');
    expect(screen.getByTestId('messages').props.children).toContain('OpenCode runtime failed');
  });

  it('ignores late thought events after finish for streaming state', async () => {
    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('streaming').props.children).toBe('idle'));

    await act(async () => {
      listeners.get('chat.response.stream')?.({
        type: 'start',
        msg_id: 'assistant-1',
        conversation_id: 'conv-1',
        data: null,
      });
      listeners.get('chat.response.stream')?.({
        type: 'finish',
        msg_id: 'assistant-1',
        conversation_id: 'conv-1',
        data: null,
      });
      listeners.get('chat.response.stream')?.({
        type: 'thought',
        msg_id: 'assistant-1',
        conversation_id: 'conv-1',
        data: { subject: 'late thought', description: 'arrived after finish' },
      });
    });

    expect(screen.getByTestId('streaming').props.children).toBe('idle');
    expect(screen.getByTestId('thought').props.children).toBe('');
  });

  it('recovers streaming state when a new turn emits thought before start', async () => {
    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('streaming').props.children).toBe('idle'));

    await act(async () => {
      listeners.get('chat.response.stream')?.({
        type: 'finish',
        msg_id: 'assistant-1',
        conversation_id: 'conv-1',
        data: null,
      });
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('send'));
    });
    await act(async () => {
      listeners.get('chat.response.stream')?.({
        type: 'thought',
        msg_id: 'assistant-2',
        conversation_id: 'conv-1',
        data: { subject: 'planning', description: 'thinking before start' },
      });
    });

    expect(screen.getByTestId('streaming').props.children).toBe('streaming');
    expect(screen.getByTestId('thought').props.children).toBe('planning');
  });

  it('queues local sends while the active turn is busy and drains them after finish', async () => {
    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('can-send').props.children).toBe('can-send'));

    await act(async () => {
      fireEvent.press(screen.getByTestId('send'));
      fireEvent.press(screen.getByTestId('send-second'));
    });

    expect(screen.getByTestId('streaming').props.children).toBe('streaming');
    expect(screen.getByTestId('can-send').props.children).toBe('blocked');
    expect(screen.getByTestId('queued-count').props.children).toBe(1);
    expect(mockRequest.mock.calls.filter(([name]) => name === 'chat.send.message')).toHaveLength(1);

    await act(async () => {
      listeners.get('chat.response.stream')?.({
        type: 'finish',
        msg_id: 'assistant-1',
        conversation_id: 'conv-1',
        data: null,
      });
    });

    expect(screen.getByTestId('queued-count').props.children).toBe(0);
    expect(screen.getByTestId('streaming').props.children).toBe('streaming');
    expect(screen.getByTestId('can-send').props.children).toBe('blocked');
    expect(mockRequest.mock.calls.filter(([name]) => name === 'chat.send.message')).toHaveLength(2);
    expect(mockRequest).toHaveBeenLastCalledWith(
      'chat.send.message',
      expect.objectContaining({
        input: 'second',
        conversation_id: 'conv-1',
      }),
    );
  });

  it('merges AionUi message.userCreated events into optimistic user messages', async () => {
    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('can-send').props.children).toBe('can-send'));

    await act(async () => {
      fireEvent.press(screen.getByTestId('send'));
    });

    const sendPayload = mockRequest.mock.calls.find(([name]) => name === 'chat.send.message')?.[1] as
      | { msg_id?: string }
      | undefined;
    expect(sendPayload?.msg_id).toBeTruthy();

    await act(async () => {
      listeners.get('message.userCreated')?.({
        conversation_id: 'conv-1',
        msg_id: sendPayload?.msg_id,
        content: 'hello',
        position: 'right',
        status: 'finish',
        hidden: false,
        created_at: 4321,
      });
    });

    expect(screen.getByTestId('message-count').props.children).toBe(1);
    expect(screen.getByTestId('messages').props.children).toBe('hello');
    expect(screen.getByTestId('message-meta').props.children).toBe(`${sendPayload?.msg_id}:right:finish:4321`);
  });

  it('loads and updates AionUi conversation artifacts for the active chat', async () => {
    mockRequest.mockImplementation((name: string) => {
      if (name === 'database.get-conversation-messages') return Promise.resolve([]);
      if (name === 'conversation.get') return Promise.resolve(null);
      if (name === 'conversation.get-slash-commands') return Promise.resolve([]);
      if (name === 'confirmation.list') return Promise.resolve([]);
      if (name === 'conversation.list-artifacts') {
        return Promise.resolve([
          {
            id: 'artifact-1',
            conversation_id: 'conv-1',
            kind: 'skill_suggest',
            status: 'pending',
            payload: {
              cron_job_id: 'cron-1',
              name: 'Review skill',
              description: 'Review local changes',
              skill_content: '# Review',
            },
            created_at: 1200,
            updated_at: 1200,
          },
        ]);
      }
      if (name === 'conversation.update-artifact') {
        return Promise.resolve({
          id: 'artifact-1',
          conversation_id: 'conv-1',
          kind: 'skill_suggest',
          status: 'dismissed',
          payload: {
            cron_job_id: 'cron-1',
            name: 'Review skill',
            description: 'Review local changes',
            skill_content: '# Review',
          },
          created_at: 1200,
          updated_at: 1400,
        });
      }
      return Promise.reject(new Error(`Unexpected bridge request ${name}`));
    });

    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('artifacts').props.children).toBe('artifact-1:pending'));
    expect(mockRequest).toHaveBeenCalledWith('conversation.list-artifacts', {
      conversation_id: 'conv-1',
    });

    await act(async () => {
      listeners.get('conversation.artifact')?.({
        id: 'artifact-1',
        conversation_id: 'conv-1',
        kind: 'skill_suggest',
        status: 'saved',
        payload: {
          cron_job_id: 'cron-1',
          name: 'Review skill',
          description: 'Review local changes',
          skill_content: '# Review',
        },
        created_at: 1200,
        updated_at: 1300,
      });
      listeners.get('conversation.artifact')?.({
        id: 'artifact-other',
        conversation_id: 'conv-2',
        kind: 'skill_suggest',
        status: 'pending',
        payload: {},
        created_at: 1250,
        updated_at: 1250,
      });
    });

    expect(screen.getByTestId('artifacts').props.children).toBe('artifact-1:saved');

    await act(async () => {
      fireEvent.press(screen.getByTestId('dismiss-first-artifact'));
    });

    await waitFor(() => expect(screen.getByTestId('artifacts').props.children).toBe('artifact-1:dismissed'));
    expect(mockRequest).toHaveBeenCalledWith('conversation.update-artifact', {
      conversation_id: 'conv-1',
      artifact_id: 'artifact-1',
      status: 'dismissed',
    });
  });

  it('removes a queued command before the queue drains', async () => {
    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('can-send').props.children).toBe('can-send'));

    await act(async () => {
      fireEvent.press(screen.getByTestId('send'));
      fireEvent.press(screen.getByTestId('send-second'));
    });

    expect(screen.getByTestId('queued-count').props.children).toBe(1);

    await act(async () => {
      fireEvent.press(screen.getByTestId('remove-first-queued'));
    });

    expect(screen.getByTestId('queued-count').props.children).toBe(0);

    await act(async () => {
      listeners.get('chat.response.stream')?.({
        type: 'finish',
        msg_id: 'assistant-1',
        conversation_id: 'conv-1',
        data: null,
      });
    });

    expect(mockRequest.mock.calls.filter(([name]) => name === 'chat.send.message')).toHaveLength(1);
  });

  it('clears queued commands and preserves attached file metadata before clearing', async () => {
    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('can-send').props.children).toBe('can-send'));

    await act(async () => {
      fireEvent.press(screen.getByTestId('send'));
      fireEvent.press(screen.getByTestId('send-files'));
      fireEvent.press(screen.getByTestId('send-third'));
    });

    expect(screen.getByTestId('queued-count').props.children).toBe(2);
    expect(screen.getByTestId('queued-items').props.children).toBe('with files:1|third:0');

    await act(async () => {
      fireEvent.press(screen.getByTestId('clear-queue'));
    });

    expect(screen.getByTestId('queued-count').props.children).toBe(0);

    await act(async () => {
      listeners.get('chat.response.stream')?.({
        type: 'finish',
        msg_id: 'assistant-1',
        conversation_id: 'conv-1',
        data: null,
      });
    });

    expect(mockRequest.mock.calls.filter(([name]) => name === 'chat.send.message')).toHaveLength(1);
  });

  it('moves a queued command into an editable input draft and removes it from persisted queue state', async () => {
    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('can-send').props.children).toBe('can-send'));

    await act(async () => {
      fireEvent.press(screen.getByTestId('send'));
      fireEvent.press(screen.getByTestId('send-files'));
      fireEvent.press(screen.getByTestId('send-too-many-files'));
    });

    expect(screen.getByTestId('queued-items').props.children).toBe('with files:1');
    expect(screen.getByTestId('queue-warning').props.children).toBe('tooManyFiles');

    await act(async () => {
      fireEvent.press(screen.getByTestId('edit-first-queued'));
    });

    expect(screen.getByTestId('queued-count').props.children).toBe(0);
    expect(screen.getByTestId('queue-paused').props.children).toBe('active');
    expect(screen.getByTestId('queue-warning').props.children).toBe('');
    expect(screen.getByTestId('queue-draft').props.children).toBe('with files:1');
    await waitFor(() => expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('chat-command-queue/conv-1'));

    await act(async () => {
      fireEvent.press(screen.getByTestId('clear-queue-draft'));
    });

    expect(screen.getByTestId('queue-draft').props.children).toBe('');
  });

  it('reorders queued commands, persists the order, and drains the new first command next', async () => {
    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('can-send').props.children).toBe('can-send'));

    await act(async () => {
      fireEvent.press(screen.getByTestId('send'));
      fireEvent.press(screen.getByTestId('send-second'));
      fireEvent.press(screen.getByTestId('send-third'));
    });

    expect(screen.getByTestId('queued-items').props.children).toBe('second:0|third:0');

    await act(async () => {
      fireEvent.press(screen.getByTestId('move-last-up'));
    });

    expect(screen.getByTestId('queued-items').props.children).toBe('third:0|second:0');
    await waitFor(() => {
      const lastPersisted = mockAsyncStorage.setItem.mock.calls
        .filter(([key]) => key === 'chat-command-queue/conv-1')
        .at(-1)?.[1];
      expect(lastPersisted).toBeTruthy();
      const payload = JSON.parse(lastPersisted ?? '{}') as { items?: Array<{ input?: string }> };
      expect(payload.items?.map((item) => item.input)).toEqual(['third', 'second']);
    });

    await act(async () => {
      listeners.get('chat.response.stream')?.({
        type: 'finish',
        msg_id: 'assistant-1',
        conversation_id: 'conv-1',
        data: null,
      });
    });

    expect(mockRequest.mock.calls.filter(([name]) => name === 'chat.send.message')).toHaveLength(2);
    expect(mockRequest).toHaveBeenLastCalledWith(
      'chat.send.message',
      expect.objectContaining({
        input: 'third',
        conversation_id: 'conv-1',
      }),
    );
    expect(screen.getByTestId('queued-items').props.children).toBe('second:0');
  });

  it('rejects queue overflow without dropping existing queued commands', async () => {
    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('can-send').props.children).toBe('can-send'));

    await act(async () => {
      fireEvent.press(screen.getByTestId('send'));
      for (let index = 0; index < 21; index += 1) {
        fireEvent.press(screen.getByTestId('send-second'));
      }
    });

    expect(screen.getByTestId('queued-count').props.children).toBe(20);
    expect(screen.getByTestId('queue-warning').props.children).toBe('queueFull');

    const lastPersisted = mockAsyncStorage.setItem.mock.calls
      .filter(([key]) => key === 'chat-command-queue/conv-1')
      .at(-1)?.[1];
    const payload = JSON.parse(lastPersisted ?? '{}') as { items?: unknown[] };
    expect(payload.items).toHaveLength(20);
  });

  it('rejects queued commands with too many files', async () => {
    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('can-send').props.children).toBe('can-send'));

    await act(async () => {
      fireEvent.press(screen.getByTestId('send'));
      fireEvent.press(screen.getByTestId('send-too-many-files'));
    });

    expect(screen.getByTestId('queued-count').props.children).toBe(0);
    expect(screen.getByTestId('queue-warning').props.children).toBe('tooManyFiles');
  });

  it('restores queued commands from local storage for the active conversation', async () => {
    mockAsyncStorage.getItem.mockImplementation((key: string) => {
      if (key === 'chat-command-queue/conv-1') {
        return Promise.resolve(
          JSON.stringify([
            {
              id: 'queued-1',
              input: 'resume later',
              files: ['src/App.tsx', 'src/App.tsx', ''],
              createdAt: 123,
            },
            {
              id: 'invalid-empty',
              input: '   ',
              files: [],
              createdAt: 456,
            },
            {
              id: 'invalid-long',
              input: 'x'.repeat(20001),
              files: [],
              createdAt: 789,
            },
            {
              id: 'invalid-files',
              input: 'too many files',
              files: Array.from({ length: 51 }, (_, index) => `src/file-${index}.ts`),
              createdAt: 999,
            },
          ]),
        );
      }
      return Promise.resolve(null);
    });

    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('queued-count').props.children).toBe(1));
    expect(screen.getByTestId('queued-items').props.children).toBe('resume later:1');
    expect(screen.getByTestId('queue-paused').props.children).toBe('active');
    expect(mockAsyncStorage.getItem).toHaveBeenCalledWith('chat-command-queue/conv-1');
  });

  it('restores paused queued command state from local storage', async () => {
    mockAsyncStorage.getItem.mockImplementation((key: string) => {
      if (key === 'chat-command-queue/conv-1') {
        return Promise.resolve(
          JSON.stringify({
            items: [
              {
                id: 'queued-1',
                input: 'retry after daemon restart',
                files: [],
                createdAt: 123,
              },
            ],
            isPaused: true,
          }),
        );
      }
      return Promise.resolve(null);
    });

    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('queued-items').props.children).toBe('retry after daemon restart:0'));
    expect(screen.getByTestId('queue-paused').props.children).toBe('paused');
  });

  it('persists queued commands and removes persisted state when the queue is cleared', async () => {
    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('can-send').props.children).toBe('can-send'));

    await act(async () => {
      fireEvent.press(screen.getByTestId('send'));
      fireEvent.press(screen.getByTestId('send-files'));
    });

    await waitFor(() =>
      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        'chat-command-queue/conv-1',
        expect.stringContaining('with files'),
      ),
    );
    const persistedPayload = JSON.parse(
      mockAsyncStorage.setItem.mock.calls.find(([key]) => key === 'chat-command-queue/conv-1')?.[1] ?? '[]',
    );
    expect(persistedPayload).toEqual({
      items: [
        expect.objectContaining({
          input: 'with files',
          files: ['src/App.tsx'],
        }),
      ],
      isPaused: false,
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('clear-queue'));
    });

    await waitFor(() => expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('chat-command-queue/conv-1'));
  });

  it('pauses the queue after a drained queued command fails and resumes on request', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockRequest.mockImplementation((name: string) => {
      if (name === 'database.get-conversation-messages') return Promise.resolve([]);
      if (name === 'conversation.get') return Promise.resolve(null);
      if (name === 'conversation.get-slash-commands') return Promise.resolve([]);
      if (name === 'confirmation.list') return Promise.resolve([]);
      if (name === 'chat.send.message') {
        const sendCount = mockRequest.mock.calls.filter(([requestName]) => requestName === name).length;
        return sendCount === 2 ? Promise.reject(new Error('daemon offline')) : Promise.resolve({ success: true });
      }
      return Promise.reject(new Error(`Unexpected bridge request ${name}`));
    });

    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('can-send').props.children).toBe('can-send'));

    await act(async () => {
      fireEvent.press(screen.getByTestId('send'));
      fireEvent.press(screen.getByTestId('send-second'));
    });

    expect(screen.getByTestId('queued-items').props.children).toBe('second:0');

    await act(async () => {
      listeners.get('chat.response.stream')?.({
        type: 'finish',
        msg_id: 'assistant-1',
        conversation_id: 'conv-1',
        data: null,
      });
    });

    await waitFor(() => expect(screen.getByTestId('queued-items').props.children).toBe('second:0'));
    expect(screen.getByTestId('queue-paused').props.children).toBe('paused');
    expect(screen.getByTestId('streaming').props.children).toBe('idle');
    expect(screen.getByTestId('can-send').props.children).toBe('can-send');
    expect(mockRequest.mock.calls.filter(([name]) => name === 'chat.send.message')).toHaveLength(2);
    await waitFor(() =>
      expect(mockAsyncStorage.setItem).toHaveBeenLastCalledWith(
        'chat-command-queue/conv-1',
        expect.stringContaining('second'),
      ),
    );
    const pausedPayload = JSON.parse(
      mockAsyncStorage.setItem.mock.calls.filter(([key]) => key === 'chat-command-queue/conv-1').at(-1)?.[1] ?? '{}',
    );
    expect(pausedPayload).toEqual({
      items: [
        expect.objectContaining({
          input: 'second',
        }),
      ],
      isPaused: true,
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('resume-queue'));
    });

    expect(screen.getByTestId('queued-count').props.children).toBe(0);
    expect(screen.getByTestId('queue-paused').props.children).toBe('active');
    expect(screen.getByTestId('streaming').props.children).toBe('streaming');
    expect(screen.getByTestId('can-send').props.children).toBe('blocked');
    expect(mockRequest.mock.calls.filter(([name]) => name === 'chat.send.message')).toHaveLength(3);
    expect(mockRequest).toHaveBeenLastCalledWith(
      'chat.send.message',
      expect.objectContaining({
        input: 'second',
        conversation_id: 'conv-1',
      }),
    );
    warnSpy.mockRestore();
  });

  it('restores runtime summary gate when a conversation is opened', async () => {
    mockRequest.mockImplementation((name: string) => {
      if (name === 'database.get-conversation-messages') return Promise.resolve([]);
      if (name === 'conversation.get') {
        return Promise.resolve({
          id: 'conv-1',
          runtime: {
            state: 'running',
            can_send_message: false,
            has_task: true,
            task_status: 'running',
            is_processing: true,
            pending_confirmations: 0,
            turn_id: 'turn-1',
          },
          extra: {},
        });
      }
      if (name === 'confirmation.list') return Promise.resolve([]);
      if (name === 'conversation.get-slash-commands') return Promise.resolve([]);
      return Promise.reject(new Error(`Unexpected bridge request ${name}`));
    });

    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('streaming').props.children).toBe('streaming'));
    expect(screen.getByTestId('can-send').props.children).toBe('blocked');
  });

  it('marks active thinking done when content arrives', async () => {
    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('streaming').props.children).toBe('idle'));

    await act(async () => {
      listeners.get('chat.response.stream')?.({
        type: 'thinking',
        msg_id: 'assistant-1-thinking',
        conversation_id: 'conv-1',
        created_at: 1000,
        data: { content: 'Reading files', subject: 'Inspecting', status: 'thinking' },
      });
    });
    expect(screen.getByTestId('thinking-status').props.children).toBe('thinking');

    await act(async () => {
      listeners.get('chat.response.stream')?.({
        type: 'content',
        msg_id: 'assistant-1',
        conversation_id: 'conv-1',
        created_at: 2500,
        data: { content: 'Done.' },
      });
    });

    expect(screen.getByTestId('thinking-status').props.children).toBe('done');
    expect(screen.getByTestId('thinking-duration').props.children).toBe('1500');
  });

  it('marks active thinking done when finish arrives without content', async () => {
    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('streaming').props.children).toBe('idle'));

    await act(async () => {
      listeners.get('chat.response.stream')?.({
        type: 'thinking',
        msg_id: 'assistant-1-thinking',
        conversation_id: 'conv-1',
        created_at: 1000,
        data: { content: 'Planning', subject: 'Plan', status: 'thinking' },
      });
      listeners.get('chat.response.stream')?.({
        type: 'finish',
        msg_id: 'assistant-1',
        conversation_id: 'conv-1',
        created_at: 1800,
        data: null,
      });
    });

    expect(screen.getByTestId('thinking-status').props.children).toBe('done');
    expect(screen.getByTestId('thinking-duration').props.children).toBe('800');
  });

  it('restores persisted context usage when a conversation is opened', async () => {
    mockRequest.mockImplementation((name: string) => {
      if (name === 'database.get-conversation-messages') return Promise.resolve([]);
      if (name === 'conversation.get') {
        return Promise.resolve({
          id: 'conv-1',
          extra: {
            lastContextUsage: { used: 42, size: 100 },
          },
        });
      }
      if (name === 'confirmation.list') return Promise.resolve([]);
      if (name === 'conversation.get-slash-commands') return Promise.resolve([]);
      return Promise.reject(new Error(`Unexpected bridge request ${name}`));
    });

    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('context-usage').props.children).toBe('42/100'));
    expect(mockRequest).toHaveBeenCalledWith('conversation.get', {
      conversation_id: 'conv-1',
    });
  });

  it('restores streaming state when a conversation is still running', async () => {
    mockRequest.mockImplementation((name: string) => {
      if (name === 'database.get-conversation-messages') return Promise.resolve([]);
      if (name === 'conversation.get') {
        return Promise.resolve({
          id: 'conv-1',
          status: 'running',
          extra: {},
        });
      }
      if (name === 'confirmation.list') return Promise.resolve([]);
      if (name === 'conversation.get-slash-commands') return Promise.resolve([]);
      return Promise.reject(new Error(`Unexpected bridge request ${name}`));
    });

    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('streaming').props.children).toBe('streaming'));
  });

  it('restores streaming state when a conversation is waiting for confirmation', async () => {
    mockRequest.mockImplementation((name: string) => {
      if (name === 'database.get-conversation-messages') return Promise.resolve([]);
      if (name === 'conversation.get') {
        return Promise.resolve({
          id: 'conv-1',
          status: 'waiting_confirmation',
          extra: {},
        });
      }
      if (name === 'confirmation.list') return Promise.resolve([]);
      if (name === 'conversation.get-slash-commands') return Promise.resolve([]);
      return Promise.reject(new Error(`Unexpected bridge request ${name}`));
    });

    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('streaming').props.children).toBe('streaming'));
  });

  it('restores pending confirmations when a conversation is opened', async () => {
    mockRequest.mockImplementation((name: string) => {
      if (name === 'database.get-conversation-messages') return Promise.resolve([]);
      if (name === 'conversation.get') return Promise.resolve({ id: 'conv-1', extra: {} });
      if (name === 'confirmation.list') {
        return Promise.resolve([
          {
            id: 'permission-1',
            msg_id: 'assistant-1',
            conversation_id: 'conv-1',
            title: 'OpenCode permission',
            callId: 'call-1',
            options: [{ label: 'Allow once', value: 'once' }],
          },
        ]);
      }
      if (name === 'conversation.get-slash-commands') return Promise.resolve([]);
      return Promise.reject(new Error(`Unexpected bridge request ${name}`));
    });

    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('confirmations').props.children).toBe('permission-1'));
    expect(screen.getByTestId('message-types').props.children).toContain('acp_permission');
    expect(mockRequest).toHaveBeenCalledWith('confirmation.list', {
      conversation_id: 'conv-1',
    });
  });

  it('removes inline confirmation cards when a confirmation is resolved', async () => {
    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('streaming').props.children).toBe('idle'));

    await act(async () => {
      listeners.get('confirmation.add')?.({
        id: 'permission-1',
        msg_id: 'assistant-1',
        conversation_id: 'conv-1',
        title: 'OpenCode permission',
        callId: 'call-1',
        options: [{ label: 'Allow once', value: 'once' }],
      });
    });
    expect(screen.getByTestId('message-types').props.children).toContain('acp_permission');
    expect(screen.getByTestId('confirmations').props.children).toBe('permission-1');

    await act(async () => {
      listeners.get('confirmation.remove')?.({
        conversation_id: 'conv-1',
        id: 'permission-1',
      });
    });

    expect(screen.getByTestId('message-types').props.children).not.toContain('acp_permission');
    expect(screen.getByTestId('confirmations').props.children).toBe('');
  });

  it('updates inline confirmation cards when a confirmation changes', async () => {
    const screen = render(
      <ChatProvider>
        <RuntimeProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('streaming').props.children).toBe('idle'));

    await act(async () => {
      listeners.get('confirmation.add')?.({
        id: 'permission-1',
        msg_id: 'assistant-1',
        conversation_id: 'conv-1',
        title: 'OpenCode permission',
        callId: 'call-1',
        options: [{ label: 'Allow once', value: 'once' }],
      });
    });

    await act(async () => {
      listeners.get('confirmation.update')?.({
        id: 'permission-1',
        title: 'Updated permission',
        description: 'Permission details changed',
      });
    });

    expect(screen.getByTestId('confirmation-titles').props.children).toBe('Updated permission');
    expect(screen.getByTestId('permission-titles').props.children).toBe('Updated permission');
  });

  it('surfaces bridge confirmation failures to the caller', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockRequest.mockImplementation((name: string) => {
      if (name === 'database.get-conversation-messages') return Promise.resolve([]);
      if (name === 'conversation.get') return Promise.resolve(null);
      if (name === 'conversation.get-slash-commands') return Promise.resolve([]);
      if (name === 'confirmation.list') return Promise.resolve([]);
      if (name === 'confirmation.confirm') {
        return Promise.resolve({
          success: false,
          error: { code: 'CONFIRMATION_NOT_FOUND', message: 'Confirmation not found' },
        });
      }
      return Promise.reject(new Error(`Unexpected bridge request ${name}`));
    });

    const screen = render(
      <ChatProvider>
        <ConfirmProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith('confirmation.list', { conversation_id: 'conv-1' }));

    fireEvent.press(screen.getByTestId('confirm-action'));

    await waitFor(() => expect(screen.getByTestId('confirm-action').props.children).toBe('Confirmation not found'));
    expect(mockRequest).toHaveBeenCalledWith('confirmation.confirm', {
      conversation_id: 'conv-1',
      msg_id: 'permission-1',
      callId: 'call-1',
      data: 'reject',
    });
    warnSpy.mockRestore();
  });
});
