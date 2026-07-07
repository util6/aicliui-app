import React, { useState } from 'react';
import { TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '../ui/ThemedText';
import { MarkdownContent } from './MarkdownContent';
import { ConfirmationCard } from './ConfirmationCard';
import { useThemeColor } from '../../hooks/useThemeColor';
import type { TMessage } from '../../utils/messageAdapter';

type MessageBubbleProps = {
  message: TMessage;
};

export function MessageBubble({ message }: MessageBubbleProps) {
  const tint = useThemeColor({}, 'tint');
  const surface = useThemeColor({}, 'surface');
  const error = useThemeColor({}, 'error');
  const warning = useThemeColor({}, 'warning');
  const success = useThemeColor({}, 'success');
  const tipErrorBg = useThemeColor({}, 'tipErrorBg');
  const tipWarningBg = useThemeColor({}, 'tipWarningBg');
  const tipSuccessBg = useThemeColor({}, 'tipSuccessBg');

  switch (message.type) {
    case 'text': {
      const isUser = message.position === 'right';
      return (
        <View style={[styles.row, isUser ? styles.rowRight : styles.rowLeft]}>
          <View
            style={[
              styles.bubble,
              isUser
                ? [styles.bubbleUser, { backgroundColor: tint }]
                : [styles.bubbleAssistant, { backgroundColor: surface }],
            ]}
          >
            {isUser ? (
              <ThemedText style={styles.userText}>{message.content.content}</ThemedText>
            ) : (
              <MarkdownContent content={message.content.content} />
            )}
          </View>
        </View>
      );
    }

    case 'tips': {
      const tipType = message.content.type;
      const bgColor = tipType === 'error' ? tipErrorBg : tipType === 'warning' ? tipWarningBg : tipSuccessBg;
      const textColor = tipType === 'error' ? error : tipType === 'warning' ? warning : success;
      return (
        <View style={styles.tipRow}>
          <View style={[styles.tipBubble, { backgroundColor: bgColor }]}>
            <ThemedText style={[styles.tipText, { color: textColor }]}>{message.content.content}</ThemedText>
          </View>
        </View>
      );
    }

    case 'agent_status': {
      const status = message.content.status;
      const agentName = message.content.agentName || message.content.backend;
      return (
        <View style={styles.tipRow}>
          <View style={[styles.statusBubble, { backgroundColor: surface }]}>
            <ThemedText type='caption'>
              {agentName}: {status}
            </ThemedText>
          </View>
        </View>
      );
    }

    case 'acp_permission':
    case 'codex_permission':
      return (
        <View style={[styles.row, styles.rowLeft]}>
          <View style={styles.confirmContainer}>
            <ConfirmationCard content={message.content} msgId={message.msg_id} />
          </View>
        </View>
      );

    case 'plan': {
      const entries = message.content?.entries || [];
      return (
        <View style={[styles.row, styles.rowLeft]}>
          <View style={[styles.planContainer, { backgroundColor: surface }]}>
            <ThemedText style={styles.planTitle}>Plan</ThemedText>
            {entries.map((entry: any, i: number) => (
              <View key={i} style={styles.planEntry}>
                <ThemedText type='caption'>
                  {entry.status === 'completed' ? '\u2705' : entry.status === 'in_progress' ? '\u23F3' : '\u2B55'}{' '}
                  {entry.title || entry.description}
                </ThemedText>
              </View>
            ))}
          </View>
        </View>
      );
    }

    case 'thinking':
      return <ThinkingBlock message={message} />;

    default:
      return null;
  }
}

function ThinkingBlock({ message }: { message: TMessage }) {
  const { t } = useTranslation();
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const icon = useThemeColor({}, 'icon');
  const tint = useThemeColor({}, 'tint');
  const textSecondary = useThemeColor({}, 'textSecondary');
  const isDone = message.content?.status === 'done';
  const [expanded, setExpanded] = useState(!isDone);

  const summary = isDone
    ? `${t('chat.thoughtComplete', { defaultValue: 'Thought complete' })} · ${formatDuration(
        Number(message.content?.duration || 0),
      )}`
    : message.content?.subject || t('chat.thinking');

  return (
    <View style={[styles.row, styles.rowLeft]}>
      <View style={[styles.thinkingContainer, { backgroundColor: surface, borderColor: border }]}>
        <TouchableOpacity
          style={styles.thinkingHeader}
          onPress={() => setExpanded((value) => !value)}
          activeOpacity={0.75}
        >
          <Ionicons name={isDone ? 'bulb-outline' : 'sync-circle'} size={16} color={isDone ? icon : tint} />
          <ThemedText style={styles.thinkingSummary} numberOfLines={1}>
            {summary}
          </ThemedText>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={15} color={icon} />
        </TouchableOpacity>
        {expanded && Boolean(message.content?.content) && (
          <View style={[styles.thinkingBody, { borderTopColor: border }]}>
            <ThemedText style={[styles.thinkingText, { color: textSecondary }]}>{message.content.content}</ThemedText>
          </View>
        )}
      </View>
    </View>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 12,
    paddingVertical: 3,
  },
  rowLeft: {
    alignItems: 'flex-start',
  },
  rowRight: {
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    borderBottomLeftRadius: 4,
  },
  userText: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 22,
  },
  tipRow: {
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  tipBubble: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
    maxWidth: '90%',
  },
  tipText: {
    fontSize: 13,
    textAlign: 'center',
  },
  statusBubble: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  confirmContainer: {
    maxWidth: '90%',
  },
  planContainer: {
    borderRadius: 12,
    padding: 14,
    maxWidth: '90%',
    gap: 4,
  },
  planTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  planEntry: {
    paddingVertical: 2,
  },
  thinkingContainer: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    maxWidth: '90%',
    overflow: 'hidden',
  },
  thinkingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  thinkingSummary: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  thinkingBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  thinkingText: {
    fontSize: 13,
    lineHeight: 19,
  },
});
