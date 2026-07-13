import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '../ui/ThemedText';
import { useThemeColor } from '../../hooks/useThemeColor';
import {
  getAgentDisplayName,
  getAgentStateLabelKey,
  getRuntimeStatus,
  type RuntimeAgentHealth,
  type RuntimeStatus,
} from '../../services/runtimeStatus';
import {
  getEmbeddedRuntimeLogPath,
  prepareEmbeddedRuntime,
  probeEmbeddedRuntime,
  startEmbeddedRuntime,
  type EmbeddedRuntimeStatus,
} from '../../services/embeddedRuntime';

type RuntimeTone = 'ready' | 'pending' | 'missing';

type RuntimeRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  tone: RuntimeTone;
};

export function RuntimeStatusCard() {
  const { t } = useTranslation();
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const tint = useThemeColor({}, 'tint');
  const error = useThemeColor({}, 'error');
  const textSecondary = useThemeColor({}, 'textSecondary');
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [embeddedStatus, setEmbeddedStatus] = useState<EmbeddedRuntimeStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [hasDaemonError, setHasDaemonError] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setHasDaemonError(false);
    setEmbeddedStatus(await probeEmbeddedRuntime());
    try {
      setStatus(await getRuntimeStatus());
    } catch {
      setStatus(null);
      setHasDaemonError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const copyDaemonLogPath = useCallback(async () => {
    try {
      const logPath = await getEmbeddedRuntimeLogPath();
      await Clipboard.setStringAsync(logPath);
      Alert.alert(t('common.copied'), logPath);
    } catch {
      Alert.alert(t('common.error'), t('settings.runtimeLogUnavailable'));
    }
  }, [t]);

  const repairRuntime = useCallback(async () => {
    setIsRepairing(true);
    try {
      const prepared = await prepareEmbeddedRuntime();
      setEmbeddedStatus(prepared);
      if (!prepared.supported || prepared.state === 'unavailable') {
        Alert.alert(t('connect.installRuntime'), t('connect.embeddedRuntimeUnavailable'));
        return;
      }
      if (prepared.state === 'error') {
        Alert.alert(t('common.error'), t('connect.runtimeStartFailed'));
        return;
      }

      const started = await startEmbeddedRuntime();
      setEmbeddedStatus(started);
      if (!started.supported || started.state === 'unavailable') {
        Alert.alert(t('connect.installRuntime'), t('connect.embeddedRuntimeUnavailable'));
        return;
      }
      if (started.state === 'error') {
        Alert.alert(t('common.error'), t('connect.runtimeStartFailed'));
        return;
      }
      Alert.alert(t('connect.installRuntime'), t('connect.runtimeStartRequested'));
    } catch {
      Alert.alert(t('common.error'), t('connect.runtimeStartFailed'));
    } finally {
      setIsRepairing(false);
    }
  }, [t]);

  const showRepairAction = shouldOfferRuntimeRepair(embeddedStatus, status, hasDaemonError);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <ThemedText type='caption' style={styles.sectionTitle}>
          {t('settings.runtime').toUpperCase()}
        </ThemedText>
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={refresh}
          activeOpacity={0.75}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size='small' color={tint} />
          ) : (
            <Ionicons name='sync-outline' size={16} color={tint} />
          )}
          <ThemedText type='caption' style={{ color: tint }}>
            {t('settings.refreshRuntime')}
          </ThemedText>
        </TouchableOpacity>
      </View>

      <View style={[styles.card, { backgroundColor: surface }]}>
        {embeddedStatus ? (
          <RuntimeRow
            icon='hardware-chip-outline'
            label={t('connect.embeddedRuntime')}
            value={embeddedRuntimeLabel(embeddedStatus, t)}
            tone={embeddedRuntimeTone(embeddedStatus)}
          />
        ) : (
          <LoadingRow label={t('connect.embeddedRuntime')} tint={tint} textSecondary={textSecondary} />
        )}

        {hasDaemonError ? (
          <View style={[styles.row, { borderBottomColor: border }]}>
            <Ionicons name='alert-circle-outline' size={20} color={error} style={styles.rowIcon} />
            <View style={styles.rowText}>
              <ThemedText style={styles.rowLabel}>{t('settings.runtimeUnavailable')}</ThemedText>
              <ThemedText type='caption' style={{ color: textSecondary }}>
                {t('common.retry')}
              </ThemedText>
            </View>
          </View>
        ) : status ? (
          <>
            <RuntimeRow
              icon='server-outline'
              label={t('connect.daemon')}
              value={daemonLabel(status)}
              tone='ready'
            />
            {status.bootstrap && (
              <RuntimeRow
                icon='pulse-outline'
                label={t('connect.bootstrap')}
                value={bootstrapLabel(status.bootstrap, t)}
                tone={bootstrapTone(status.bootstrap.phase)}
              />
            )}
            {status.agents.map((agent) => (
              <RuntimeRow
                key={agent.backend}
                icon={agent.backend === 'opencode' ? 'code-slash-outline' : 'sparkles-outline'}
                label={getAgentDisplayName(agent.backend)}
                value={agentLabel(agent, t)}
                tone={agentTone(agent.state)}
              />
            ))}
            <TouchableOpacity
              accessibilityRole='button'
              accessibilityLabel={t('settings.copyDaemonLogPath')}
              testID='copy-daemon-log-path'
              style={styles.diagnosticAction}
              onPress={copyDaemonLogPath}
              activeOpacity={0.72}
            >
              <Ionicons name='copy-outline' size={18} color={tint} style={styles.rowIcon} />
              <View style={styles.rowText}>
                <ThemedText style={[styles.rowLabel, { color: tint }]}>
                  {t('settings.copyDaemonLogPath')}
                </ThemedText>
                <ThemedText type='caption' style={{ color: textSecondary }} numberOfLines={1}>
                  {t('settings.appPrivateRuntimeLog')}
                </ThemedText>
              </View>
            </TouchableOpacity>
          </>
        ) : (
          <LoadingRow label={t('connect.daemon')} tint={tint} textSecondary={textSecondary} />
        )}
      </View>

      {showRepairAction && (
        <TouchableOpacity
          accessibilityRole='button'
          accessibilityLabel={t('settings.repairRuntime')}
          testID='repair-local-runtime'
          style={[styles.repairButton, { backgroundColor: surface, borderColor: border }]}
          onPress={repairRuntime}
          activeOpacity={0.75}
          disabled={isRepairing}
        >
          {isRepairing ? (
            <ActivityIndicator size='small' color={tint} />
          ) : (
            <Ionicons name='construct-outline' size={18} color={tint} />
          )}
          <ThemedText style={[styles.repairButtonText, { color: tint }]}>
            {t('settings.repairRuntime')}
          </ThemedText>
        </TouchableOpacity>
      )}
    </View>
  );
}

function shouldOfferRuntimeRepair(
  embeddedStatus: EmbeddedRuntimeStatus | null,
  status: RuntimeStatus | null,
  hasDaemonError: boolean,
): boolean {
  if (hasDaemonError) return true;
  if (embeddedStatus && embeddedStatus.state !== 'running' && embeddedStatus.state !== 'starting') return true;
  if (status?.bootstrap && (status.bootstrap.phase.endsWith('_failed') || status.bootstrap.phase === 'error')) {
    return true;
  }
  return status?.agents.some((agent) => agent.state === 'missing' || agent.state === 'error') ?? false;
}

function LoadingRow({
  label,
  tint,
  textSecondary,
}: {
  label: string;
  tint: string;
  textSecondary: string;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <ActivityIndicator size='small' color={tint} style={styles.rowIcon} />
      <View style={styles.rowText}>
        <ThemedText style={styles.rowLabel}>{t('common.loading')}</ThemedText>
        <ThemedText type='caption' style={{ color: textSecondary }}>
          {label}
        </ThemedText>
      </View>
    </View>
  );
}

function RuntimeRow({ icon, label, value, tone }: RuntimeRowProps) {
  const tint = useThemeColor({}, 'tint');
  const warning = useThemeColor({}, 'warning');
  const iconColor = useThemeColor({}, 'icon');
  const textSecondary = useThemeColor({}, 'textSecondary');
  const color = tone === 'ready' ? tint : tone === 'pending' ? warning : iconColor;

  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={20} color={color} style={styles.rowIcon} />
      <View style={styles.rowText}>
        <ThemedText style={styles.rowLabel}>{label}</ThemedText>
        <ThemedText type='caption' style={{ color: textSecondary }} numberOfLines={2}>
          {value}
        </ThemedText>
      </View>
    </View>
  );
}

function embeddedRuntimeLabel(
  status: EmbeddedRuntimeStatus,
  t: (key: string) => string,
): string {
  const state = t(`connect.runtimeState${capitalize(status.state)}`);
  const details = [status.version, status.pid ? `pid ${status.pid}` : null, status.detail].filter(
    (item): item is string => Boolean(item),
  );
  return details.length > 0 ? `${state} · ${details.join(' · ')}` : state;
}

function embeddedRuntimeTone(status: EmbeddedRuntimeStatus): RuntimeTone {
  if (status.state === 'running') return 'ready';
  if (status.state === 'preparing' || status.state === 'starting' || status.state === 'stopped') return 'pending';
  return 'missing';
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function daemonLabel(status: RuntimeStatus): string {
  return status.daemon.pid ? `${status.daemon.version} · pid ${status.daemon.pid}` : status.daemon.version;
}

function agentLabel(agent: RuntimeAgentHealth, t: (key: string) => string): string {
  const state = t(getAgentStateLabelKey(agent.state));
  const details = [agent.version, agent.detail].filter((item): item is string => Boolean(item));
  return details.length > 0 ? `${state} · ${details.join(' · ')}` : state;
}

function agentTone(state: RuntimeAgentHealth['state']): RuntimeTone {
  if (state === 'ready') return 'ready';
  if (state === 'missing' || state === 'error') return 'missing';
  return 'pending';
}

function bootstrapLabel(
  bootstrap: NonNullable<RuntimeStatus['bootstrap']>,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const details = [bootstrap.detail, formatUpdatedAt(bootstrap.updatedAt, t)].filter(
    (item): item is string => Boolean(item),
  );
  return details.length > 0 ? `${bootstrap.phase} · ${details.join(' · ')}` : bootstrap.phase;
}

function bootstrapTone(phase: string): RuntimeTone {
  if (phase === 'daemon_start_requested' || phase === 'aioncore_start_requested') return 'ready';
  if (phase.endsWith('_failed') || phase === 'error') return 'missing';
  return 'pending';
}

function formatUpdatedAt(
  updatedAt: number | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  if (!updatedAt) return null;
  const elapsedMs = Math.max(0, Date.now() - updatedAt);
  const elapsedMinutes = Math.floor(elapsedMs / 60000);
  if (elapsedMinutes < 1) return t('settings.updatedJustNow', { defaultValue: 'Updated just now' });
  if (elapsedMinutes < 60) {
    return t('settings.updatedMinutesAgo', { count: elapsedMinutes, defaultValue: `Updated ${elapsedMinutes}m ago` });
  }
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return t('settings.updatedHoursAgo', { count: elapsedHours, defaultValue: `Updated ${elapsedHours}h ago` });
  }
  const elapsedDays = Math.floor(elapsedHours / 24);
  return t('settings.updatedDaysAgo', { count: elapsedDays, defaultValue: `Updated ${elapsedDays}d ago` });
}

const styles = StyleSheet.create({
  section: {
    gap: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: {
    paddingHorizontal: 4,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  card: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  rowIcon: {
    width: 22,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  diagnosticAction: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  repairButton: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 14,
  },
  repairButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
