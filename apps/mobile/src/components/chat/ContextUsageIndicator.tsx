import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '../ui/ThemedText';
import { useThemeColor } from '../../hooks/useThemeColor';

export type ContextUsage = { used: number; size: number } | null;

type ContextUsageIndicatorProps = {
  usage: ContextUsage;
};

export function ContextUsageIndicator({ usage }: ContextUsageIndicatorProps) {
  const { t } = useTranslation();
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const tint = useThemeColor({}, 'tint');
  const warning = useThemeColor({}, 'warning');
  const error = useThemeColor({}, 'error');
  const textSecondary = useThemeColor({}, 'textSecondary');

  if (!usage || usage.size <= 0) return null;

  const percentage = Math.min(100, Math.max(0, (usage.used / usage.size) * 100));
  const isDanger = percentage > 90;
  const isWarning = percentage > 70;
  const activeColor = isDanger ? error : isWarning ? warning : tint;
  const status = isDanger ? t('chat.contextUsageHigh', { defaultValue: 'High' }) : undefined;

  return (
    <View style={[styles.container, { backgroundColor: surface, borderColor: border }]}>
      <View style={styles.header}>
        <Ionicons name='analytics-outline' size={15} color={activeColor} />
        <ThemedText style={styles.percent}>{percentage.toFixed(1)}%</ThemedText>
        <ThemedText style={[styles.detail, { color: textSecondary }]} numberOfLines={1}>
          {formatTokenCount(usage.used)} / {formatTokenCount(usage.size, true)}{' '}
          {t('chat.contextUsed', { defaultValue: 'context used' })}
        </ThemedText>
        {status && <ThemedText style={[styles.status, { color: activeColor }]}>{status}</ThemedText>}
      </View>
      <View style={[styles.track, { backgroundColor: border }]}>
        <View style={[styles.fill, { width: `${percentage}%`, backgroundColor: activeColor }]} />
      </View>
    </View>
  );
}

export function formatTokenCount(count: number, hideZeroDecimals = false): string {
  if (count >= 1_000_000) {
    const value = count / 1_000_000;
    const formatted = value.toFixed(1);
    return hideZeroDecimals && formatted.endsWith('.0') ? `${Math.floor(value)}M` : `${formatted}M`;
  }
  if (count >= 1_000) {
    const value = count / 1_000;
    const formatted = value.toFixed(1);
    return hideZeroDecimals && formatted.endsWith('.0') ? `${Math.floor(value)}K` : `${formatted}K`;
  }
  return Math.max(0, count).toString();
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 7,
    paddingBottom: 6,
    gap: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 18,
  },
  percent: {
    fontSize: 13,
    fontWeight: '600',
  },
  detail: {
    flex: 1,
    fontSize: 12,
  },
  status: {
    fontSize: 12,
    fontWeight: '600',
  },
  track: {
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
});
