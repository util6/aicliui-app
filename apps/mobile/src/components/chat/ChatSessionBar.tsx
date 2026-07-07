import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '../ui/ThemedText';
import type { Conversation } from '../../context/ConversationContext';
import { getAgentModes } from '../../constants/agentModes';
import { useThemeColor } from '../../hooks/useThemeColor';
import { ModelPickerSheet } from './ModelPickerSheet';
import { ModePickerSheet } from './ModePickerSheet';

type ChatSessionBarProps = {
  conversation: Conversation | null | undefined;
  availableModels?: SessionModelOption[];
  canSwitchModel?: boolean;
  onModelSelect?: (model: SessionModelOption) => void;
  onModeSelect?: (mode: string) => void;
};

export type SessionModelOption = {
  id: string;
  label: string;
};

type SessionChip = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
};

export function ChatSessionBar({
  conversation,
  availableModels = [],
  canSwitchModel = false,
  onModelSelect,
  onModeSelect,
}: ChatSessionBarProps) {
  const { t } = useTranslation();
  const background = useThemeColor({}, 'background');
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const iconColor = useThemeColor({}, 'icon');
  const textSecondary = useThemeColor({}, 'textSecondary');
  const [isModelPickerVisible, setIsModelPickerVisible] = useState(false);
  const [isModePickerVisible, setIsModePickerVisible] = useState(false);

  const chips = useMemo(() => buildSessionChips(conversation, t), [conversation, t]);
  const modes = useMemo(() => getAgentModes(conversation?.extra.backend), [conversation?.extra.backend]);
  const canOpenModelPicker = canSwitchModel && availableModels.length > 0 && Boolean(onModelSelect);
  const canOpenModePicker = modes.length > 0 && Boolean(onModeSelect);

  if (chips.length === 0) return null;

  return (
    <View style={[styles.container, { backgroundColor: background, borderBottomColor: border }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.content}>
        {chips.map((chip) => {
          const isInteractive =
            (chip.key === 'model' && canOpenModelPicker) ||
            (chip.key === 'mode' && canOpenModePicker);
          const chipContent = (
            <>
              <Ionicons name={chip.icon} size={14} color={iconColor} />
              <ThemedText style={[styles.chipText, { color: textSecondary }]} numberOfLines={1}>
                {chip.label}
              </ThemedText>
              {isInteractive && <Ionicons name='chevron-down' size={12} color={iconColor} />}
            </>
          );

          if (isInteractive) {
            return (
              <TouchableOpacity
                key={chip.key}
                style={[styles.chip, { backgroundColor: surface, borderColor: border }]}
                accessibilityRole='button'
                onPress={() => {
                  if (chip.key === 'model') {
                    setIsModelPickerVisible(true);
                  } else if (chip.key === 'mode') {
                    setIsModePickerVisible(true);
                  }
                }}
                activeOpacity={0.72}
              >
                {chipContent}
              </TouchableOpacity>
            );
          }

          return (
            <View key={chip.key} style={[styles.chip, { backgroundColor: surface, borderColor: border }]}>
              {chipContent}
            </View>
          );
        })}
      </ScrollView>
      {canOpenModelPicker && (
        <ModelPickerSheet
          visible={isModelPickerVisible}
          models={availableModels}
          currentModelId={conversation?.extra.currentModelId ?? null}
          onSelect={(modelId) => {
            const selectedModel = availableModels.find((model) => model.id === modelId);
            if (selectedModel) {
              onModelSelect?.(selectedModel);
            }
          }}
          onClose={() => setIsModelPickerVisible(false)}
        />
      )}
      {canOpenModePicker && (
        <ModePickerSheet
          visible={isModePickerVisible}
          modes={modes}
          currentMode={conversation?.extra.sessionMode ?? modes[0]?.value ?? 'default'}
          onSelect={(mode) => onModeSelect?.(mode)}
          onClose={() => setIsModePickerVisible(false)}
        />
      )}
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

  if (conversation.status === 'waiting_confirmation') {
    chips.push({
      key: 'waiting_confirmation',
      icon: 'shield-checkmark-outline',
      label: t('chat.waitingForConfirmation', { defaultValue: 'Waiting for confirmation' }),
    });
  }

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
      label: extra.currentModelLabel || extra.currentModelId,
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
