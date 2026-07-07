import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '../ui/ThemedText';
import { useThemeColor } from '../../hooks/useThemeColor';
import type { SlashCommandItem } from '../../utils/slashCommands';

type ChatInputBarProps = {
  onSend: (text: string, files?: string[]) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
  slashCommands?: SlashCommandItem[];
};

export function ChatInputBar({ onSend, onStop, isStreaming, disabled, slashCommands = [] }: ChatInputBarProps) {
  const { t } = useTranslation();
  const tint = useThemeColor({}, 'tint');
  const background = useThemeColor({}, 'background');
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const error = useThemeColor({}, 'error');
  const textColor = useThemeColor({}, 'text');
  const textSecondary = useThemeColor({}, 'textSecondary');
  const [text, setText] = useState('');
  const matchingSlashCommands = getMatchingSlashCommands(text, slashCommands);
  const showSlashCommands = matchingSlashCommands.length > 0;

  const handleSend = () => {
    if (showSlashCommands) {
      handleSelectSlashCommand(matchingSlashCommands[0]);
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  };

  const handleSelectSlashCommand = (command: SlashCommandItem) => {
    setText(`/${command.name} `);
  };

  const showSend = text.trim().length > 0;

  return (
    <View style={[styles.container, { borderTopColor: border, backgroundColor: background }]}>
      {showSlashCommands && (
        <View style={[styles.slashMenu, { backgroundColor: surface, borderColor: border }]}>
          <View style={styles.slashHeader}>
            <Ionicons name='code-slash' size={14} color={tint} />
            <ThemedText style={[styles.slashHeaderText, { color: textSecondary }]}>
              {t('chat.slashCommands', { defaultValue: 'Commands' })}
            </ThemedText>
          </View>
          {matchingSlashCommands.map((command) => (
            <TouchableOpacity
              key={`${command.source}-${command.name}`}
              style={styles.slashItem}
              onPress={() => handleSelectSlashCommand(command)}
              activeOpacity={0.75}
            >
              <ThemedText style={styles.slashName}>/{command.name}</ThemedText>
              <ThemedText style={[styles.slashDescription, { color: textSecondary }]} numberOfLines={1}>
                {command.description}
              </ThemedText>
              {command.hint && (
                <ThemedText style={[styles.slashHint, { color: textSecondary }]} numberOfLines={1}>
                  {command.hint}
                </ThemedText>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}
      <View style={[styles.inputRow, { backgroundColor: surface }]}>
        <TextInput
          style={[styles.input, { color: textColor }]}
          value={text}
          onChangeText={setText}
          placeholder={t('chat.inputPlaceholder')}
          placeholderTextColor={textSecondary}
          multiline
          maxLength={10000}
          editable={!disabled}
          onSubmitEditing={handleSend}
          blurOnSubmit={false}
        />
        {isStreaming ? (
          <TouchableOpacity style={styles.stopButton} onPress={onStop} activeOpacity={0.7}>
            <Ionicons name='stop-circle' size={28} color={error} />
          </TouchableOpacity>
        ) : showSend ? (
          <TouchableOpacity style={styles.sendButton} onPress={handleSend} activeOpacity={0.7}>
            <Ionicons name='arrow-up-circle' size={32} color={tint} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

function getMatchingSlashCommands(text: string, slashCommands: SlashCommandItem[]): SlashCommandItem[] {
  if (!text.startsWith('/') || text.includes(' ') || slashCommands.length === 0) return [];

  const query = text.slice(1).toLowerCase();
  return slashCommands
    .filter((command) => {
      const name = command.name.toLowerCase();
      const description = command.description.toLowerCase();
      return name.includes(query) || description.includes(query);
    })
    .slice(0, 6);
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
  },
  slashMenu: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    marginBottom: 8,
    overflow: 'hidden',
  },
  slashHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 9,
    paddingBottom: 5,
  },
  slashHeaderText: {
    fontSize: 12,
    fontWeight: '600',
  },
  slashItem: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  slashName: {
    fontSize: 14,
    fontWeight: '600',
  },
  slashDescription: {
    fontSize: 12,
  },
  slashHint: {
    fontSize: 11,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    minHeight: 40,
    maxHeight: 120,
  },
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    paddingVertical: 6,
    maxHeight: 100,
  },
  sendButton: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 2,
  },
  stopButton: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 2,
  },
});
