import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { View, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet, Alert, TextInput, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '../ui/ThemedText';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useConversations } from '../../context/ConversationContext';
import { useFilesTab } from '../../context/FilesTabContext';
import { useWorkspaceAttachments } from '../../context/WorkspaceAttachmentContext';
import { useThemeColor } from '../../hooks/useThemeColor';
import { bridge } from '../../services/bridge';

type IDirOrFile = {
  name: string;
  fullPath: string;
  relativePath: string;
  isDir: boolean;
  isFile: boolean;
  children?: IDirOrFile[];
};

type FlatItem = {
  name: string;
  fullPath: string;
  relativePath: string;
  isDir: boolean;
  isFile: boolean;
  depth: number;
  isExpanded?: boolean;
};

type WorkspaceFilesSidebarProps = {
  navigation: { closeDrawer(): void; openDrawer(): void };
};

export function WorkspaceFilesSidebar({ navigation }: WorkspaceFilesSidebarProps) {
  const { t } = useTranslation();
  const { currentWorkspace, workspaceDisplayName, workspaceChanged } = useWorkspace();
  const { activeConversationId } = useConversations();
  const { openTab } = useFilesTab();
  const { addPendingFiles } = useWorkspaceAttachments();
  const background = useThemeColor({}, 'background');
  const border = useThemeColor({}, 'border');
  const tint = useThemeColor({}, 'tint');
  const iconColor = useThemeColor({}, 'icon');

  const [tree, setTree] = useState<IDirOrFile[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FlatItem | null>(null);
  const [renameText, setRenameText] = useState('');
  const [searchText, setSearchText] = useState('');
  const [actionTarget, setActionTarget] = useState<FlatItem | null>(null);

  const fetchFiles = useCallback(async (searchValue: string) => {
    if (!activeConversationId || !currentWorkspace) return;
    setLoading(true);
    try {
      const res = await bridge.request<IDirOrFile[]>('conversation.get-workspace', {
        conversation_id: activeConversationId,
        workspace: currentWorkspace,
        path: currentWorkspace,
        search: searchValue.trim(),
      });
      if (Array.isArray(res)) {
        setTree(res);
      }
    } catch {
      Alert.alert(t('common.error'), t('workspace.errorLoading'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId, currentWorkspace]);

  // Load files when workspace or active conversation changes
  useEffect(() => {
    if (currentWorkspace && activeConversationId) {
      setExpanded(new Set());
      const timer = setTimeout(() => {
        void fetchFiles(searchText);
      }, searchText.trim() ? 200 : 0);
      return () => clearTimeout(timer);
    } else {
      setTree([]);
    }
  }, [currentWorkspace, activeConversationId, fetchFiles, searchText]);

  // Reset expansion when workspace changes to different project
  useEffect(() => {
    if (workspaceChanged) {
      setExpanded(new Set());
      setSearchText('');
    }
  }, [workspaceChanged]);

  const toggleExpand = useCallback((entry: { fullPath: string }) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(entry.fullPath)) {
        next.delete(entry.fullPath);
      } else {
        next.add(entry.fullPath);
      }
      return next;
    });
  }, []);

  // Flatten the nested tree for FlatList rendering
  const flatData = useMemo(() => {
    if (!tree.length) return [];
    const rootChildren = tree[0]?.children ?? [];

    const sortNodes = (nodes: IDirOrFile[]): IDirOrFile[] =>
      [...nodes].sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    const flatten = (nodes: IDirOrFile[], depth: number): FlatItem[] => {
      const result: FlatItem[] = [];
      const hasActiveSearch = searchText.trim().length > 0;
      for (const node of sortNodes(nodes)) {
        const isExpanded = node.isDir && (expanded.has(node.fullPath) || (hasActiveSearch && Boolean(node.children?.length)));
        result.push({
          name: node.name,
          fullPath: node.fullPath,
          relativePath: node.relativePath,
          isDir: node.isDir,
          isFile: node.isFile,
          depth,
          isExpanded,
        });
        if (isExpanded && node.children) {
          result.push(...flatten(node.children, depth + 1));
        }
      }
      return result;
    };

    return flatten(rootChildren, 0);
  }, [tree, expanded, searchText]);

  const handleFileSelect = useCallback(
    (fullPath: string) => {
      openTab(fullPath);
      navigation.closeDrawer();
    },
    [navigation, openTab],
  );
  const closeActionSheet = useCallback(() => {
    setActionTarget(null);
  }, []);
  const handleOpenEntry = useCallback(
    (item: FlatItem) => {
      closeActionSheet();
      if (item.isDir) {
        toggleExpand(item);
        return;
      }
      handleFileSelect(item.fullPath);
    },
    [closeActionSheet, handleFileSelect, toggleExpand],
  );
  const handleAddToChat = useCallback(
    (item: FlatItem) => {
      if (!activeConversationId) return;
      closeActionSheet();
      addPendingFiles(activeConversationId, [item.fullPath]);
      Alert.alert(
        t('files.addedToChat', { defaultValue: 'Added to chat' }),
        item.relativePath || item.name,
      );
    },
    [activeConversationId, addPendingFiles, closeActionSheet, t],
  );
  const handleCopyPath = useCallback(
    async (item: FlatItem) => {
      closeActionSheet();
      try {
        await Clipboard.setStringAsync(item.fullPath);
        Alert.alert(t('common.copied', { defaultValue: 'Copied' }), item.relativePath || item.name);
      } catch {
        Alert.alert(t('common.error'), t('files.copyPathFailed', { defaultValue: 'Failed to copy path' }));
      }
    },
    [closeActionSheet, t],
  );
  const handleDeleteEntry = useCallback(
    (item: FlatItem) => {
      if (!currentWorkspace) return;
      closeActionSheet();
      Alert.alert(
        item.isDir
          ? t('files.deleteFolderTitle', { defaultValue: 'Delete folder?' })
          : t('files.deleteFileTitle', { defaultValue: 'Delete file?' }),
        item.relativePath || item.name,
        [
          { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
          {
            text: t('common.delete', { defaultValue: 'Delete' }),
            style: 'destructive',
            onPress: () => {
              bridge
                .request('workspace.removeEntry', {
                  workspace: currentWorkspace,
                  path: item.fullPath,
                })
                .then(() => fetchFiles(searchText))
                .catch(() => Alert.alert(t('common.error'), t('files.deleteFailed', { defaultValue: 'Failed to delete' })));
            },
          },
        ],
      );
    },
    [closeActionSheet, currentWorkspace, fetchFiles, searchText, t],
  );
  const handleStartRename = useCallback((item: FlatItem) => {
    closeActionSheet();
    setRenameTarget(item);
    setRenameText(item.name);
  }, [closeActionSheet]);
  const handleCancelRename = useCallback(() => {
    setRenameTarget(null);
    setRenameText('');
  }, []);
  const handleRefresh = useCallback(() => {
    void fetchFiles(searchText);
  }, [fetchFiles, searchText]);
  const handleSubmitRename = useCallback(async () => {
    if (!currentWorkspace || !renameTarget) return;
    const nextName = renameText.trim();
    if (!nextName) {
      Alert.alert(t('common.error'), t('files.renameEmpty', { defaultValue: 'Enter a new name' }));
      return;
    }
    if (nextName === renameTarget.name) {
      handleCancelRename();
      return;
    }
    try {
      await bridge.request('workspace.renameEntry', {
        workspace: currentWorkspace,
        path: renameTarget.fullPath,
        new_name: nextName,
      });
      handleCancelRename();
      await fetchFiles(searchText);
    } catch {
      Alert.alert(t('common.error'), t('files.renameFailed', { defaultValue: 'Failed to rename' }));
    }
  }, [currentWorkspace, fetchFiles, handleCancelRename, renameTarget, renameText, searchText, t]);

  // No workspace state
  if (!currentWorkspace) {
    return (
      <View style={[styles.container, styles.emptyContainer, { backgroundColor: background }]}>
        <Ionicons name='folder-open-outline' size={48} color={iconColor} style={{ opacity: 0.4 }} />
        <ThemedText style={styles.emptyText}>{t('workspace.noWorkspace')}</ThemedText>
      </View>
    );
  }

  const renderItem = ({ item }: { item: FlatItem }) => {
    const isRenaming = renameTarget?.fullPath === item.fullPath;
    return (
      <View>
        <View style={[styles.item, { paddingLeft: 16 + 16 * item.depth }]}>
          <TouchableOpacity
            style={styles.itemMain}
            onPress={() => (item.isDir ? toggleExpand(item) : handleFileSelect(item.fullPath))}
            activeOpacity={0.6}
          >
            {item.isDir && (
              <Ionicons
                name={item.isExpanded ? 'chevron-down' : 'chevron-forward'}
                size={14}
                color={iconColor}
                style={styles.chevron}
              />
            )}
            <Ionicons
              name={item.isDir ? (item.isExpanded ? 'folder-open' : 'folder') : 'document-outline'}
              size={18}
              color={item.isDir ? tint : iconColor}
              style={styles.icon}
            />
            <ThemedText style={styles.itemName} numberOfLines={1}>
              {item.name}
            </ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole='button'
            accessibilityLabel={t('files.openActionsForEntry', {
              file: item.name,
              defaultValue: `Open actions for ${item.name}`,
            })}
            testID={`workspace-entry-actions-${item.relativePath}`}
            style={styles.actionButton}
            onPress={() => setActionTarget(item)}
            activeOpacity={0.72}
            hitSlop={6}
          >
            <Ionicons name='ellipsis-horizontal' size={20} color={iconColor} />
          </TouchableOpacity>
        </View>
        {isRenaming && (
          <View style={[styles.renameRow, { paddingLeft: 16 + 16 * item.depth }]}>
            <TextInput
              value={renameText}
              onChangeText={setRenameText}
              autoFocus
              selectTextOnFocus
              testID={`rename-workspace-entry-input-${item.relativePath}`}
              placeholder={t('files.renamePlaceholder', { defaultValue: 'New name' })}
              placeholderTextColor={iconColor}
              style={[styles.renameInput, { borderColor: border, color: iconColor }]}
              onSubmitEditing={handleSubmitRename}
            />
            <TouchableOpacity
              accessibilityRole='button'
              accessibilityLabel={t('common.save', { defaultValue: 'Save' })}
              testID={`save-workspace-entry-rename-${item.relativePath}`}
              style={styles.actionButton}
              onPress={handleSubmitRename}
              activeOpacity={0.72}
            >
              <Ionicons name='checkmark' size={21} color={tint} />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole='button'
              accessibilityLabel={t('common.cancel', { defaultValue: 'Cancel' })}
              testID={`cancel-workspace-entry-rename-${item.relativePath}`}
              style={styles.actionButton}
              onPress={handleCancelRename}
              activeOpacity={0.72}
            >
              <Ionicons name='close' size={21} color={iconColor} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: background }]}>
      <View style={[styles.header, { borderBottomColor: border }]}>
        <Ionicons name='folder-outline' size={18} color={tint} />
        <ThemedText style={styles.headerTitle} numberOfLines={1}>
          {workspaceDisplayName}
        </ThemedText>
        <TouchableOpacity onPress={() => navigation.closeDrawer()}>
          <Ionicons name='close' size={22} color={iconColor} />
        </TouchableOpacity>
      </View>
      <View style={[styles.searchRow, { borderBottomColor: border }]}>
        <Ionicons name='search-outline' size={16} color={iconColor} />
        <TextInput
          value={searchText}
          onChangeText={setSearchText}
          testID='workspace-file-search-input'
          placeholder={t('files.searchPlaceholder', { defaultValue: 'Search files' })}
          placeholderTextColor={iconColor}
          autoCapitalize='none'
          autoCorrect={false}
          style={[styles.searchInput, { color: iconColor }]}
        />
        {searchText.length > 0 && (
          <TouchableOpacity
            accessibilityRole='button'
            accessibilityLabel={t('files.clearSearch', { defaultValue: 'Clear search' })}
            testID='workspace-file-search-clear'
            style={styles.clearSearchButton}
            onPress={() => setSearchText('')}
            activeOpacity={0.72}
          >
            <Ionicons name='close-circle' size={18} color={iconColor} />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          accessibilityRole='button'
          accessibilityLabel={t('files.refresh', { defaultValue: 'Refresh files' })}
          testID='refresh-workspace-files'
          style={styles.refreshButton}
          onPress={handleRefresh}
          disabled={loading}
          activeOpacity={0.72}
        >
          <Ionicons name='refresh-outline' size={19} color={iconColor} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size='small' color={tint} style={styles.loader} />
      ) : (
        <FlatList
          data={flatData}
          renderItem={renderItem}
          keyExtractor={(item) => item.fullPath}
          initialNumToRender={20}
          maxToRenderPerBatch={10}
          windowSize={5}
          ListEmptyComponent={
            <View style={styles.emptyList}>
              <ThemedText type='caption'>{t('files.empty')}</ThemedText>
            </View>
          }
        />
      )}
      <Modal visible={Boolean(actionTarget)} animationType='slide' transparent onRequestClose={closeActionSheet}>
        <View style={styles.sheetOverlay} testID='workspace-entry-actions-sheet'>
          <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={closeActionSheet} />
          {actionTarget && (
            <View style={[styles.actionSheet, { backgroundColor: background }]}>
              <View style={[styles.sheetHandle, { backgroundColor: border }]} />
              <View style={styles.sheetHeader}>
                <Ionicons
                  name={actionTarget.isDir ? 'folder-outline' : 'document-outline'}
                  size={18}
                  color={actionTarget.isDir ? tint : iconColor}
                />
                <View style={styles.sheetTitleText}>
                  <ThemedText style={styles.sheetTitle} numberOfLines={1}>
                    {actionTarget.name}
                  </ThemedText>
                  <ThemedText type='caption' numberOfLines={1}>
                    {actionTarget.relativePath || actionTarget.fullPath}
                  </ThemedText>
                </View>
              </View>
              <ActionSheetRow
                icon={actionTarget.isDir ? 'folder-open-outline' : 'eye-outline'}
                title={actionTarget.isDir ? t('files.openFolder', { defaultValue: 'Open folder' }) : t('files.preview', { defaultValue: 'Preview' })}
                testID={`workspace-entry-action-open-${actionTarget.relativePath}`}
                onPress={() => handleOpenEntry(actionTarget)}
                iconColor={tint}
              />
              <ActionSheetRow
                icon='add-circle-outline'
                title={t('files.addToChatShort', { defaultValue: 'Add to chat' })}
                testID={`workspace-entry-action-add-${actionTarget.relativePath}`}
                onPress={() => handleAddToChat(actionTarget)}
                iconColor={tint}
              />
              <ActionSheetRow
                icon='create-outline'
                title={t('files.rename', { defaultValue: 'Rename' })}
                testID={`workspace-entry-action-rename-${actionTarget.relativePath}`}
                onPress={() => handleStartRename(actionTarget)}
                iconColor={iconColor}
              />
              <ActionSheetRow
                icon='copy-outline'
                title={t('files.copyPath', { defaultValue: 'Copy Path' })}
                testID={`workspace-entry-action-copy-${actionTarget.relativePath}`}
                onPress={() => void handleCopyPath(actionTarget)}
                iconColor={iconColor}
              />
              <ActionSheetRow
                icon='trash-outline'
                title={t('common.delete', { defaultValue: 'Delete' })}
                testID={`workspace-entry-action-delete-${actionTarget.relativePath}`}
                onPress={() => handleDeleteEntry(actionTarget)}
                iconColor={iconColor}
                destructive
              />
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

type ActionSheetRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  testID: string;
  onPress: () => void;
  iconColor: string;
  destructive?: boolean;
};

function ActionSheetRow({ icon, title, testID, onPress, iconColor, destructive }: ActionSheetRowProps) {
  const error = useThemeColor({}, 'error');
  const textColor = destructive ? error : iconColor;
  return (
    <TouchableOpacity
      accessibilityRole='button'
      accessibilityLabel={title}
      testID={testID}
      style={styles.sheetActionRow}
      onPress={onPress}
      activeOpacity={0.72}
    >
      <Ionicons name={icon} size={20} color={textColor} style={styles.sheetActionIcon} />
      <ThemedText style={[styles.sheetActionText, { color: textColor }]}>{title}</ThemedText>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  loader: {
    marginTop: 40,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    minHeight: 34,
    fontSize: 14,
    paddingVertical: 0,
  },
  clearSearchButton: {
    minWidth: 30,
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshButton: {
    minWidth: 30,
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingRight: 16,
  },
  itemMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chevron: {
    marginRight: 4,
    width: 14,
  },
  icon: {
    marginRight: 8,
  },
  itemName: {
    fontSize: 14,
    flex: 1,
  },
  actionButton: {
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  renameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 16,
    paddingBottom: 8,
    gap: 6,
  },
  renameInput: {
    flex: 1,
    minHeight: 36,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingHorizontal: 10,
    fontSize: 14,
  },
  emptyContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    padding: 32,
  },
  emptyText: {
    textAlign: 'center',
    opacity: 0.6,
  },
  emptyList: {
    padding: 40,
    alignItems: 'center',
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.32)',
  },
  actionSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    marginBottom: 14,
    opacity: 0.8,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 10,
  },
  sheetTitleText: {
    flex: 1,
    minWidth: 0,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  sheetActionRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sheetActionIcon: {
    width: 22,
  },
  sheetActionText: {
    fontSize: 15,
    fontWeight: '500',
  },
});
