import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useThemeColor } from '../../hooks/useThemeColor';
import { ThemedText } from '../ui/ThemedText';

export function AgentSettingsCard() {
  const { t } = useTranslation();
  const router = useRouter();
  const surface = useThemeColor({}, 'surface');
  const textSecondary = useThemeColor({}, 'textSecondary');

  return (
    <View style={styles.section}>
      <ThemedText type='caption' style={styles.sectionTitle}>
        {t('settings.agents').toUpperCase()}
      </ThemedText>
      <TouchableOpacity
        accessibilityRole='button'
        accessibilityLabel={t('settings.manageAgents')}
        testID='open-agent-management'
        style={[styles.card, { backgroundColor: surface }]}
        onPress={() => router.push('/agents')}
        activeOpacity={0.72}
      >
        <Ionicons name='terminal-outline' size={22} color={textSecondary} />
        <View style={styles.text}>
          <ThemedText>{t('settings.manageAgents')}</ThemedText>
          <ThemedText type='caption' style={{ color: textSecondary }} numberOfLines={2}>
            {t('settings.manageAgentsSummary')}
          </ThemedText>
        </View>
        <Ionicons name='chevron-forward-outline' size={18} color={textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  sectionTitle: {
    paddingHorizontal: 4,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  card: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
  },
  text: { flex: 1 },
});
