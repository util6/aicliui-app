import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, TouchableOpacity, View } from 'react-native';
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
  getAgentLoginCommand,
  installOrStartLocalRuntime,
  openTermuxIfAvailable,
  type LocalAgentBackend,
} from '../../services/termuxRuntime';

type RuntimeTone = 'ready' | 'pending' | 'missing';
const DAEMON_LOG_PATH = '~/.aicliui/logs/aioncore.log';

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
  const [isLoading, setIsLoading] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [hasError, setHasError] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setHasError(false);
    try {
      setStatus(await getRuntimeStatus());
    } catch {
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const copyDaemonLogPath = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(DAEMON_LOG_PATH);
      Alert.alert(t('common.copied'), DAEMON_LOG_PATH);
    } catch {
      Alert.alert(t('common.error'), DAEMON_LOG_PATH);
    }
  }, [t]);

  const repairRuntime = useCallback(async () => {
    setIsRepairing(true);
    try {
      const result = await installOrStartLocalRuntime();
      if (result.status === 'native_unavailable') {
        Alert.alert(t('connect.installRuntime'), t('connect.nativeModuleUnavailable'));
        return;
      }
      if (result.status === 'termux_missing') {
        Alert.alert(t('connect.termux'), t('connect.termuxMissing'));
        await openTermuxIfAvailable();
        return;
      }
      if (result.status === 'permission_missing') {
        Alert.alert(t('connect.termux'), t('connect.runCommandPermissionMissing'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('connect.openAppSettings'),
            onPress: () => {
              void Linking.openSettings();
            },
          },
        ]);
        return;
      }
      if (result.status === 'start_failed') {
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

  const openAgentLogin = useCallback(
    async (backend: LocalAgentBackend) => {
      const command = getAgentLoginCommand(backend);
      try {
        await Clipboard.setStringAsync(command);
        const opened = await openTermuxIfAvailable();
        Alert.alert(
          t('settings.agentLoginTitle', { agent: getAgentDisplayName(backend) }),
          opened ? t('settings.agentLoginOpened') : t('settings.agentLoginOpenFailed'),
        );
      } catch {
        Alert.alert(t('common.error'), t('settings.agentLoginOpenFailed'));
      }
    },
    [t],
  );

  const showRepairAction = shouldOfferRuntimeRepair(status, hasError);

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
        {hasError && !status ? (
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
            <RuntimeRow
              icon='hardware-chip-outline'
              label={t('connect.runCommandPermission')}
              value={termuxRunCommandLabel(status, t)}
              tone={termuxRunCommandTone(status.termux.runCommandPermission)}
            />
            <RuntimeRow
              icon='phone-portrait-outline'
              label={t('settings.termuxExternalApps')}
              value={termuxExternalAppsLabel(status, t)}
              tone={termuxExternalAppsTone(status.termux.allowExternalApps)}
            />
            {status.bootstrap && (
              <RuntimeRow
                icon='pulse-outline'
                label={t('connect.bootstrap')}
                value={bootstrapLabel(status.bootstrap, t)}
                tone={bootstrapTone(status.bootstrap.phase)}
              />
            )}
            {status.agents.map((agent) => {
              const row = (
                <RuntimeRow
                  icon={agent.backend === 'opencode' ? 'code-slash-outline' : 'sparkles-outline'}
                  label={getAgentDisplayName(agent.backend)}
                  value={agentLabel(agent, t)}
                  tone={agentTone(agent.state)}
                />
              );
              if (!isLocalAgentBackend(agent.backend)) {
                return <React.Fragment key={agent.backend}>{row}</React.Fragment>;
              }

              const backend = agent.backend;
              return (
                <TouchableOpacity
                  key={backend}
                  accessibilityRole='button'
                  accessibilityLabel={t('settings.configureAgentLogin', {
                    agent: getAgentDisplayName(backend),
                  })}
                  testID={`configure-agent-${backend}`}
                  style={styles.agentAction}
                  onPress={() => openAgentLogin(backend)}
                  activeOpacity={0.72}
                >
                  <View style={styles.agentActionContent}>{row}</View>
                  <Ionicons name='chevron-forward-outline' size={18} color={textSecondary} />
                </TouchableOpacity>
              );
            })}
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
                <ThemedText style={[styles.rowLabel, { color: tint }]}>{t('settings.copyDaemonLogPath')}</ThemedText>
                <ThemedText type='caption' style={{ color: textSecondary }} numberOfLines={1}>
                  {DAEMON_LOG_PATH}
                </ThemedText>
              </View>
            </TouchableOpacity>
          </>
        ) : (
          <View style={[styles.row, { borderBottomColor: border }]}>
            <ActivityIndicator size='small' color={tint} style={styles.rowIcon} />
            <View style={styles.rowText}>
              <ThemedText style={styles.rowLabel}>{t('common.loading')}</ThemedText>
              <ThemedText type='caption' style={{ color: textSecondary }}>
                {t('settings.runtime')}
              </ThemedText>
            </View>
          </View>
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
          <ThemedText style={[styles.repairButtonText, { color: tint }]}>{t('settings.repairRuntime')}</ThemedText>
        </TouchableOpacity>
      )}
    </View>
  );
}

function shouldOfferRuntimeRepair(status: RuntimeStatus | null, hasError: boolean): boolean {
  if (hasError) return true;
  if (!status) return false;
  if (status.termux.runCommandPermission === 'denied' || status.termux.allowExternalApps === 'disabled') return true;
  if (status.bootstrap && (status.bootstrap.phase.endsWith('_failed') || status.bootstrap.phase === 'error')) return true;
  return status.agents.some((agent) => agent.state === 'missing' || agent.state === 'error');
}

function isLocalAgentBackend(backend: string): backend is LocalAgentBackend {
  return backend === 'opencode' || backend === 'gemini' || backend === 'codex';
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

function termuxRunCommandLabel(status: RuntimeStatus, t: (key: string) => string): string {
  if (status.termux.runCommandPermission === 'granted') return t('connect.statusReady');
  if (status.termux.runCommandPermission === 'denied') return t('connect.statusMissing');
  return t('connect.statusUnknown');
}

function termuxRunCommandTone(state: RuntimeStatus['termux']['runCommandPermission']): RuntimeTone {
  if (state === 'granted') return 'ready';
  if (state === 'denied') return 'missing';
  return 'pending';
}

function termuxExternalAppsLabel(status: RuntimeStatus, t: (key: string) => string): string {
  if (status.termux.allowExternalApps === 'enabled') return t('connect.statusReady');
  if (status.termux.allowExternalApps === 'disabled') return t('connect.statusMissing');
  return t('connect.statusUnknown');
}

function termuxExternalAppsTone(state: RuntimeStatus['termux']['allowExternalApps']): RuntimeTone {
  if (state === 'enabled') return 'ready';
  if (state === 'disabled') return 'missing';
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
  agentAction: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 12,
  },
  agentActionContent: {
    flex: 1,
    minWidth: 0,
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
