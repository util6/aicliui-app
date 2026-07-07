import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ChatScreen } from '@/src/components/chat/ChatScreen';
import { useChat } from '@/src/context/ChatContext';

const mockUseConversations = jest.fn();
const mockBridgeRequest = jest.fn();

jest.mock('@/src/context/ChatContext', () => ({
  useChat: jest.fn(),
}));

jest.mock('@/src/context/ConversationContext', () => ({
  useConversations: () => mockUseConversations(),
}));

jest.mock('@/src/services/bridge', () => ({
  bridge: {
    request: (...args: unknown[]) => mockBridgeRequest(...args),
  },
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
    attachedFiles,
    onAttachPress,
    onClearAttachedFiles,
    onSend,
  }: {
    queuedCount?: number;
    draft?: { id: string; text: string; files?: string[] } | null;
    onDraftConsumed?: (draftId: string) => void;
    attachedFiles?: string[];
    onAttachPress?: () => void;
    onClearAttachedFiles?: () => void;
    onSend: (text: string, files?: string[]) => void;
  }) => {
    const { Text } = require('react-native');
    return (
      <>
        <Text testID='chat-input-queued-count'>queued:{queuedCount ?? 'missing'}</Text>
        <Text testID='chat-input-draft'>{draft ? `${draft.text}:${draft.files?.length ?? 0}` : ''}</Text>
        <Text testID='chat-input-attachments'>files:{attachedFiles?.length ?? 0}</Text>
        <Text testID='open-file-picker' onPress={onAttachPress}>
          open-file-picker
        </Text>
        <Text
          testID='send-with-attachments'
          onPress={() => {
            onSend('inspect files', attachedFiles);
            onClearAttachedFiles?.();
          }}
        >
          send-with-attachments
        </Text>
        <Text testID='consume-draft' onPress={() => draft && onDraftConsumed?.(draft.id)}>
          consume-draft
        </Text>
      </>
    );
  },
}));

jest.mock('@/src/components/chat/FilePickerSheet', () => ({
  FilePickerSheet: ({
    visible,
    rootDir,
    selectedFiles,
    onDone,
  }: {
    visible: boolean;
    rootDir: string;
    selectedFiles: string[];
    onDone: (files: string[]) => void;
  }) => {
    const { Text } = require('react-native');
    return (
      <>
        <Text testID='file-picker-state'>
          {visible ? `open:${rootDir}:${selectedFiles.length}` : 'closed'}
        </Text>
        <Text
          testID='choose-active-files'
          onPress={() => onDone(['/tmp/project/README.md', '/tmp/project/src/App.tsx'])}
        >
          choose-active-files
        </Text>
      </>
    );
  },
}));

jest.mock('@/src/components/chat/ChatSessionBar', () => ({
  ChatSessionBar: ({
    availableModels,
    onModelSelect,
    onModeSelect,
  }: {
    availableModels?: Array<{ id: string; label: string }>;
    onModelSelect?: (model: { id: string; label: string }) => void;
    onModeSelect?: (mode: string) => void;
  }) => {
    const { Text } = require('react-native');
    return (
      <>
        <Text testID='session-model-count'>models:{availableModels?.length ?? 0}</Text>
        <Text testID='select-session-model' onPress={() => {
          const [model] = availableModels ?? [];
          if (model) onModelSelect?.(model);
        }}>
          select-session-model
        </Text>
        <Text testID='select-session-mode' onPress={() => onModeSelect?.('autoEdit')}>
          select-session-mode
        </Text>
      </>
    );
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

jest.mock('@/src/components/chat/ConversationArtifactCard', () => ({
  ConversationArtifactCard: ({ artifact }: { artifact: { kind: string; payload?: { name?: string } } }) => {
    const { Text } = require('react-native');
    return <Text testID={`conversation-artifact-${artifact.kind}`}>{artifact.payload?.name ?? artifact.kind}</Text>;
  },
}));

const mockUseChat = useChat as jest.Mock;

describe('ChatScreen', () => {
  beforeEach(() => {
    const editQueuedCommand = jest.fn();
    const clearQueuedCommandDraft = jest.fn();
    const updateConversationExecutionContext = jest.fn();
    mockBridgeRequest.mockReset();
    mockBridgeRequest.mockImplementation((name: string, data?: Record<string, unknown>) => {
      if (name === 'conversation.ensure-runtime') {
        return Promise.resolve({
          recovered: false,
          runtime: {
            state: 'idle',
            can_send_message: true,
            has_task: false,
            task_status: 'finished',
            is_processing: false,
            pending_confirmations: 0,
            turn_id: null,
          },
          config_options: [
            {
              id: 'model',
              category: 'model',
              option_type: 'select',
              current_value: 'gpt-4.1',
              options: [{ value: 'gpt-5-codex', label: 'GPT-5 Codex' }],
            },
            {
              id: 'mode',
              category: 'mode',
              option_type: 'select',
              current_value: 'default',
              options: [
                { value: 'default', label: 'Plan' },
                { value: 'autoEdit', label: 'Auto Edit' },
              ],
            },
          ],
        });
      }
      if (name === 'conversation.set-config-option') {
        const optionId = data?.option_id;
        const value = data?.value;
        return Promise.resolve({
          confirmation: 'observed',
          config_options: [
            {
              id: optionId,
              category: optionId,
              option_type: 'select',
              current_value: value,
              options: [],
            },
          ],
        });
      }
      if (name === 'acp.probe-model-info') {
        return Promise.resolve({
          success: true,
          data: {
            modelInfo: {
              currentModelId: 'gpt-4.1',
              currentModelLabel: 'GPT-4.1',
              availableModels: [{ id: 'gpt-5-codex', label: 'GPT-5 Codex' }],
              canSwitch: true,
              source: 'models',
            },
          },
        });
      }
      return Promise.reject(new Error(`Unexpected bridge request ${name}`));
    });
    mockUseConversations.mockReturnValue({
      conversations: [
        {
          id: 'conv-1',
          name: 'OpenCode',
          type: 'acp',
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
        },
      ],
      updateConversationExecutionContext,
    });
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
      artifacts: [],
      loadConversation: jest.fn(),
      sendMessage: jest.fn(),
      removeQueuedCommand: jest.fn(),
      editQueuedCommand,
      clearQueuedCommandDraft,
      moveQueuedCommand: jest.fn(),
      clearQueuedCommands: jest.fn(),
      resumeQueuedCommands: jest.fn(),
      stopGeneration: jest.fn(),
      updateArtifactStatus: jest.fn(),
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

  it('warms the active runtime and persists session bar model and mode selections through config options', async () => {
    const screen = render(<ChatScreen conversationId='conv-1' />);
    const conversations = mockUseConversations.mock.results.at(-1)?.value;

    await waitFor(() => {
      expect(screen.getByTestId('session-model-count').props.children).toEqual(['models:', 1]);
    });
    expect(mockBridgeRequest).toHaveBeenCalledWith('conversation.ensure-runtime', { conversation_id: 'conv-1' });

    fireEvent.press(screen.getByTestId('select-session-model'));
    await waitFor(() => {
      expect(mockBridgeRequest).toHaveBeenCalledWith('conversation.set-config-option', {
        conversation_id: 'conv-1',
        option_id: 'model',
        value: 'gpt-5-codex',
      });
      expect(conversations.updateConversationExecutionContext).toHaveBeenCalledWith('conv-1', {
        currentModelId: 'gpt-5-codex',
        currentModelLabel: 'GPT-5 Codex',
      });
    });

    fireEvent.press(screen.getByTestId('select-session-mode'));
    await waitFor(() => {
      expect(mockBridgeRequest).toHaveBeenCalledWith('conversation.set-config-option', {
        conversation_id: 'conv-1',
        option_id: 'mode',
        value: 'autoEdit',
      });
      expect(conversations.updateConversationExecutionContext).toHaveBeenCalledWith('conv-1', {
        sessionMode: 'autoEdit',
      });
    });
  });

  it('attaches active workspace files to the next mobile send and clears them after send', async () => {
    const screen = render(<ChatScreen conversationId='conv-1' />);
    const chat = mockUseChat.mock.results.at(-1)?.value;

    expect(screen.getByTestId('file-picker-state').props.children).toBe('closed');

    fireEvent.press(screen.getByTestId('open-file-picker'));
    expect(screen.getByTestId('file-picker-state').props.children).toBe('open:/tmp/project:0');

    fireEvent.press(screen.getByTestId('choose-active-files'));
    await waitFor(() => {
      expect(screen.getByTestId('chat-input-attachments').props.children).toEqual(['files:', 2]);
    });

    fireEvent.press(screen.getByTestId('send-with-attachments'));
    expect(chat.sendMessage).toHaveBeenCalledWith('inspect files', [
      '/tmp/project/README.md',
      '/tmp/project/src/App.tsx',
    ]);
    await waitFor(() => {
      expect(screen.getByTestId('chat-input-attachments').props.children).toEqual(['files:', 0]);
    });
  });

  it('renders visible AionUi conversation artifacts inside the chat timeline', async () => {
    mockUseChat.mockReturnValue({
      ...mockUseChat.mock.results.at(-1)?.value,
      messages: [
        {
          id: 'message-1',
          msg_id: 'turn-1',
          conversation_id: 'conv-1',
          type: 'text',
          position: 'left',
          content: { content: 'hello' },
          createdAt: 1000,
          created_at: 1000,
        },
      ],
      artifacts: [
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
      ],
    });

    const screen = render(<ChatScreen conversationId='conv-1' />);

    await waitFor(() => {
      expect(screen.getByTestId('conversation-artifact-skill_suggest').props.children).toBe('Review skill');
    });
  });
});
