import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ChatScreen } from '@/src/components/chat/ChatScreen';
import { useChat } from '@/src/context/ChatContext';

jest.mock('@/src/context/ChatContext', () => ({
  useChat: jest.fn(),
}));

jest.mock('@/src/context/ConversationContext', () => ({
  useConversations: () => ({
    conversations: [{ id: 'conv-1', name: 'OpenCode', extra: {} }],
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

jest.mock('@/src/components/chat/ChatInputBar', () => ({
  ChatInputBar: ({
    queuedCount,
    draft,
    onDraftConsumed,
  }: {
    queuedCount?: number;
    draft?: { id: string; text: string; files?: string[] } | null;
    onDraftConsumed?: (draftId: string) => void;
  }) => {
    const { Text } = require('react-native');
    return (
      <>
        <Text testID='chat-input-queued-count'>queued:{queuedCount ?? 'missing'}</Text>
        <Text testID='chat-input-draft'>{draft ? `${draft.text}:${draft.files?.length ?? 0}` : ''}</Text>
        <Text testID='consume-draft' onPress={() => draft && onDraftConsumed?.(draft.id)}>
          consume-draft
        </Text>
      </>
    );
  },
}));

jest.mock('@/src/components/chat/ChatSessionBar', () => ({
  ChatSessionBar: () => {
    const { Text } = require('react-native');
    return <Text>session-bar</Text>;
  },
}));

jest.mock('@/src/components/chat/ContextUsageIndicator', () => ({
  ContextUsageIndicator: () => {
    const { Text } = require('react-native');
    return <Text>context-usage</Text>;
  },
}));

jest.mock('@/src/components/chat/QueuedCommandPanel', () => ({
  QueuedCommandPanel: ({ onEdit }: { onEdit?: (commandId: string) => void }) => {
    const { Text } = require('react-native');
    return <Text testID='edit-queued-command' onPress={() => onEdit?.('queue-1')}>queue-panel</Text>;
  },
}));

jest.mock('@/src/components/chat/MessageBubble', () => ({
  MessageBubble: () => {
    const { Text } = require('react-native');
    return <Text>message-bubble</Text>;
  },
}));

jest.mock('@/src/components/chat/ToolCallSummary', () => ({
  ToolCallSummary: () => {
    const { Text } = require('react-native');
    return <Text>tool-summary</Text>;
  },
}));

const mockUseChat = useChat as jest.Mock;

describe('ChatScreen', () => {
  beforeEach(() => {
    const editQueuedCommand = jest.fn();
    const clearQueuedCommandDraft = jest.fn();
    mockUseChat.mockReturnValue({
      messages: [],
      isStreaming: true,
      canSendMessage: false,
      queuedCommands: [
        { id: 'queue-1', input: 'second', files: [], createdAt: 1 },
        { id: 'queue-2', input: 'third', files: [], createdAt: 2 },
      ],
      isQueuePaused: false,
      queuedCommandWarning: null,
      queuedCommandDraft: {
        id: 'queue-1',
        text: 'second',
        files: ['src/App.tsx'],
      },
      thought: null,
      contextUsage: null,
      slashCommands: [],
      loadConversation: jest.fn(),
      sendMessage: jest.fn(),
      removeQueuedCommand: jest.fn(),
      editQueuedCommand,
      clearQueuedCommandDraft,
      moveQueuedCommand: jest.fn(),
      clearQueuedCommands: jest.fn(),
      resumeQueuedCommands: jest.fn(),
      stopGeneration: jest.fn(),
    });
  });

  it('passes queued command count to the input bar', async () => {
    const screen = render(<ChatScreen conversationId='conv-1' />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-input-queued-count').props.children).toEqual(['queued:', 2]);
    });
  });

  it('wires queued command editing into the input draft flow', async () => {
    const screen = render(<ChatScreen conversationId='conv-1' />);
    const chat = mockUseChat.mock.results.at(-1)?.value;

    fireEvent.press(screen.getByTestId('edit-queued-command'));
    expect(chat.editQueuedCommand).toHaveBeenCalledWith('queue-1');

    await waitFor(() => {
      expect(screen.getByTestId('chat-input-draft').props.children).toBe('second:1');
    });

    fireEvent.press(screen.getByTestId('consume-draft'));
    expect(chat.clearQueuedCommandDraft).toHaveBeenCalledWith('queue-1');
  });
});
