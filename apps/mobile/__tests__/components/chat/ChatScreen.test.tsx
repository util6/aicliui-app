import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
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
  ChatInputBar: ({ queuedCount }: { queuedCount?: number }) => {
    const { Text } = require('react-native');
    return <Text testID='chat-input-queued-count'>queued:{queuedCount ?? 'missing'}</Text>;
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
  QueuedCommandPanel: () => {
    const { Text } = require('react-native');
    return <Text>queue-panel</Text>;
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
      thought: null,
      contextUsage: null,
      slashCommands: [],
      loadConversation: jest.fn(),
      sendMessage: jest.fn(),
      removeQueuedCommand: jest.fn(),
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
});
