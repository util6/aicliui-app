import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '../ui/ThemedText';
import { useThemeColor } from '../../hooks/useThemeColor';
import type { QueuedCommand, QueuedCommandMoveDirection } from '../../context/ChatContext';

type QueuedCommandPanelProps = {
  items: QueuedCommand[];
  isPaused?: boolean;
  onRemove: (commandId: string) => void;
  onMove?: (commandId: string, direction: QueuedCommandMoveDirection) => void;
  onClear: () => void;
  onResume?: () => void;
};

export function QueuedCommandPanel({
  items,
  isPaused = false,
  onRemove,
  onMove,
  onClear,
  onResume,
}: QueuedCommandPanelProps) {
  const { t } = useTranslation();
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const textSecondary = useThemeColor({}, 'textSecondary');
  const tint = useThemeColor({}, 'tint');
  const error = useThemeColor({}, 'error');
  const warning = useThemeColor({}, 'warning');

  if (items.length === 0) {
    return null;
  }

  return (
    <View style={[styles.container, { backgroundColor: surface, borderColor: border }]}>
      <View style={styles.header}>
        <View style={styles.headerTitle}>
          <Ionicons name='list-outline' size={14} color={tint} />
          <ThemedText style={styles.title}>
            {t('chat.queuedCommandTitle', { defaultValue: 'Queued commands' })}
          </ThemedText>
          <ThemedText style={[styles.count, { color: textSecondary }]}>
            {t('chat.queuedCommands', { count: items.length, defaultValue: `${items.length} queued` })}
          </ThemedText>
          {isPaused && (
            <ThemedText style={[styles.pausedLabel, { color: warning }]}>
              {t('chat.queuePaused', { defaultValue: 'Paused' })}
            </ThemedText>
          )}
        </View>
        <View style={styles.headerActions}>
          {isPaused && onResume && (
            <TouchableOpacity accessibilityRole='button' onPress={onResume} activeOpacity={0.7}>
              <ThemedText style={[styles.resumeText, { color: tint }]}>
                {t('chat.resumeQueuedCommands', { defaultValue: 'Resume' })}
              </ThemedText>
            </TouchableOpacity>
          )}
          <TouchableOpacity accessibilityRole='button' onPress={onClear} activeOpacity={0.7}>
            <ThemedText style={[styles.clearText, { color: error }]}>
              {t('chat.clearQueuedCommands', { defaultValue: 'Clear' })}
            </ThemedText>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} bounces={false}>
        {items.map((item, index) => {
          const preview = getQueuedCommandPreview(item.input);
          const fileCountLabel =
            item.files.length > 0
              ? t('chat.queuedCommandFiles', {
                  count: item.files.length,
                  defaultValue: item.files.length === 1 ? '1 file' : `${item.files.length} files`,
                })
              : null;

          return (
            <View key={item.id} style={[styles.item, { borderColor: border }]}>
              <Ionicons name='return-down-forward-outline' size={14} color={textSecondary} />
              <View style={styles.itemText}>
                <ThemedText numberOfLines={1} style={styles.preview}>
                  {preview}
                </ThemedText>
                {fileCountLabel && (
                  <ThemedText numberOfLines={1} style={[styles.fileCount, { color: textSecondary }]}>
                    {fileCountLabel}
                  </ThemedText>
                )}
              </View>
              {onMove && items.length > 1 && (
                <View style={styles.moveButtons}>
                  {index > 0 ? (
                    <TouchableOpacity
                      accessibilityRole='button'
                      accessibilityLabel={t('chat.moveQueuedCommandUp', {
                        defaultValue: 'Move queued command up',
                      })}
                      onPress={() => onMove(item.id, 'up')}
                      activeOpacity={0.7}
                      style={styles.moveButton}
                    >
                      <Ionicons name='chevron-up-outline' size={16} color={textSecondary} />
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.moveButton} />
                  )}
                  {index < items.length - 1 ? (
                    <TouchableOpacity
                      accessibilityRole='button'
                      accessibilityLabel={t('chat.moveQueuedCommandDown', {
                        defaultValue: 'Move queued command down',
                      })}
                      onPress={() => onMove(item.id, 'down')}
                      activeOpacity={0.7}
                      style={styles.moveButton}
                    >
                      <Ionicons name='chevron-down-outline' size={16} color={textSecondary} />
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.moveButton} />
                  )}
                </View>
              )}
              <TouchableOpacity
                accessibilityRole='button'
                accessibilityLabel={t('chat.removeQueuedCommand', { defaultValue: 'Remove queued command' })}
                onPress={() => onRemove(item.id)}
                activeOpacity={0.7}
                style={styles.removeButton}
              >
                <Ionicons name='close-circle-outline' size={20} color={error} />
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function getQueuedCommandPreview(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

const styles = StyleSheet.create({
  container: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    marginHorizontal: 12,
    marginBottom: 8,
    overflow: 'hidden',
  },
  header: {
    minHeight: 34,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  count: {
    fontSize: 11,
    lineHeight: 15,
  },
  clearText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  pausedLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  resumeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  list: {
    maxHeight: 138,
  },
  listContent: {
    paddingHorizontal: 6,
    paddingBottom: 6,
    gap: 4,
  },
  item: {
    minHeight: 34,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  itemText: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  preview: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  fileCount: {
    maxWidth: 72,
    fontSize: 11,
    lineHeight: 15,
  },
  moveButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  moveButton: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
