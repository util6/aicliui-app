import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '../src/components/ui/ThemedText';
import { useConnection } from '../src/context/ConnectionContext';
import { useThemeColor } from '../src/hooks/useThemeColor';
import {
  getAgentDisplayName,
  getAgentStateLabelKey,
  getRuntimeStatus,
  type RuntimeAgentHealth,
  type RuntimeStatus,
} from '../src/services/runtimeStatus';
import { wsService } from '../src/services/websocket';
import { getOrCreateLocalDaemonConfig, LOCAL_DAEMON_PORT } from '../src/services/localRuntime';
import {
  prepareEmbeddedRuntime,
  probeEmbeddedRuntime,
  startEmbeddedRuntime,
  type EmbeddedRuntimeStatus,
} from '../src/services/embeddedRuntime';

type RuntimeRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  tone: 'ready' | 'pending' | 'missing';
};

const BOOTSTRAP_CONNECTION_TIMEOUT_MS = 10 * 60 * 1000;

export default function ConnectScreen() {
  const { t } = useTranslation();
  const { connect, connectionState } = useConnection();
  const router = useRouter();
  const tint = useThemeColor({}, 'tint');
  const background = useThemeColor({}, 'background');
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const textSecondary = useThemeColor({}, 'textSecondary');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isCheckingRuntime, setIsCheckingRuntime] = useState(false);
  const [daemonStatus, setDaemonStatus] = useState<RuntimeStatus | null>(null);
  const [embeddedStatus, setEmbeddedStatus] = useState<EmbeddedRuntimeStatus | null>(null);

  useEffect(() => {
    let active = true;
    probeEmbeddedRuntime().then((status) => {
      if (active) setEmbeddedStatus(status);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleConnectLocal = async () => {
    setIsConnecting(true);
    try {
      const config = await getOrCreateLocalDaemonConfig();
      await connect(config.host, config.port, config.token, config.transport);
      await waitForConnected();
      setDaemonStatus(await getRuntimeStatus());
      router.replace('/(tabs)/chat');
    } catch {
      Alert.alert(t('common.error'), t('connect.daemonUnavailable'));
    } finally {
      setIsConnecting(false);
    }
  };

  const refreshRuntimeStatus = async () => {
    setIsCheckingRuntime(true);
    try {
      setEmbeddedStatus(await probeEmbeddedRuntime());
      const config = await getOrCreateLocalDaemonConfig();
      await connect(config.host, config.port, config.token, config.transport);
      await waitForConnected();
      setDaemonStatus(await getRuntimeStatus());
    } catch {
      Alert.alert(t('common.error'), t('connect.daemonUnavailable'));
    } finally {
      setIsCheckingRuntime(false);
    }
  };

  const handleInstallRuntime = async () => {
    setIsInstalling(true);
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

      const config = await getOrCreateLocalDaemonConfig();
      await connect(config.host, config.port, config.token, config.transport);
      try {
        await waitForConnected(BOOTSTRAP_CONNECTION_TIMEOUT_MS);
        setDaemonStatus(await getRuntimeStatus());
        router.replace('/(tabs)/chat');
      } catch {
        Alert.alert(t('connect.installRuntime'), t('connect.runtimeStillStarting'));
      }
    } catch {
      Alert.alert(t('common.error'), t('connect.runtimeStartFailed'));
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: background }]}>
      <View style={styles.header}>
        <View style={[styles.iconMark, { backgroundColor: tint }]}>
          <Ionicons name='terminal-outline' size={26} color='#fff' />
        </View>
        <ThemedText type='title' style={styles.title}>
          {t('connect.localRuntimeTitle')}
        </ThemedText>
        <ThemedText style={[styles.subtitle, { color: textSecondary }]}>
          {t('connect.localRuntimeSubtitle')}
        </ThemedText>
      </View>

      <View style={[styles.panel, { backgroundColor: surface, borderColor: border }]}>
        <RuntimeRow
          icon='hardware-chip-outline'
          label={t('connect.embeddedRuntime')}
          value={embeddedRuntimeLabel(embeddedStatus, t)}
          tone={embeddedRuntimeTone(embeddedStatus)}
        />
        <RuntimeRow
          icon='server-outline'
          label={t('connect.daemon')}
          value={daemonStatus ? daemonLabel(daemonStatus) : daemonStateLabel(connectionState, t)}
          tone={connectionState === 'connected' ? 'ready' : connectionState === 'auth_failed' ? 'missing' : 'pending'}
        />
        {daemonStatus?.bootstrap && (
          <RuntimeRow
            icon='pulse-outline'
            label={t('connect.bootstrap')}
            value={bootstrapLabel(daemonStatus.bootstrap)}
            tone={bootstrapTone(daemonStatus.bootstrap.phase)}
          />
        )}
        {agentRows(daemonStatus).map((agent) => (
          <RuntimeRow
            key={agent.backend}
            icon={agent.backend === 'opencode' ? 'code-slash-outline' : 'sparkles-outline'}
            label={getAgentDisplayName(agent.backend)}
            value={agentLabel(agent, t)}
            tone={agentTone(agent.state)}
          />
        ))}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: tint, opacity: isConnecting ? 0.7 : 1 }]}
          onPress={handleConnectLocal}
          activeOpacity={0.8}
          disabled={isConnecting}
        >
          {isConnecting ? (
            <ActivityIndicator color='#fff' />
          ) : (
            <>
              <Ionicons name='link-outline' size={20} color='#fff' />
              <ThemedText style={styles.primaryButtonText}>{t('connect.connectLocal')}</ThemedText>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryButton, { borderColor: border }]}
          onPress={handleInstallRuntime}
          activeOpacity={0.8}
          disabled={isInstalling}
        >
          {isInstalling ? (
            <>
              <ActivityIndicator color={tint} />
              <ThemedText style={[styles.secondaryButtonText, { color: tint }]}>
                {t('connect.preparingRuntime')}
              </ThemedText>
            </>
          ) : (
            <>
              <Ionicons name='download-outline' size={20} color={tint} />
              <ThemedText style={[styles.secondaryButtonText, { color: tint }]}>
                {t('connect.installRuntime')}
              </ThemedText>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryButton, { borderColor: border }]}
          onPress={refreshRuntimeStatus}
          activeOpacity={0.8}
          disabled={isCheckingRuntime}
        >
          {isCheckingRuntime ? (
            <ActivityIndicator color={tint} />
          ) : (
            <>
              <Ionicons name='sync-outline' size={20} color={tint} />
              <ThemedText style={[styles.secondaryButtonText, { color: tint }]}>
                {t('connect.refreshRuntimeStatus')}
              </ThemedText>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function agentRows(status: RuntimeStatus | null): RuntimeAgentHealth[] {
  return status?.agents ?? [];
}

function agentLabel(agent: RuntimeAgentHealth, t: (key: string) => string): string {
  const state = t(getAgentStateLabelKey(agent.state));
  return agent.version ? `${state} · ${agent.version}` : state;
}

function agentTone(state: RuntimeAgentHealth['state']): RuntimeRowProps['tone'] {
  if (state === 'ready') return 'ready';
  if (state === 'missing' || state === 'error') return 'missing';
  return 'pending';
}

function daemonStateLabel(state: string, t: (key: string) => string): string {
  if (state === 'connected') return t('connect.statusConnected');
  if (state === 'connecting') return t('connect.statusConnecting');
  if (state === 'auth_failed') return t('connect.statusAuthFailed');
  return `127.0.0.1:${LOCAL_DAEMON_PORT}`;
}

function daemonLabel(status: RuntimeStatus): string {
  return status.daemon.pid ? `${status.daemon.version} · pid ${status.daemon.pid}` : status.daemon.version;
}

function bootstrapLabel(bootstrap: NonNullable<RuntimeStatus['bootstrap']>): string {
  return bootstrap.detail ? `${bootstrap.phase} · ${bootstrap.detail}` : bootstrap.phase;
}

function bootstrapTone(phase: string): RuntimeRowProps['tone'] {
  if (phase === 'daemon_start_requested' || phase === 'aioncore_start_requested') return 'ready';
  if (phase.endsWith('_failed') || phase === 'error') return 'missing';
  return 'pending';
}

function embeddedRuntimeLabel(
  status: EmbeddedRuntimeStatus | null,
  t: (key: string) => string,
): string {
  if (!status) return t('connect.statusUnknown');
  const state = t(`connect.runtimeState${capitalize(status.state)}`);
  const details = [status.version, status.pid ? `pid ${status.pid}` : null, status.detail].filter(
    (item): item is string => Boolean(item),
  );
  return details.length > 0 ? `${state} · ${details.join(' · ')}` : state;
}

function embeddedRuntimeTone(status: EmbeddedRuntimeStatus | null): RuntimeRowProps['tone'] {
  if (!status || status.state === 'preparing' || status.state === 'starting' || status.state === 'stopped') {
    return 'pending';
  }
  if (status.state === 'running') return 'ready';
  return 'missing';
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
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

function waitForConnected(timeoutMs = 5000): Promise<void> {
  if (wsService.state === 'connected') {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error('timeout'));
    }, timeoutMs);

    const unsubscribe = wsService.onStateChange((state) => {
      if (state === 'connected') {
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      }
      if (state === 'auth_failed') {
        clearTimeout(timeout);
        unsubscribe();
        reject(new Error('auth_failed'));
      }
    });
  });
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  header: {
    gap: 10,
    paddingTop: 28,
    paddingBottom: 24,
  },
  iconMark: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
  },
  panel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowIcon: {
    width: 24,
    marginRight: 12,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  actions: {
    marginTop: 'auto',
    gap: 12,
    paddingBottom: 12,
  },
  primaryButton: {
    height: 50,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  secondaryButton: {
    height: 48,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  secondaryButtonText: {
    fontWeight: '600',
    fontSize: 15,
  },
});
