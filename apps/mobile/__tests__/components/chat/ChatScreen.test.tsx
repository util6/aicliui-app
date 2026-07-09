import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ChatScreen } from '@/src/components/chat/ChatScreen';
import { useChat } from '@/src/context/ChatContext';

const mockUseConversations = jest.fn();
const mockBridgeRequest = jest.fn();
const mockUseFilesTabOptional = jest.fn();
const mockUseWorkspaceAttachments = jest.fn();
const mockRouterPush = jest.fn();

jest.mock('@/src/context/ChatContext', () => ({
  useChat: jest.fn(),
}));

jest.mock('@/src/context/ConversationContext', () => ({
  useConversations: () => mockUseConversations(),
}));

jest.mock('@/src/context/FilesTabContext', () => ({
  useFilesTabOptional: () => mockUseFilesTabOptional(),
}));

jest.mock('@/src/context/WorkspaceAttachmentContext', () => ({
  useWorkspaceAttachments: () => mockUseWorkspaceAttachments(),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => mockRouterPush(...args),
  }),
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
    availableModels,
    onModelSelect,
    modes,
    onModeSelect,
  }: {
    queuedCount?: number;
    draft?: { id: string; text: string; files?: string[] } | null;
    onDraftConsumed?: (draftId: string) => void;
    attachedFiles?: string[];
    onAttachPress?: () => void;
    onClearAttachedFiles?: () => void;
    onSend: (text: string, files?: string[]) => void;
    availableModels?: Array<{ id: string; label: string }>;
    onModelSelect?: (model: { id: string; label: string }) => void;
    modes?: Array<{ value: string; label: string }>;
    onModeSelect?: (mode: string) => void;
  }) => {
    const { Text } = require('react-native');
    return (
      <>
        <Text testID='chat-input-queued-count'>queued:{queuedCount ?? 'missing'}</Text>
        <Text testID='chat-input-draft'>{draft ? `${draft.text}:${draft.files?.length ?? 0}` : ''}</Text>
        <Text testID='chat-input-attachments'>files:{attachedFiles?.length ?? 0}</Text>
        <Text testID='chat-input-model-count'>models:{availableModels?.length ?? 0}</Text>
        <Text testID='chat-input-mode-count'>modes:{modes?.length ?? 0}</Text>
        <Text testID='select-input-model' onPress={() => {
          const [model] = availableModels ?? [];
          if (model) onModelSelect?.(model);
        }}>
          select-input-model
        </Text>
        <Text testID='select-input-mode' onPress={() => onModeSelect?.('autoEdit')}>
          select-input-mode
        </Text>
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
  ChatSessionBar: ({ availableModels }: { availableModels?: Array<{ id: string; label: string }> }) => {
    const { Text } = require('react-native');
    return (
      <>
        <Text testID='session-model-count'>models:{availableModels?.length ?? 0}</Text>
      </>
    );
  },
}));

jest.mock('@/src/components/chat/ConfirmationCard', () => ({
  ConfirmationCard: ({ content, msgId }: { content: { id?: string; title?: string }; msgId?: string }) => {
    const { Text } = require('react-native');
    return <Text testID={`pending-confirmation-${content.id ?? msgId}`}>{content.title ?? content.id ?? msgId}</Text>;
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

jest.mock('@/src/components/chat/WorkspaceChangeSummaryCard', () => ({
  WorkspaceChangeSummaryCard: ({
    summary,
    onOpenFile,
    onOpenDiff,
    onStageFile,
    onUnstageFile,
    onStageAll,
    onUnstageAll,
    onDiscardFile,
  }: {
    summary: {
      staged: Array<{ file_path: string; relativePath: string }>;
      unstaged: Array<{ file_path: string; relativePath: string }>;
    };
    onOpenFile?: (change: { file_path: string; relativePath: string }) => void;
    onOpenDiff?: (change: { file_path: string; relativePath: string }, source: 'staged' | 'unstaged') => void;
    onStageFile?: (change: { file_path: string; relativePath: string }) => void;
    onUnstageFile?: (change: { file_path: string; relativePath: string }) => void;
    onStageAll?: () => void;
    onUnstageAll?: () => void;
    onDiscardFile?: (change: { file_path: string; relativePath: string; operation?: string }) => void;
  }) => {
    const { Text } = require('react-native');
    const [firstChange] = [...summary.staged, ...summary.unstaged];
    const source = summary.staged.length > 0 ? 'staged' : 'unstaged';
    const [firstStaged] = summary.staged;
    const [firstUnstaged] = summary.unstaged;
    return (
      <>
        <Text testID='workspace-change-summary'>changes:{summary.staged.length + summary.unstaged.length}</Text>
        {firstChange ? (
          <Text testID='open-workspace-change' onPress={() => onOpenFile?.(firstChange)}>
            {firstChange.relativePath}
          </Text>
        ) : null}
        {firstChange ? (
          <Text testID='open-workspace-diff' onPress={() => onOpenDiff?.(firstChange, source)}>
            open-diff
          </Text>
        ) : null}
        {firstUnstaged ? (
          <Text testID='stage-workspace-file' onPress={() => onStageFile?.(firstUnstaged)}>
            stage
          </Text>
        ) : null}
        {firstStaged ? (
          <Text testID='unstage-workspace-file' onPress={() => onUnstageFile?.(firstStaged)}>
            unstage
          </Text>
        ) : null}
        {summary.unstaged.length > 0 ? (
          <Text testID='stage-all-workspace-files' onPress={() => onStageAll?.()}>
            stage-all
          </Text>
        ) : null}
        {firstUnstaged ? (
          <Text testID='discard-workspace-file' onPress={() => onDiscardFile?.(firstUnstaged)}>
            discard
          </Text>
        ) : null}
        {summary.staged.length > 0 ? (
          <Text testID='unstage-all-workspace-files' onPress={() => onUnstageAll?.()}>
            unstage-all
          </Text>
        ) : null}
      </>
    );
  },
}));

const mockUseChat = useChat as jest.Mock;

describe('ChatScreen', () => {
  beforeEach(() => {
    const editQueuedCommand = jest.fn();
    const clearQueuedCommandDraft = jest.fn();
    const updateConversationExecutionContext = jest.fn();
    const openTab = jest.fn();
    mockBridgeRequest.mockReset();
    mockRouterPush.mockReset();
    mockUseFilesTabOptional.mockReturnValue({ openTab });
    mockUseWorkspaceAttachments.mockReturnValue({
      consumePendingFiles: jest.fn(() => []),
    });
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
      if (name === 'fileSnapshot.compare') {
        return Promise.resolve({ mode: 'git-repo', branch: 'main', staged: [], unstaged: [] });
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
      confirmations: [],
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

  it('surfaces pending confirmations in a fixed dock above the input', async () => {
    mockUseChat.mockReturnValue({
      ...mockUseChat.mock.results.at(-1)?.value,
      confirmations: [
        {
          id: 'permission-1',
          msg_id: 'permission-message-1',
          title: 'Allow shell command',
          options: [{ label: 'Allow once', value: 'once' }],
        },
      ],
    });

    const screen = render(<ChatScreen conversationId='conv-1' />);

    await waitFor(() => {
      expect(screen.getByTestId('pending-confirmation-dock')).toBeTruthy();
      expect(screen.getByTestId('pending-confirmation-permission-1').props.children).toBe('Allow shell command');
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

  it('warms the active runtime and persists input action sheet model and mode selections through config options', async () => {
    const screen = render(<ChatScreen conversationId='conv-1' />);
    const conversations = mockUseConversations.mock.results.at(-1)?.value;

    await waitFor(() => {
      expect(screen.getByTestId('session-model-count').props.children).toEqual(['models:', 1]);
      expect(screen.getByTestId('chat-input-model-count').props.children).toEqual(['models:', 1]);
      expect(screen.getByTestId('chat-input-mode-count').props.children).toEqual(['modes:', 3]);
    });
    expect(mockBridgeRequest).toHaveBeenCalledWith('conversation.ensure-runtime', { conversation_id: 'conv-1' });

    fireEvent.press(screen.getByTestId('select-input-model'));
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

    fireEvent.press(screen.getByTestId('select-input-mode'));
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

  it('consumes workspace file attachments added from the Files tab', async () => {
    const consumePendingFiles = jest.fn((conversationId: string) =>
      conversationId === 'conv-1' ? ['/tmp/project/README.md'] : [],
    );
    mockUseWorkspaceAttachments.mockReturnValue({ consumePendingFiles });

    const screen = render(<ChatScreen conversationId='conv-1' />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-input-attachments').props.children).toEqual(['files:', 1]);
    });
    expect(consumePendingFiles).toHaveBeenCalledWith('conv-1');
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

  it('renders local workspace change summaries inside the chat timeline', async () => {
    mockUseChat.mockReturnValue({
      ...mockUseChat.mock.results.at(-1)?.value,
      isStreaming: false,
    });
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
          config_options: [],
        });
      }
      if (name === 'fileSnapshot.compare') {
        expect(data).toEqual({ workspace: '/tmp/project' });
        return Promise.resolve({
          mode: 'git-repo',
          branch: 'main',
          staged: [
            {
              file_path: '/tmp/project/README.md',
              relativePath: 'README.md',
              operation: 'modify',
              additions: 2,
              deletions: 1,
            },
          ],
          unstaged: [
            {
              file_path: '/tmp/project/src/App.tsx',
              relativePath: 'src/App.tsx',
              operation: 'create',
              additions: 12,
              deletions: 0,
            },
          ],
        });
      }
      return Promise.resolve(null);
    });

    const screen = render(<ChatScreen conversationId='conv-1' />);

    await waitFor(() => {
      expect(screen.getByTestId('workspace-change-summary').props.children).toEqual(['changes:', 2]);
    });
  });

  it('opens a changed workspace file in the Files tab from the chat summary', async () => {
    mockUseChat.mockReturnValue({
      ...mockUseChat.mock.results.at(-1)?.value,
      isStreaming: false,
    });
    const filesTab = { openTab: jest.fn() };
    mockUseFilesTabOptional.mockReturnValue(filesTab);
    mockBridgeRequest.mockImplementation((name: string) => {
      if (name === 'conversation.ensure-runtime') {
        return Promise.resolve({ recovered: false, runtime: null, config_options: [] });
      }
      if (name === 'fileSnapshot.compare') {
        return Promise.resolve({
          mode: 'git-repo',
          branch: 'main',
          staged: [],
          unstaged: [
            {
              file_path: '/tmp/project/src/App.tsx',
              relativePath: 'src/App.tsx',
              operation: 'modify',
              additions: 2,
              deletions: 1,
            },
          ],
        });
      }
      return Promise.resolve(null);
    });

    const screen = render(<ChatScreen conversationId='conv-1' />);

    await waitFor(() => {
      expect(screen.getByTestId('open-workspace-change')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('open-workspace-change'));

    expect(filesTab.openTab).toHaveBeenCalledWith('/tmp/project/src/App.tsx');
    expect(mockRouterPush).toHaveBeenCalledWith('/(tabs)/files');
  });

  it('opens a changed workspace file diff from the chat summary', async () => {
    mockUseChat.mockReturnValue({
      ...mockUseChat.mock.results.at(-1)?.value,
      isStreaming: false,
    });
    mockBridgeRequest.mockImplementation((name: string, data?: Record<string, unknown>) => {
      if (name === 'conversation.ensure-runtime') {
        return Promise.resolve({ recovered: false, runtime: null, config_options: [] });
      }
      if (name === 'fileSnapshot.compare') {
        return Promise.resolve({
          mode: 'git-repo',
          branch: 'main',
          staged: [
            {
              file_path: '/tmp/project/README.md',
              relativePath: 'README.md',
              operation: 'modify',
              additions: 2,
              deletions: 1,
            },
          ],
          unstaged: [],
        });
      }
      if (name === 'fileSnapshot.diff') {
        expect(data).toEqual({ workspace: '/tmp/project', relativePath: 'README.md', source: 'staged' });
        return Promise.resolve({
          relativePath: 'README.md',
          source: 'staged',
          diff: 'diff --git a/README.md b/README.md\n+staged',
        });
      }
      return Promise.resolve(null);
    });

    const screen = render(<ChatScreen conversationId='conv-1' />);

    await waitFor(() => {
      expect(screen.getByTestId('open-workspace-diff')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('open-workspace-diff'));

    await waitFor(() => {
      expect(screen.getByText(/diff --git a\/README.md/)).toBeTruthy();
    });
  });

  it('stages and refreshes a changed workspace file from the chat summary', async () => {
    mockUseChat.mockReturnValue({
      ...mockUseChat.mock.results.at(-1)?.value,
      isStreaming: false,
    });
    let compareCount = 0;
    mockBridgeRequest.mockImplementation((name: string, data?: Record<string, unknown>) => {
      if (name === 'conversation.ensure-runtime') {
        return Promise.resolve({ recovered: false, runtime: null, config_options: [] });
      }
      if (name === 'fileSnapshot.compare') {
        compareCount += 1;
        return Promise.resolve({
          mode: 'git-repo',
          branch: 'main',
          staged:
            compareCount > 1
              ? [
                  {
                    file_path: '/tmp/project/src/App.tsx',
                    relativePath: 'src/App.tsx',
                    operation: 'modify',
                    additions: 2,
                    deletions: 1,
                  },
                ]
              : [],
          unstaged:
            compareCount > 1
              ? []
              : [
                  {
                    file_path: '/tmp/project/src/App.tsx',
                    relativePath: 'src/App.tsx',
                    operation: 'modify',
                    additions: 2,
                    deletions: 1,
                  },
                ],
        });
      }
      if (name === 'fileSnapshot.stageFile') {
        expect(data).toEqual({ workspace: '/tmp/project', relativePath: 'src/App.tsx' });
        return Promise.resolve(undefined);
      }
      return Promise.resolve(null);
    });

    const screen = render(<ChatScreen conversationId='conv-1' />);

    await waitFor(() => {
      expect(screen.getByTestId('stage-workspace-file')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('stage-workspace-file'));

    await waitFor(() => {
      expect(mockBridgeRequest).toHaveBeenCalledWith('fileSnapshot.stageFile', {
        workspace: '/tmp/project',
        relativePath: 'src/App.tsx',
      });
      expect(compareCount).toBeGreaterThan(1);
    });
  });

  it('stages all workspace changes from the chat summary', async () => {
    mockUseChat.mockReturnValue({
      ...mockUseChat.mock.results.at(-1)?.value,
      isStreaming: false,
    });
    let compareCount = 0;
    mockBridgeRequest.mockImplementation((name: string, data?: Record<string, unknown>) => {
      if (name === 'conversation.ensure-runtime') {
        return Promise.resolve({ recovered: false, runtime: null, config_options: [] });
      }
      if (name === 'fileSnapshot.compare') {
        compareCount += 1;
        return Promise.resolve({
          mode: 'git-repo',
          branch: 'main',
          staged: [],
          unstaged:
            compareCount > 1
              ? []
              : [
                  {
                    file_path: '/tmp/project/src/App.tsx',
                    relativePath: 'src/App.tsx',
                    operation: 'modify',
                    additions: 2,
                    deletions: 1,
                  },
                ],
        });
      }
      if (name === 'fileSnapshot.stageAll') {
        expect(data).toEqual({ workspace: '/tmp/project' });
        return Promise.resolve(undefined);
      }
      return Promise.resolve(null);
    });

    const screen = render(<ChatScreen conversationId='conv-1' />);

    await waitFor(() => {
      expect(screen.getByTestId('stage-all-workspace-files')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('stage-all-workspace-files'));

    await waitFor(() => {
      expect(mockBridgeRequest).toHaveBeenCalledWith('fileSnapshot.stageAll', { workspace: '/tmp/project' });
      expect(compareCount).toBeGreaterThan(1);
    });
  });

  it('unstages all workspace changes from the chat summary', async () => {
    mockUseChat.mockReturnValue({
      ...mockUseChat.mock.results.at(-1)?.value,
      isStreaming: false,
    });
    let compareCount = 0;
    mockBridgeRequest.mockImplementation((name: string, data?: Record<string, unknown>) => {
      if (name === 'conversation.ensure-runtime') {
        return Promise.resolve({ recovered: false, runtime: null, config_options: [] });
      }
      if (name === 'fileSnapshot.compare') {
        compareCount += 1;
        return Promise.resolve({
          mode: 'git-repo',
          branch: 'main',
          staged:
            compareCount > 1
              ? []
              : [
                  {
                    file_path: '/tmp/project/README.md',
                    relativePath: 'README.md',
                    operation: 'modify',
                    additions: 2,
                    deletions: 1,
                  },
                ],
          unstaged: [],
        });
      }
      if (name === 'fileSnapshot.unstageAll') {
        expect(data).toEqual({ workspace: '/tmp/project' });
        return Promise.resolve(undefined);
      }
      return Promise.resolve(null);
    });

    const screen = render(<ChatScreen conversationId='conv-1' />);

    await waitFor(() => {
      expect(screen.getByTestId('unstage-all-workspace-files')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('unstage-all-workspace-files'));

    await waitFor(() => {
      expect(mockBridgeRequest).toHaveBeenCalledWith('fileSnapshot.unstageAll', { workspace: '/tmp/project' });
      expect(compareCount).toBeGreaterThan(1);
    });
  });

  it('confirms before discarding an unstaged workspace file from the chat summary', async () => {
    mockUseChat.mockReturnValue({
      ...mockUseChat.mock.results.at(-1)?.value,
      isStreaming: false,
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.style === 'destructive')?.onPress?.();
    });
    let compareCount = 0;
    mockBridgeRequest.mockImplementation((name: string, data?: Record<string, unknown>) => {
      if (name === 'conversation.ensure-runtime') {
        return Promise.resolve({ recovered: false, runtime: null, config_options: [] });
      }
      if (name === 'fileSnapshot.compare') {
        compareCount += 1;
        return Promise.resolve({
          mode: 'git-repo',
          branch: 'main',
          staged: [],
          unstaged:
            compareCount > 1
              ? []
              : [
                  {
                    file_path: '/tmp/project/src/App.tsx',
                    relativePath: 'src/App.tsx',
                    operation: 'modify',
                    additions: 2,
                    deletions: 1,
                  },
                ],
        });
      }
      if (name === 'fileSnapshot.discardFile') {
        expect(data).toEqual({ workspace: '/tmp/project', relativePath: 'src/App.tsx', operation: 'modify' });
        return Promise.resolve(undefined);
      }
      return Promise.resolve(null);
    });

    const screen = render(<ChatScreen conversationId='conv-1' />);

    await waitFor(() => {
      expect(screen.getByTestId('discard-workspace-file')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('discard-workspace-file'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
      expect(mockBridgeRequest).toHaveBeenCalledWith('fileSnapshot.discardFile', {
        workspace: '/tmp/project',
        relativePath: 'src/App.tsx',
        operation: 'modify',
      });
      expect(compareCount).toBeGreaterThan(1);
    });
    alertSpy.mockRestore();
  });
});
