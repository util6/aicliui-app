import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '../ui/ThemedText';
import { MessageBubble } from './MessageBubble';
import { ToolCallSummary } from './ToolCallSummary';
import { ChatInputBar } from './ChatInputBar';
import { ChatSessionBar } from './ChatSessionBar';
import { ContextUsageIndicator } from './ContextUsageIndicator';
import { QueuedCommandPanel } from './QueuedCommandPanel';
import { useChat } from '../../context/ChatContext';
import { useConversations } from '../../context/ConversationContext';
import { useThemeColor } from '../../hooks/useThemeColor';
import { useProcessedMessages, type ProcessedItem } from '../../hooks/useProcessedMessages';
import { bridge } from '../../services/bridge';

type AcpModelInfo = {
  currentModelId: string | null;
  currentModelLabel: string | null;
  availableModels: Array<{ id: string; label: string }>;
  canSwitch: boolean;
  source: 'configOption' | 'models';
  configOptionId?: string;
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
  const [modelInfo, setModelInfo] = useState<AcpModelInfo | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const background = useThemeColor({}, 'background');
  const surface = useThemeColor({}, 'surface');
  const processedMessages = useProcessedMessages(messages);
  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === conversationId),
    [conversations, conversationId],
  );
  const activeBackend = activeConversation?.extra.backend;

  useEffect(() => {
    loadConversation(conversationId);
  }, [conversationId, loadConversation]);

  useEffect(() => {
    let cancelled = false;
    setModelInfo(null);
    if (!activeBackend) return;

    bridge
      .request<{ success: boolean; data?: { modelInfo: AcpModelInfo | null } }>(
        'acp.probe-model-info',
        { backend: activeBackend },
      )
      .then((res) => {
        if (!cancelled && res?.success) {
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
  }, [activeBackend]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0) {
      // Small delay to ensure layout is ready
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  const renderItem = useCallback(
    ({ item }: { item: ProcessedItem }) => {
      if (item.type === 'tool_summary') {
        return <ToolCallSummary messages={item.messages} isStreaming={isStreaming} />;
      }
      return <MessageBubble message={item} />;
    },
    [isStreaming]
  );

  const keyExtractor = useCallback((item: ProcessedItem) => item.id, []);
  const handleSessionModelSelect = useCallback(
    (model: { id: string; label: string }) => {
      if (!activeConversation) return;
      void updateConversationExecutionContext(activeConversation.id, {
        currentModelId: model.id,
        currentModelLabel: model.label,
      });
    },
    [activeConversation, updateConversationExecutionContext],
  );
  const handleSessionModeSelect = useCallback(
    (mode: string) => {
      if (!activeConversation) return;
      void updateConversationExecutionContext(activeConversation.id, {
        sessionMode: mode,
      });
    },
    [activeConversation, updateConversationExecutionContext],
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
        onModelSelect={handleSessionModelSelect}
        onModeSelect={handleSessionModeSelect}
      />
      <FlatList
        ref={flatListRef}
        data={processedMessages}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.list}
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
        slashCommands={slashCommands}
      />
    </KeyboardAvoidingView>
  );
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
});
