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
  const border = useThemeColor({}, 'border');
  const icon = useThemeColor({}, 'icon');
  const textSecondary = useThemeColor({}, 'textSecondary');
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
      const detail =
        typeof message.content.message === 'string'
          ? message.content.message
          : typeof message.content.detail === 'string'
            ? message.content.detail
            : '';
      return (
        <View style={styles.tipRow}>
          <View style={[styles.statusBubble, { backgroundColor: surface }]}>
            <ThemedText type='caption'>
              {agentName}: {status}
            </ThemedText>
            {detail ? (
              <ThemedText type='caption' style={styles.statusDetail}>
                {detail}
              </ThemedText>
            ) : null}
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
      const entries = normalizePlanEntries(message.content?.entries);
      const done = entries.filter((entry) => isPlanEntryComplete(entry.status)).length;
      const activeEntry =
        entries.find((entry) => entry.status === 'in_progress') ||
        entries.find((entry) => entry.status === 'pending') ||
        [...entries].reverse().find((entry) => isPlanEntryComplete(entry.status)) ||
        entries[0];
      const activeTitle = activeEntry ? planEntryTitle(activeEntry) : '';
      return (
        <View style={[styles.row, styles.rowLeft]}>
          <View style={[styles.planContainer, { backgroundColor: surface, borderColor: border }]}>
            <View style={styles.planHeader}>
              <View style={styles.planTitleRow}>
                <Ionicons name='checkbox-outline' size={16} color={tint} />
                <ThemedText style={styles.planTitle}>Plan</ThemedText>
              </View>
              {entries.length > 0 ? (
                <ThemedText type='caption' style={[styles.planProgress, { color: textSecondary }]}>
                  {done}/{entries.length} done
                </ThemedText>
              ) : null}
            </View>
            {activeTitle ? (
              <ThemedText type='caption' style={[styles.planPreview, { color: textSecondary }]} numberOfLines={1}>
                Current: {activeTitle}
              </ThemedText>
            ) : null}
            <View style={styles.planList}>
              {entries.map((entry, i) => {
                const title = planEntryTitle(entry);
                const complete = isPlanEntryComplete(entry.status);
                return (
                  <View key={`${entry.status}-${title}-${i}`} style={styles.planEntry}>
                    <Ionicons
                      name={planEntryIcon(entry.status)}
                      size={15}
                      color={planEntryColor(entry.status, { success, warning, tint, icon })}
                    />
                    <View style={styles.planEntryBody}>
                      <ThemedText
                        type='caption'
                        style={[
                          styles.planEntryText,
                          { color: complete ? textSecondary : undefined },
                          complete ? styles.planEntryTextComplete : null,
                        ]}
                      >
                        {title}
                      </ThemedText>
                      {entry.priority ? (
                        <ThemedText type='caption' style={[styles.planPriority, { color: textSecondary }]}>
                          {entry.priority}
                        </ThemedText>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
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

type PlanEntry = {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
};

function normalizePlanEntries(value: unknown): PlanEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null && !Array.isArray(entry))
    .map((entry) => ({
      title: typeof entry.title === 'string' ? entry.title : undefined,
      description: typeof entry.description === 'string' ? entry.description : undefined,
      status: typeof entry.status === 'string' ? entry.status : 'pending',
      priority: typeof entry.priority === 'string' ? entry.priority : undefined,
    }))
    .filter((entry) => planEntryTitle(entry).length > 0);
}

function planEntryTitle(entry: PlanEntry): string {
  return entry.title || entry.description || '';
}

function isPlanEntryComplete(status?: string): boolean {
  return status === 'completed' || status === 'cancelled' || status === 'canceled';
}

function planEntryIcon(status?: string): keyof typeof Ionicons.glyphMap {
  if (status === 'completed') return 'checkmark-circle';
  if (status === 'in_progress') return 'radio-button-on';
  if (status === 'cancelled' || status === 'canceled') return 'close-circle';
  return 'ellipse-outline';
}

function planEntryColor(
  status: string | undefined,
  colors: { success: string; warning: string; tint: string; icon: string },
): string {
  if (status === 'completed') return colors.success;
  if (status === 'in_progress') return colors.tint;
  if (status === 'cancelled' || status === 'canceled') return colors.warning;
  return colors.icon;
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
    maxWidth: '90%',
    gap: 2,
  },
  statusDetail: {
    opacity: 0.72,
  },
  confirmContainer: {
    maxWidth: '90%',
  },
  planContainer: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxWidth: '90%',
    minWidth: 220,
    gap: 8,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  planTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minWidth: 0,
  },
  planTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  planProgress: {
    fontSize: 12,
    flexShrink: 0,
  },
  planPreview: {
    fontSize: 12,
    lineHeight: 17,
  },
  planList: {
    gap: 7,
  },
  planEntry: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  planEntryBody: {
    flex: 1,
    minWidth: 0,
  },
  planEntryText: {
    fontSize: 13,
    lineHeight: 18,
  },
  planEntryTextComplete: {
    textDecorationLine: 'line-through',
  },
  planPriority: {
    marginTop: 1,
    fontSize: 11,
    textTransform: 'uppercase',
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
