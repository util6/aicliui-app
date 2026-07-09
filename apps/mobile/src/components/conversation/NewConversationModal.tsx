import React, { useEffect, useState } from 'react';
import { View, Modal, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '../ui/ThemedText';
import { useConversations, type AgentInfo } from '../../context/ConversationContext';
import { useThemeColor } from '../../hooks/useThemeColor';
import { getAgentStateLabelKey } from '../../services/runtimeStatus';

type NewConversationModalProps = {
  visible: boolean;
  onClose: () => void;
  onAgentSelected: (agent: AgentInfo) => void;
};

const agentIcons: Record<string, string> = {
  claude: 'C',
  opencode: 'O',
  gemini: 'G',
  codex: 'X',
  qwen: 'Q',
};

export function NewConversationModal({ visible, onClose, onAgentSelected }: NewConversationModalProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { availableAgents, fetchAgents } = useConversations();
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const tint = useThemeColor({}, 'tint');
  const background = useThemeColor({}, 'background');
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const text = useThemeColor({}, 'text');
  const textSecondary = useThemeColor({}, 'textSecondary');
  const warning = useThemeColor({}, 'warning');
  const error = useThemeColor({}, 'error');

  useEffect(() => {
    if (visible) {
      setIsLoadingAgents(true);
      fetchAgents().finally(() => setIsLoadingAgents(false));
    }
  }, [visible, fetchAgents]);

  const handleSelect = (agent: AgentInfo) => {
    if (!isAgentSelectable(agent)) return;
    onAgentSelected(agent);
    onClose();
  };

  const openRuntimeSettings = () => {
    onClose();
    router.push('/(tabs)/settings');
  };

  const renderAgent = ({ item }: { item: AgentInfo }) => {
    const icon = agentIcons[item.backend] || item.backend.charAt(0).toUpperCase();
    const selectable = isAgentSelectable(item);
    const statusColor = getAgentStatusColor(item, {
      ready: tint,
      pending: warning,
      missing: error,
      fallback: textSecondary,
    });
    return (
      <TouchableOpacity
        testID={`agent-row-${item.backend}`}
        style={[styles.agentItem, { borderBottomColor: border, opacity: selectable ? 1 : 0.62 }]}
        onPress={() => handleSelect(item)}
        disabled={!selectable}
        activeOpacity={0.6}
      >
        <View style={[styles.agentIcon, { backgroundColor: tint + '20' }]}>
          <ThemedText style={[styles.agentIconText, { color: tint }]}>{icon}</ThemedText>
        </View>
        <View style={styles.agentInfo}>
          <ThemedText style={styles.agentName}>{item.label || item.name}</ThemedText>
          <ThemedText type='caption' style={{ color: item.state ? statusColor : textSecondary }} numberOfLines={2}>
            {agentStatusLabel(item, t)}
          </ThemedText>
          {!selectable && (
            <TouchableOpacity
              accessibilityRole='button'
              accessibilityLabel={t('settings.openRuntimeSettings', { defaultValue: 'Open runtime settings' })}
              testID={`agent-runtime-settings-${item.backend}`}
              style={styles.runtimeSettingsButton}
              onPress={openRuntimeSettings}
              activeOpacity={0.72}
            >
              <ThemedText style={[styles.runtimeSettingsText, { color: tint }]}>
                {t('settings.openRuntimeSettings', { defaultValue: 'Open runtime settings' })}
              </ThemedText>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType='slide' transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: background }]}>
          <View style={[styles.header, { borderBottomColor: border }]}>
            <ThemedText style={styles.title}>{t('conversations.newConversation')}</ThemedText>
            <TouchableOpacity onPress={onClose}>
              <ThemedText style={[styles.closeButton, { color: tint }]}>{t('common.close')}</ThemedText>
            </TouchableOpacity>
          </View>

          {isLoadingAgents ? (
            <View style={styles.loading}>
              <ActivityIndicator size='small' color={tint} />
            </View>
          ) : availableAgents.length === 0 ? (
            <View style={styles.loading}>
              <ThemedText type='caption'>{t('conversations.noAgents')}</ThemedText>
            </View>
          ) : (
            <FlatList
              data={availableAgents}
              renderItem={renderAgent}
              keyExtractor={(item) => `${item.backend}-${item.name}`}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

function isAgentSelectable(agent: AgentInfo): boolean {
  return agent.state !== 'missing' && agent.state !== 'error';
}

function agentStatusLabel(agent: AgentInfo, t: (key: string) => string): string {
  if (!agent.state) return agent.backend;
  const details = [agent.version, agent.detail].filter((item): item is string => Boolean(item));
  const state = t(getAgentStateLabelKey(agent.state));
  return details.length > 0 ? `${state} · ${details.join(' · ')}` : state;
}

function getAgentStatusColor(
  agent: AgentInfo,
  colors: { ready: string; pending: string; missing: string; fallback: string },
): string {
  if (agent.state === 'ready') return colors.ready;
  if (agent.state === 'installing') return colors.pending;
  if (agent.state === 'missing' || agent.state === 'error') return colors.missing;
  return colors.fallback;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  sheet: {
    maxHeight: '60%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  closeButton: {
    fontSize: 16,
  },
  loading: {
    padding: 40,
    alignItems: 'center',
  },
  agentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  agentIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  agentIconText: {
    fontSize: 18,
    fontWeight: '700',
  },
  agentInfo: {
    flex: 1,
    gap: 2,
  },
  agentName: {
    fontSize: 16,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  runtimeSettingsButton: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingVertical: 2,
  },
  runtimeSettingsText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
