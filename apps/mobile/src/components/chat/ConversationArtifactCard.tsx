import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '../ui/ThemedText';
import { useChat } from '../../context/ChatContext';
import { useThemeColor } from '../../hooks/useThemeColor';
import {
  artifactPayloadRecord,
  type ConversationArtifact,
  type ConversationArtifactStatus,
} from '../../utils/artifacts';

type ConversationArtifactCardProps = {
  artifact: ConversationArtifact;
};

export function ConversationArtifactCard({ artifact }: ConversationArtifactCardProps) {
  if (artifact.kind === 'cron_trigger') {
    return <CronTriggerArtifactCard artifact={artifact} />;
  }
  return <SkillSuggestArtifactCard artifact={artifact} />;
}

function SkillSuggestArtifactCard({ artifact }: ConversationArtifactCardProps) {
  const { t } = useTranslation();
  const { updateArtifactStatus } = useChat();
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const tint = useThemeColor({}, 'tint');
  const icon = useThemeColor({}, 'icon');
  const success = useThemeColor({}, 'success');
  const textSecondary = useThemeColor({}, 'textSecondary');
  const codeBackground = useThemeColor({}, 'codeBackground');
  const [pendingStatus, setPendingStatus] = useState<ConversationArtifactStatus | null>(null);

  const payload = artifactPayloadRecord(artifact);
  const name = stringValue(payload.name) || t('chat.skillSuggestion', { defaultValue: 'Suggested skill' });
  const description = stringValue(payload.description);
  const skillContent = stringValue(payload.skillContent) || stringValue(payload.skill_content);

  const updateStatus = async (status: ConversationArtifactStatus) => {
    if (pendingStatus) return;
    setPendingStatus(status);
    try {
      await updateArtifactStatus(artifact.id, status);
    } finally {
      setPendingStatus(null);
    }
  };

  return (
    <View style={styles.row}>
      <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
        <View style={styles.header}>
          <View style={[styles.iconBadge, { backgroundColor: codeBackground }]}>
            <Ionicons name='bulb-outline' size={17} color={tint} />
          </View>
          <View style={styles.headerText}>
            <ThemedText style={styles.title} numberOfLines={1}>
              {name}
            </ThemedText>
            {description ? (
              <ThemedText style={[styles.description, { color: textSecondary }]} numberOfLines={3}>
                {description}
              </ThemedText>
            ) : null}
          </View>
        </View>
        {skillContent ? (
          <View style={[styles.preview, { backgroundColor: codeBackground }]}>
            <ThemedText style={[styles.previewText, { color: textSecondary }]} numberOfLines={3}>
              {skillContent}
            </ThemedText>
          </View>
        ) : null}
        <View style={styles.actions}>
          <TouchableOpacity
            testID='artifact-dismiss'
            accessibilityRole='button'
            style={[styles.secondaryButton, { borderColor: border }]}
            onPress={() => void updateStatus('dismissed')}
            disabled={pendingStatus !== null}
            activeOpacity={0.75}
          >
            <Ionicons name='close' size={16} color={icon} />
            <ThemedText style={[styles.secondaryButtonText, { color: textSecondary }]}>
              {pendingStatus === 'dismissed'
                ? t('chat.updatingArtifact', { defaultValue: 'Updating' })
                : t('common.dismiss', { defaultValue: 'Dismiss' })}
            </ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            testID='artifact-save'
            accessibilityRole='button'
            style={[styles.primaryButton, { backgroundColor: success }]}
            onPress={() => void updateStatus('saved')}
            disabled={pendingStatus !== null}
            activeOpacity={0.75}
          >
            <Ionicons name='checkmark' size={16} color='#fff' />
            <ThemedText style={styles.primaryButtonText}>
              {pendingStatus === 'saved'
                ? t('chat.updatingArtifact', { defaultValue: 'Updating' })
                : t('common.save', { defaultValue: 'Save' })}
            </ThemedText>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function CronTriggerArtifactCard({ artifact }: ConversationArtifactCardProps) {
  const { t } = useTranslation();
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const tint = useThemeColor({}, 'tint');
  const icon = useThemeColor({}, 'icon');
  const textSecondary = useThemeColor({}, 'textSecondary');
  const payload = artifactPayloadRecord(artifact);
  const name =
    stringValue(payload.cron_job_name) ||
    stringValue(payload.cronJobName) ||
    t('chat.scheduledTask', { defaultValue: 'Scheduled task' });

  return (
    <View style={styles.row}>
      <View style={[styles.card, styles.cronCard, { backgroundColor: surface, borderColor: border }]}>
        <View style={styles.header}>
          <View style={[styles.iconBadge, { backgroundColor: 'transparent' }]}>
            <Ionicons name='time-outline' size={18} color={tint} />
          </View>
          <View style={styles.headerText}>
            <ThemedText style={styles.title} numberOfLines={1}>
              {name}
            </ThemedText>
            <ThemedText style={[styles.description, { color: textSecondary }]} numberOfLines={2}>
              {t('chat.scheduledTaskTriggered', { defaultValue: 'Scheduled task triggered' })}
            </ThemedText>
          </View>
          <Ionicons name='chevron-forward' size={16} color={icon} />
        </View>
      </View>
    </View>
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  cronCard: {
    paddingVertical: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBadge: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  preview: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  previewText: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: 'monospace',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  secondaryButton: {
    minHeight: 34,
    paddingHorizontal: 11,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  secondaryButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  primaryButton: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});
