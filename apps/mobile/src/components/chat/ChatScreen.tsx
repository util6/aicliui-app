import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '../ui/ThemedText';
import { MessageBubble } from './MessageBubble';
import { ToolCallSummary } from './ToolCallSummary';
import { ChatInputBar } from './ChatInputBar';
import { ChatSessionBar } from './ChatSessionBar';
import { ContextUsageIndicator } from './ContextUsageIndicator';
import { QueuedCommandPanel } from './QueuedCommandPanel';
import { FilePickerSheet } from './FilePickerSheet';
import { ConversationArtifactCard } from './ConversationArtifactCard';
import {
  WorkspaceChangeSummaryCard,
  type WorkspaceFileChange,
  type WorkspaceFileChangeSummary,
} from './WorkspaceChangeSummaryCard';
import { MarkdownContent } from './MarkdownContent';
import { useChat } from '../../context/ChatContext';
import { useConversations } from '../../context/ConversationContext';
import { useFilesTabOptional } from '../../context/FilesTabContext';
import { useThemeColor } from '../../hooks/useThemeColor';
import { useProcessedMessages, type ProcessedItem } from '../../hooks/useProcessedMessages';
import { bridge } from '../../services/bridge';
import { getAgentModes } from '../../constants/agentModes';

type AcpModelInfo = {
  currentModelId: string | null;
  currentModelLabel: string | null;
  availableModels: Array<{ id: string; label: string }>;
  canSwitch: boolean;
  source: 'configOption' | 'models';
  configOptionId?: string;
};

type AcpConfigOption = {
  id: string;
  category?: string | null;
  type?: string | null;
  option_type?: string | null;
  current_value?: string | null;
  options: Array<{
    value: string;
    name?: string | null;
    label?: string | null;
    description?: string | null;
  }>;
};

type EnsureRuntimeResponse = {
  config_options?: AcpConfigOption[];
  modelInfo?: AcpModelInfo | null;
};

type ConfigOptionIds = {
  model?: string;
  mode?: string;
};

type ChatScreenProps = {
  conversationId: string;
};

export function ChatScreen({ conversationId }: ChatScreenProps) {
  const { t } = useTranslation();
  const {
    messages,
    isStreaming,
    canSendMessage,
    queuedCommands,
    isQueuePaused,
    queuedCommandWarning,
    queuedCommandDraft,
    artifacts,
    thought,
    contextUsage,
    slashCommands,
    loadConversation,
    sendMessage,
    removeQueuedCommand,
    editQueuedCommand,
    clearQueuedCommandDraft,
    moveQueuedCommand,
    clearQueuedCommands,
    resumeQueuedCommands,
    stopGeneration,
  } = useChat();
  const { conversations, updateConversationExecutionContext } = useConversations();
  const filesTab = useFilesTabOptional();
  const router = useRouter();
  const [modelInfo, setModelInfo] = useState<AcpModelInfo | null>(null);
  const [configOptionIds, setConfigOptionIds] = useState<ConfigOptionIds>({});
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [isFilePickerVisible, setIsFilePickerVisible] = useState(false);
  const [workspaceChanges, setWorkspaceChanges] = useState<WorkspaceFileChangeSummary | null>(null);
  const [workspaceDiff, setWorkspaceDiff] = useState<WorkspaceFileDiff | null>(null);
  const [isWorkspaceDiffLoading, setIsWorkspaceDiffLoading] = useState(false);
  const [workspaceDiffError, setWorkspaceDiffError] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const workspaceDiffRequestRef = useRef(0);
  const background = useThemeColor({}, 'background');
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const tint = useThemeColor({}, 'tint');
  const processedMessages = useProcessedMessages(messages, artifacts);
  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === conversationId),
    [conversations, conversationId],
  );
  const activeBackend = activeConversation?.extra.backend;
  const modes = useMemo(() => getAgentModes(activeBackend), [activeBackend]);
  const filePickerRoot = useMemo(
    () =>
      activeConversation?.extra.workspace ??
      conversations.find((conversation) => conversation.extra?.workspace)?.extra?.workspace ??
      '/',
    [activeConversation?.extra.workspace, conversations],
  );

  useEffect(() => {
    loadConversation(conversationId);
  }, [conversationId, loadConversation]);

  useEffect(() => {
    setAttachedFiles([]);
    setIsFilePickerVisible(false);
    setWorkspaceChanges(null);
    workspaceDiffRequestRef.current += 1;
    setWorkspaceDiff(null);
    setWorkspaceDiffError(null);
    setIsWorkspaceDiffLoading(false);
  }, [conversationId]);

  useEffect(() => {
    setWorkspaceChanges(null);
    workspaceDiffRequestRef.current += 1;
    setWorkspaceDiff(null);
    setWorkspaceDiffError(null);
    setIsWorkspaceDiffLoading(false);
  }, [activeConversation?.extra.workspace]);

  useEffect(() => {
    let cancelled = false;
    setModelInfo(null);
    setConfigOptionIds({});
    if (!activeBackend) return;

    bridge
      .request<EnsureRuntimeResponse>('conversation.ensure-runtime', { conversation_id: conversationId })
      .then((res) => {
        if (cancelled) return;
        const configOptions = Array.isArray(res?.config_options) ? res.config_options : [];
        setConfigOptionIds(getConfigOptionIds(configOptions));
        setModelInfo(modelInfoFromConfigOptions(configOptions) ?? res?.modelInfo ?? null);
      })
      .catch(() =>
        bridge.request<{ success: boolean; data?: { modelInfo: AcpModelInfo | null } }>(
          'acp.probe-model-info',
          { backend: activeBackend },
        ),
      )
      .then((res) => {
        if (!cancelled && res && 'success' in res && res.success) {
          setModelInfo(res.data?.modelInfo ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setModelInfo(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeBackend, conversationId]);

  useEffect(() => {
    let cancelled = false;
    const workspace = activeConversation?.extra.workspace;
    if (!workspace || isStreaming) return () => {
      cancelled = true;
    };

    bridge
      .request<WorkspaceFileChangeSummary>('fileSnapshot.compare', { workspace }, 10000)
      .then((summary) => {
        if (cancelled) return;
        const count = (summary?.staged?.length ?? 0) + (summary?.unstaged?.length ?? 0);
        setWorkspaceChanges(count > 0 ? summary : null);
      })
      .catch(() => {
        if (!cancelled) setWorkspaceChanges(null);
      });

    return () => {
      cancelled = true;
    };
  }, [activeConversation?.extra.workspace, conversationId, isStreaming, messages.length]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (processedMessages.length > 0) {
      // Small delay to ensure layout is ready
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [processedMessages.length]);

  const renderItem = useCallback(
    ({ item }: { item: ProcessedItem }) => {
      if (item.type === 'tool_summary') {
        return <ToolCallSummary messages={item.messages} isStreaming={isStreaming} />;
      }
      if (item.type === 'artifact') {
        return <ConversationArtifactCard artifact={item.artifact} />;
      }
      return <MessageBubble message={item} />;
    },
    [isStreaming]
  );

  const keyExtractor = useCallback((item: ProcessedItem) => item.id, []);
  const handleSessionModelSelect = useCallback(
    (model: { id: string; label: string }) => {
      if (!activeConversation) return;
      const patch = {
        currentModelId: model.id,
        currentModelLabel: model.label,
      };
      void bridge
        .request('conversation.set-config-option', {
          conversation_id: activeConversation.id,
          option_id: configOptionIds.model ?? 'model',
          value: model.id,
        })
        .catch(() => null)
        .then(() => updateConversationExecutionContext(activeConversation.id, patch));
    },
    [activeConversation, configOptionIds.model, updateConversationExecutionContext],
  );
  const handleSessionModeSelect = useCallback(
    (mode: string) => {
      if (!activeConversation) return;
      const patch = {
        sessionMode: mode,
      };
      void bridge
        .request('conversation.set-config-option', {
          conversation_id: activeConversation.id,
          option_id: configOptionIds.mode ?? 'mode',
          value: mode,
        })
        .catch(() => null)
        .then(() => updateConversationExecutionContext(activeConversation.id, patch));
    },
    [activeConversation, configOptionIds.mode, updateConversationExecutionContext],
  );
  const handleAttachedFilesSelected = useCallback((files: string[]) => {
    setAttachedFiles(uniqueFiles(files));
  }, []);
  const handleRemoveAttachedFile = useCallback((file: string) => {
    setAttachedFiles((current) => current.filter((item) => item !== file));
  }, []);
  const clearAttachedFiles = useCallback(() => {
    setAttachedFiles([]);
  }, []);
  const handleOpenWorkspaceChange = useCallback(
    (change: { file_path: string }) => {
      filesTab?.openTab(change.file_path);
      router.push('/(tabs)/files');
    },
    [filesTab, router],
  );
  const handleOpenWorkspaceDiff = useCallback(
    (change: WorkspaceFileChange, source: 'staged' | 'unstaged') => {
      const workspace = activeConversation?.extra.workspace;
      if (!workspace) return;

      setWorkspaceDiff(null);
      setWorkspaceDiffError(null);
      setIsWorkspaceDiffLoading(true);
      const requestId = workspaceDiffRequestRef.current + 1;
      workspaceDiffRequestRef.current = requestId;
      bridge
        .request<WorkspaceFileDiff>('fileSnapshot.diff', {
          workspace,
          relativePath: change.relativePath,
          source,
        })
        .then((diff) => {
          if (workspaceDiffRequestRef.current === requestId) setWorkspaceDiff(diff);
        })
        .catch(() => {
          if (workspaceDiffRequestRef.current === requestId) setWorkspaceDiffError(t('filePreview.errorLoading'));
        })
        .finally(() => {
          if (workspaceDiffRequestRef.current === requestId) setIsWorkspaceDiffLoading(false);
        });
    },
    [activeConversation?.extra.workspace, t],
  );
  const closeWorkspaceDiff = useCallback(() => {
    workspaceDiffRequestRef.current += 1;
    setWorkspaceDiff(null);
    setWorkspaceDiffError(null);
    setIsWorkspaceDiffLoading(false);
  }, []);
  const refreshWorkspaceChangeSummary = useCallback(async (workspace: string) => {
    const summary = await bridge.request<WorkspaceFileChangeSummary>('fileSnapshot.compare', { workspace }, 10000);
    const count = (summary?.staged?.length ?? 0) + (summary?.unstaged?.length ?? 0);
    setWorkspaceChanges(count > 0 ? summary : null);
  }, []);
  const handleStageWorkspaceFile = useCallback(
    (change: WorkspaceFileChange) => {
      const workspace = activeConversation?.extra.workspace;
      if (!workspace) return;
      bridge
        .request('fileSnapshot.stageFile', { workspace, relativePath: change.relativePath })
        .then(() => refreshWorkspaceChangeSummary(workspace))
        .catch(() => null);
    },
    [activeConversation?.extra.workspace, refreshWorkspaceChangeSummary],
  );
  const handleUnstageWorkspaceFile = useCallback(
    (change: WorkspaceFileChange) => {
      const workspace = activeConversation?.extra.workspace;
      if (!workspace) return;
      bridge
        .request('fileSnapshot.unstageFile', { workspace, relativePath: change.relativePath })
        .then(() => refreshWorkspaceChangeSummary(workspace))
        .catch(() => null);
    },
    [activeConversation?.extra.workspace, refreshWorkspaceChangeSummary],
  );

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ChatSessionBar
        conversation={activeConversation}
        availableModels={modelInfo?.availableModels ?? []}
        canSwitchModel={Boolean(modelInfo?.canSwitch && modelInfo.availableModels.length > 0)}
      />
      <FlatList
        ref={flatListRef}
        data={processedMessages}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.list}
        ListFooterComponent={
          workspaceChanges ? (
            <WorkspaceChangeSummaryCard
              summary={workspaceChanges}
              onOpenFile={handleOpenWorkspaceChange}
              onOpenDiff={handleOpenWorkspaceDiff}
              onStageFile={handleStageWorkspaceFile}
              onUnstageFile={handleUnstageWorkspaceFile}
            />
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <ThemedText type='caption'>{t('conversations.empty')}</ThemedText>
          </View>
        }
      />
      {isStreaming && thought && (
        <View style={[styles.streamingIndicator, { backgroundColor: surface }]}>
          <ThemedText type='caption' numberOfLines={1}>
            {thought.subject || t('chat.thinking')}
          </ThemedText>
        </View>
      )}
      <ContextUsageIndicator usage={contextUsage} />
      <QueuedCommandPanel
        items={queuedCommands}
        isPaused={isQueuePaused}
        onRemove={removeQueuedCommand}
        onEdit={editQueuedCommand}
        onMove={moveQueuedCommand}
        onClear={clearQueuedCommands}
        onResume={resumeQueuedCommands}
      />
      <ChatInputBar
        onSend={sendMessage}
        onStop={stopGeneration}
        isStreaming={isStreaming}
        canSend={canSendMessage}
        queuedCount={queuedCommands.length}
        queueWarning={queuedCommandWarning}
        draft={queuedCommandDraft}
        onDraftConsumed={clearQueuedCommandDraft}
        attachedFiles={attachedFiles}
        onAttachPress={() => setIsFilePickerVisible(true)}
        onRemoveAttachedFile={handleRemoveAttachedFile}
        onClearAttachedFiles={clearAttachedFiles}
        slashCommands={slashCommands}
        availableModels={modelInfo?.availableModels ?? []}
        currentModelId={activeConversation?.extra.currentModelId ?? modelInfo?.currentModelId ?? null}
        canSwitchModel={Boolean(modelInfo?.canSwitch && modelInfo.availableModels.length > 0)}
        onModelSelect={handleSessionModelSelect}
        modes={modes}
        currentMode={activeConversation?.extra.sessionMode ?? modes[0]?.value ?? 'default'}
        onModeSelect={handleSessionModeSelect}
      />
      <FilePickerSheet
        visible={isFilePickerVisible}
        rootDir={filePickerRoot}
        selectedFiles={attachedFiles}
        onDone={handleAttachedFilesSelected}
        onClose={() => setIsFilePickerVisible(false)}
      />
      <Modal
        visible={isWorkspaceDiffLoading || Boolean(workspaceDiff) || Boolean(workspaceDiffError)}
        animationType='slide'
        onRequestClose={closeWorkspaceDiff}
      >
        <View style={[styles.diffModal, { backgroundColor: background }]}>
          <View style={[styles.diffHeader, { borderBottomColor: border }]}>
            <ThemedText style={styles.diffTitle} numberOfLines={1}>
              {workspaceDiff?.relativePath ?? 'Diff'}
            </ThemedText>
            <TouchableOpacity accessibilityRole='button' onPress={closeWorkspaceDiff} hitSlop={8}>
              <ThemedText style={[styles.diffClose, { color: tint }]}>
                {t('common.close', { defaultValue: 'Close' })}
              </ThemedText>
            </TouchableOpacity>
          </View>
          {isWorkspaceDiffLoading ? (
            <View style={styles.diffCenter}>
              <ActivityIndicator size='large' color={tint} />
              <ThemedText type='caption'>{t('filePreview.loading')}</ThemedText>
            </View>
          ) : workspaceDiffError ? (
            <View style={styles.diffCenter}>
              <ThemedText>{workspaceDiffError}</ThemedText>
            </View>
          ) : workspaceDiff ? (
            <ScrollView style={[styles.diffBody, { backgroundColor: surface }]}>
              <MarkdownContent content={`\`\`\`diff\n${workspaceDiff.diff}\n\`\`\``} />
            </ScrollView>
          ) : null}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

type WorkspaceFileDiff = {
  relativePath: string;
  source: 'staged' | 'unstaged';
  diff: string;
};

function uniqueFiles(files: string[]): string[] {
  return Array.from(new Set(files.filter((file) => typeof file === 'string' && file.length > 0)));
}

function getConfigOptionIds(configOptions: AcpConfigOption[]): ConfigOptionIds {
  const model = configOptions.find((option) => option.category === 'model' || option.id === 'model');
  const mode = configOptions.find((option) => option.category === 'mode' || option.id === 'mode');
  return {
    ...(model ? { model: model.id } : {}),
    ...(mode ? { mode: mode.id } : {}),
  };
}

function modelInfoFromConfigOptions(configOptions: AcpConfigOption[]): AcpModelInfo | null {
  const option = configOptions.find((item) => item.category === 'model' || item.id === 'model');
  const optionType = option?.option_type ?? option?.type;
  if (!option || optionType !== 'select') return null;
  const currentModelId = option.current_value ?? null;
  const currentModel = option.options.find((item) => item.value === currentModelId);
  return {
    currentModelId,
    currentModelLabel: currentModel?.label || currentModel?.name || currentModelId,
    availableModels: option.options.map((item) => ({
      id: item.value,
      label: item.label || item.name || item.value,
    })),
    canSwitch: option.options.length > 0,
    source: 'configOption',
    configOptionId: option.id,
  };
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    paddingVertical: 12,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    minHeight: 200,
  },
  streamingIndicator: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    alignItems: 'center',
  },
  diffModal: {
    flex: 1,
  },
  diffHeader: {
    minHeight: 56,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 16 : 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  diffTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
  },
  diffClose: {
    fontSize: 14,
    fontWeight: '700',
  },
  diffCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
  },
  diffBody: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
