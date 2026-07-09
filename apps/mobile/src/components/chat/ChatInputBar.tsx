import React, { useEffect, useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, Platform, ScrollView, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '../ui/ThemedText';
import { useThemeColor } from '../../hooks/useThemeColor';
import { filterSlashCommands, matchSlashQuery, type SlashCommandItem } from '../../utils/slashCommands';
import type { AgentModeOption } from '../../constants/agentModes';
import { ModelPickerSheet } from './ModelPickerSheet';
import { ModePickerSheet } from './ModePickerSheet';

type ChatInputBarProps = {
  onSend: (text: string, files?: string[]) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  canSend?: boolean;
  queuedCount?: number;
  queueWarning?: QueueWarningReason | null;
  draft?: ChatInputDraft | null;
  onDraftConsumed?: (draftId: string) => void;
  attachedFiles?: string[];
  onAttachPress?: () => void;
  onRemoveAttachedFile?: (file: string) => void;
  onClearAttachedFiles?: () => void;
  disabled?: boolean;
  slashCommands?: SlashCommandItem[];
  availableModels?: ModelItem[];
  currentModelId?: string | null;
  canSwitchModel?: boolean;
  onModelSelect?: (model: ModelItem) => void;
  modes?: AgentModeOption[];
  currentMode?: string;
  onModeSelect?: (mode: string) => void;
};

type QueueWarningReason = 'emptyInput' | 'inputTooLong' | 'tooManyFiles' | 'queueFull' | 'queueTooLarge';
type ChatInputDraft = {
  id: string;
  text: string;
  files?: string[];
};
type ModelItem = { id: string; label: string };

export function ChatInputBar({
  onSend,
  onStop,
  isStreaming,
  canSend = true,
  queuedCount = 0,
  queueWarning = null,
  draft = null,
  onDraftConsumed,
  attachedFiles = [],
  onAttachPress,
  onRemoveAttachedFile,
  onClearAttachedFiles,
  disabled,
  slashCommands = [],
  availableModels = [],
  currentModelId = null,
  canSwitchModel = false,
  onModelSelect,
  modes = [],
  currentMode,
  onModeSelect,
}: ChatInputBarProps) {
  const { t } = useTranslation();
  const tint = useThemeColor({}, 'tint');
  const background = useThemeColor({}, 'background');
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const error = useThemeColor({}, 'error');
  const warning = useThemeColor({}, 'warning');
  const textColor = useThemeColor({}, 'text');
  const textSecondary = useThemeColor({}, 'textSecondary');
  const [text, setText] = useState('');
  const [draftFiles, setDraftFiles] = useState<string[]>([]);
  const [loadedDraftId, setLoadedDraftId] = useState<string | null>(null);
  const [isActionSheetVisible, setIsActionSheetVisible] = useState(false);
  const [isModelPickerVisible, setIsModelPickerVisible] = useState(false);
  const [isModePickerVisible, setIsModePickerVisible] = useState(false);
  const isDisabled = disabled === true;
  const canQueue = !isDisabled && !canSend && isStreaming === true;
  const sendBlocked = isDisabled || (!canSend && !canQueue);
  const slashQuery = matchSlashQuery(text);
  const matchingSlashCommands =
    slashQuery === null ? [] : filterSlashCommands(slashCommands, slashQuery).slice(0, 6);
  const showSlashCommands = canSend && !sendBlocked && matchingSlashCommands.length > 0;
  const visibleAttachedFiles = uniqueFiles([...attachedFiles, ...draftFiles]);
  const canOpenModelPicker = canSwitchModel && availableModels.length > 0 && Boolean(onModelSelect);
  const canOpenModePicker = modes.length > 0 && Boolean(onModeSelect);
  const hasActionEntries = Boolean(onAttachPress) || canOpenModelPicker || canOpenModePicker;
  const currentModelLabel =
    availableModels.find((model) => model.id === currentModelId)?.label ?? currentModelId ?? undefined;
  const resolvedCurrentMode = currentMode ?? modes[0]?.value ?? 'default';
  const currentModeLabel = modes.find((mode) => mode.value === resolvedCurrentMode)?.label ?? resolvedCurrentMode;

  useEffect(() => {
    if (!draft || draft.id === loadedDraftId) return;
    setText(draft.text);
    setDraftFiles(draft.files ?? []);
    setLoadedDraftId(draft.id);
  }, [draft, loadedDraftId]);

  const handleSend = () => {
    if (sendBlocked) return;
    if (showSlashCommands) {
      handleSelectSlashCommand(matchingSlashCommands[0]);
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) return;
    if (visibleAttachedFiles.length > 0) {
      onSend(trimmed, visibleAttachedFiles);
    } else {
      onSend(trimmed);
    }
    setText('');
    setDraftFiles([]);
    onClearAttachedFiles?.();
    if (loadedDraftId) {
      onDraftConsumed?.(loadedDraftId);
    }
  };

  const handleSelectSlashCommand = (command: SlashCommandItem) => {
    if (sendBlocked) return;
    setText(`/${command.name} `);
  };

  const showQueue = canQueue && text.trim().length > 0;
  const showSend = canSend && !sendBlocked && text.trim().length > 0;
  const showStop = !isDisabled && isStreaming;
  const handleRemoveAttachedFile = (file: string) => {
    if (attachedFiles.includes(file)) {
      onRemoveAttachedFile?.(file);
    }
    setDraftFiles((prev) => prev.filter((item) => item !== file));
  };

  return (
    <View style={[styles.container, { borderTopColor: border, backgroundColor: background }]}>
      {queueWarning && (
        <View style={styles.queueWarning}>
          <Ionicons name='warning-outline' size={13} color={warning} />
          <ThemedText style={[styles.queueWarningText, { color: warning }]} numberOfLines={2}>
            {getQueueWarningText(t, queueWarning)}
          </ThemedText>
        </View>
      )}
      {queuedCount > 0 && (
        <View style={styles.queueStatus}>
          <Ionicons name='list-outline' size={13} color={textSecondary} />
          <ThemedText style={[styles.queueStatusText, { color: textSecondary }]}>
            {t('chat.queuedCommands', { count: queuedCount, defaultValue: `${queuedCount} queued` })}
          </ThemedText>
        </View>
      )}
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
      {visibleAttachedFiles.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.attachmentList}
          style={styles.attachmentScroll}
        >
          {visibleAttachedFiles.map((file) => {
            const fileName = getFileName(file);
            return (
              <View key={file} style={[styles.attachmentChip, { backgroundColor: surface, borderColor: border }]}>
                <Ionicons name='document-outline' size={13} color={textSecondary} />
                <ThemedText style={[styles.attachmentText, { color: textSecondary }]} numberOfLines={1}>
                  {fileName}
                </ThemedText>
                <TouchableOpacity
                  accessibilityRole='button'
                  accessibilityLabel={t('chat.removeAttachedFile', {
                    file: fileName,
                    defaultValue: `Remove attached file ${fileName}`,
                  })}
                  onPress={() => handleRemoveAttachedFile(file)}
                  activeOpacity={0.72}
                  hitSlop={6}
                >
                  <Ionicons name='close-circle' size={15} color={textSecondary} />
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      )}
      <View style={[styles.inputRow, { backgroundColor: surface }]}>
        {hasActionEntries && (
          <TouchableOpacity
            accessibilityRole='button'
            accessibilityLabel={t('chat.openActions', { defaultValue: 'Open chat actions' })}
            style={styles.attachButton}
            onPress={() => setIsActionSheetVisible(true)}
            disabled={isDisabled}
            activeOpacity={0.72}
          >
            <Ionicons name='add' size={24} color={isDisabled ? textSecondary : tint} />
          </TouchableOpacity>
        )}
        <TextInput
          style={[styles.input, { color: textColor }]}
          value={text}
          onChangeText={setText}
          placeholder={t('chat.inputPlaceholder')}
          placeholderTextColor={textSecondary}
          multiline
          maxLength={10000}
          editable={!isDisabled}
          onSubmitEditing={handleSend}
          blurOnSubmit={false}
        />
        {showQueue && (
          <TouchableOpacity style={styles.sendButton} onPress={handleSend} activeOpacity={0.7}>
            <Ionicons name='add-circle-outline' size={30} color={tint} />
          </TouchableOpacity>
        )}
        {showStop ? (
          <TouchableOpacity style={styles.stopButton} onPress={onStop} activeOpacity={0.7}>
            <Ionicons name='stop-circle' size={28} color={error} />
          </TouchableOpacity>
        ) : showSend ? (
          <TouchableOpacity style={styles.sendButton} onPress={handleSend} activeOpacity={0.7}>
            <Ionicons name='arrow-up-circle' size={32} color={tint} />
          </TouchableOpacity>
        ) : null}
      </View>
      <Modal visible={isActionSheetVisible} animationType='slide' transparent onRequestClose={() => setIsActionSheetVisible(false)}>
        <View style={styles.sheetOverlay}>
          <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setIsActionSheetVisible(false)} />
          <View style={[styles.actionSheet, { backgroundColor: background }]}>
            <View style={[styles.sheetHandle, { backgroundColor: border }]} />
            <View style={styles.sheetList}>
              {onAttachPress && (
                <ActionSheetRow
                  icon='attach'
                  title={t('chat.attachFiles', { defaultValue: 'Attach files' })}
                  onPress={() => {
                    setIsActionSheetVisible(false);
                    onAttachPress();
                  }}
                  iconColor={tint}
                  textColor={textColor}
                  secondaryColor={textSecondary}
                  borderColor={border}
                />
              )}
              {canOpenModelPicker && (
                <ActionSheetRow
                  icon='hardware-chip-outline'
                  title={t('chat.model', { defaultValue: 'Model' })}
                  subtitle={currentModelLabel}
                  onPress={() => {
                    setIsActionSheetVisible(false);
                    setIsModelPickerVisible(true);
                  }}
                  iconColor={tint}
                  textColor={textColor}
                  secondaryColor={textSecondary}
                  borderColor={border}
                />
              )}
              {canOpenModePicker && (
                <ActionSheetRow
                  icon='flash-outline'
                  title={t('chat.permissionMode', { defaultValue: 'Permission' })}
                  subtitle={currentModeLabel}
                  onPress={() => {
                    setIsActionSheetVisible(false);
                    setIsModePickerVisible(true);
                  }}
                  iconColor={tint}
                  textColor={textColor}
                  secondaryColor={textSecondary}
                  borderColor={border}
                />
              )}
            </View>
          </View>
        </View>
      </Modal>
      {canOpenModelPicker && (
        <ModelPickerSheet
          visible={isModelPickerVisible}
          models={availableModels}
          currentModelId={currentModelId}
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
          currentMode={resolvedCurrentMode}
          onSelect={(mode) => onModeSelect?.(mode)}
          onClose={() => setIsModePickerVisible(false)}
        />
      )}
    </View>
  );
}

function ActionSheetRow({
  icon,
  title,
  subtitle,
  onPress,
  iconColor,
  textColor,
  secondaryColor,
  borderColor,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress: () => void;
  iconColor: string;
  textColor: string;
  secondaryColor: string;
  borderColor: string;
}) {
  return (
    <TouchableOpacity style={[styles.sheetRow, { borderBottomColor: borderColor }]} onPress={onPress} activeOpacity={0.72}>
      <View style={styles.sheetRowIcon}>
        <Ionicons name={icon} size={20} color={iconColor} />
      </View>
      <View style={styles.sheetRowBody}>
        <ThemedText style={[styles.sheetRowTitle, { color: textColor }]}>{title}</ThemedText>
        {subtitle ? (
          <ThemedText style={[styles.sheetRowSubtitle, { color: secondaryColor }]} numberOfLines={1}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      <Ionicons name='chevron-forward' size={16} color={secondaryColor} />
    </TouchableOpacity>
  );
}

function getQueueWarningText(
  t: (key: string, options?: Record<string, unknown>) => string,
  reason: QueueWarningReason,
): string {
  const warningKeyMap: Record<QueueWarningReason, string> = {
    emptyInput: 'chat.queuedCommandEmptyInput',
    inputTooLong: 'chat.queuedCommandInputTooLong',
    tooManyFiles: 'chat.queuedCommandTooManyFiles',
    queueFull: 'chat.queuedCommandQueueFull',
    queueTooLarge: 'chat.queuedCommandQueueTooLarge',
  };
  const defaultValueMap: Record<QueueWarningReason, string> = {
    emptyInput: 'Queued commands cannot be empty.',
    inputTooLong: 'This queued command is too long. Shorten it before sending.',
    tooManyFiles: 'Too many files are attached to this queued command.',
    queueFull: 'Queue is full. Remove a command before adding more.',
    queueTooLarge: 'Queue data is too large. Remove some queued commands first.',
  };

  return t(warningKeyMap[reason], { defaultValue: defaultValueMap[reason] });
}

function uniqueFiles(files: string[]): string[] {
  return Array.from(new Set(files.filter((file) => typeof file === 'string' && file.length > 0)));
}

function getFileName(file: string): string {
  return file.split('/').filter(Boolean).pop() || file;
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
  queueStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 4,
    paddingBottom: 6,
  },
  queueStatusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  queueWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 6,
  },
  queueWarningText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
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
  attachmentScroll: {
    marginBottom: 7,
  },
  attachmentList: {
    gap: 6,
    paddingHorizontal: 2,
  },
  attachmentChip: {
    maxWidth: 168,
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingLeft: 9,
    paddingRight: 6,
    paddingVertical: 4,
  },
  attachmentText: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '600',
  },
  attachButton: {
    width: 30,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 2,
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
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.36)',
  },
  actionSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 28 : 12,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    marginBottom: 8,
  },
  sheetList: {
    paddingHorizontal: 8,
  },
  sheetRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetRowIcon: {
    width: 30,
    alignItems: 'center',
  },
  sheetRowBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  sheetRowTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  sheetRowSubtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
});
