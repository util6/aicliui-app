import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  const [isLoading, setIsLoading] = useState(false);
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
                value={bootstrapLabel(status.bootstrap)}
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
        <ThemedText type='caption' style={{ color: textSecondary }} numberOfLines={1}>
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
  return agent.version ? `${state} · ${agent.version}` : state;
}

function agentTone(state: RuntimeAgentHealth['state']): RuntimeTone {
  if (state === 'ready') return 'ready';
  if (state === 'missing' || state === 'error') return 'missing';
  return 'pending';
}

function bootstrapLabel(bootstrap: NonNullable<RuntimeStatus['bootstrap']>): string {
  return bootstrap.detail ? `${bootstrap.phase} · ${bootstrap.detail}` : bootstrap.phase;
}

function bootstrapTone(phase: string): RuntimeTone {
  if (phase === 'daemon_start_requested') return 'ready';
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
});
