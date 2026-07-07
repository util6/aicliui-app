import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '../ui/ThemedText';
import type { Conversation } from '../../context/ConversationContext';
import { getAgentModes } from '../../constants/agentModes';
import { useThemeColor } from '../../hooks/useThemeColor';

type ChatSessionBarProps = {
  conversation: Conversation | null | undefined;
};

type SessionChip = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
};

export function ChatSessionBar({ conversation }: ChatSessionBarProps) {
  const { t } = useTranslation();
  const background = useThemeColor({}, 'background');
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const iconColor = useThemeColor({}, 'icon');
  const textSecondary = useThemeColor({}, 'textSecondary');

  const chips = useMemo(() => buildSessionChips(conversation, t), [conversation, t]);

  if (chips.length === 0) return null;

  return (
    <View style={[styles.container, { backgroundColor: background, borderBottomColor: border }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.content}>
        {chips.map((chip) => (
          <View key={chip.key} style={[styles.chip, { backgroundColor: surface, borderColor: border }]}>
            <Ionicons name={chip.icon} size={14} color={iconColor} />
            <ThemedText style={[styles.chipText, { color: textSecondary }]} numberOfLines={1}>
              {chip.label}
            </ThemedText>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

export function buildSessionChips(
  conversation: Conversation | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): SessionChip[] {
  if (!conversation) return [];

  const { extra } = conversation;
  const chips: SessionChip[] = [];

  if (extra.workspace) {
    chips.push({
      key: 'workspace',
      icon: 'folder-outline',
      label: getPathDisplayName(extra.workspace),
    });
  }

  if (extra.defaultFiles?.length) {
    chips.push({
      key: 'files',
      icon: 'attach',
      label: t('chat.filesSelected', { count: extra.defaultFiles.length }),
    });
  }

  if (extra.currentModelId) {
    chips.push({
      key: 'model',
      icon: 'hardware-chip-outline',
      label: extra.currentModelId,
    });
  }

  if (extra.sessionMode) {
    const modeLabel =
      getAgentModes(extra.backend).find((mode) => mode.value === extra.sessionMode)?.label ?? extra.sessionMode;
    chips.push({
      key: 'mode',
      icon: 'flash-outline',
      label: modeLabel,
    });
  }

  return chips;
}

function getPathDisplayName(path: string): string {
  return path.split('/').filter(Boolean).pop() || path;
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  content: {
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 220,
    minHeight: 30,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '500',
  },
});
