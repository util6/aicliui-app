import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemeColor } from '../../hooks/useThemeColor';
import { useConnection } from '../../context/ConnectionContext';
import {
  createCustomAgent,
  deleteCustomAgent,
  healthCheckAgent,
  listManagedAgents,
  parseAgentArgs,
  parseEnvironmentText,
  serializeEnvironmentEntries,
  setAgentEnabled,
  testCustomAgent,
  updateCustomAgent,
  type CustomAgentDraft,
  type CustomAgentProbeResult,
  type ManagedAgent,
} from '../../services/agentManagement';
import { ThemedText } from '../ui/ThemedText';

export function AgentManagementScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const replaceRoute = router.replace;
  const { isConfigured, isRestoring } = useConnection();
  const background = useThemeColor({}, 'background');
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const tint = useThemeColor({}, 'tint');
  const errorColor = useThemeColor({}, 'error');
  const textSecondary = useThemeColor({}, 'textSecondary');
  const [agents, setAgents] = useState<ManagedAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [busyAgentId, setBusyAgentId] = useState<string | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingAgent, setEditingAgent] = useState<ManagedAgent | null>(null);

  const loadAgents = useCallback(async (refresh = false) => {
    refresh ? setIsRefreshing(true) : setIsLoading(true);
    setError(false);
    try {
      const result = await listManagedAgents();
      setAgents([...result].sort((a, b) => a.name.localeCompare(b.name)));
    } catch {
      setError(true);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (isRestoring) return;
    if (!isConfigured) {
      replaceRoute('/connect');
      return;
    }
    void loadAgents();
  }, [isConfigured, isRestoring, loadAgents, replaceRoute]);

  const officialAgents = useMemo(() => agents.filter((agent) => agent.agent_source !== 'custom'), [agents]);
  const customAgents = useMemo(() => agents.filter((agent) => agent.agent_source === 'custom'), [agents]);

  const checkHealth = useCallback(async (agent: ManagedAgent) => {
    setBusyAgentId(agent.id);
    try {
      const updated = await healthCheckAgent(agent.id);
      setAgents((current) => current.map((item) => item.id === agent.id ? updated : item));
    } catch {
      Alert.alert(t('common.error'), t('settings.agentHealthFailed'));
    } finally {
      setBusyAgentId(null);
    }
  }, [t]);

  const toggleAgent = useCallback(async (agent: ManagedAgent, enabled: boolean) => {
    setBusyAgentId(agent.id);
    setAgents((current) => current.map((item) => item.id === agent.id ? { ...item, enabled } : item));
    try {
      await setAgentEnabled(agent.id, enabled);
    } catch {
      setAgents((current) => current.map((item) => item.id === agent.id ? { ...item, enabled: agent.enabled } : item));
      Alert.alert(t('common.error'), t('settings.agentToggleFailed'));
    } finally {
      setBusyAgentId(null);
    }
  }, [t]);

  const openNewAgent = () => {
    setEditingAgent(null);
    setEditorVisible(true);
  };

  const openAgentEditor = (agent: ManagedAgent) => {
    setEditingAgent(agent);
    setEditorVisible(true);
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: background }]}>
      <View style={[styles.header, { borderBottomColor: border }]}>
        <TouchableOpacity accessibilityRole='button' accessibilityLabel={t('common.close')} style={styles.iconButton} onPress={() => router.back()}>
          <Ionicons name='chevron-back-outline' size={25} color={tint} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <ThemedText style={styles.title}>{t('settings.agents')}</ThemedText>
          <ThemedText type='caption' style={{ color: textSecondary }} numberOfLines={1}>
            {t('settings.agentsSummary')}
          </ThemedText>
        </View>
        <TouchableOpacity
          accessibilityRole='button'
          accessibilityLabel={t('settings.addCustomAgent')}
          testID='add-custom-agent'
          style={styles.iconButton}
          onPress={openNewAgent}
        >
          <Ionicons name='add-outline' size={27} color={tint} />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={tint} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name='alert-circle-outline' size={38} color={errorColor} />
          <ThemedText>{t('settings.agentLoadFailed')}</ThemedText>
          <TouchableOpacity style={[styles.retryButton, { borderColor: tint }]} onPress={() => loadAgents()}>
            <ThemedText style={{ color: tint }}>{t('common.retry')}</ThemedText>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => loadAgents(true)} tintColor={tint} />}
        >
          <AgentSection
            title={t('settings.officialAgents')}
            agents={officialAgents}
            emptyLabel={t('settings.noOfficialAgents')}
            busyAgentId={busyAgentId}
            surface={surface}
            border={border}
            tint={tint}
            textSecondary={textSecondary}
            onHealth={checkHealth}
          />
          <AgentSection
            title={t('settings.customAgents')}
            agents={customAgents}
            emptyLabel={t('settings.noCustomAgents')}
            busyAgentId={busyAgentId}
            surface={surface}
            border={border}
            tint={tint}
            textSecondary={textSecondary}
            onHealth={checkHealth}
            onToggle={toggleAgent}
            onEdit={openAgentEditor}
          />
        </ScrollView>
      )}

      <AgentEditorSheet
        visible={editorVisible}
        agent={editingAgent}
        onClose={() => setEditorVisible(false)}
        onSaved={async () => {
          setEditorVisible(false);
          await loadAgents(true);
        }}
      />
    </SafeAreaView>
  );
}

type AgentSectionProps = {
  title: string;
  agents: ManagedAgent[];
  emptyLabel: string;
  busyAgentId: string | null;
  surface: string;
  border: string;
  tint: string;
  textSecondary: string;
  onHealth: (agent: ManagedAgent) => void;
  onToggle?: (agent: ManagedAgent, enabled: boolean) => void;
  onEdit?: (agent: ManagedAgent) => void;
};

function AgentSection({ title, agents, emptyLabel, busyAgentId, surface, border, tint, textSecondary, onHealth, onToggle, onEdit }: AgentSectionProps) {
  return (
    <View style={styles.section}>
      <ThemedText type='caption' style={styles.sectionTitle}>{title.toUpperCase()}</ThemedText>
      <View style={[styles.card, { backgroundColor: surface }]}>
        {agents.length === 0 ? (
          <ThemedText type='caption' style={[styles.emptyLabel, { color: textSecondary }]}>{emptyLabel}</ThemedText>
        ) : agents.map((agent, index) => (
          <AgentRow
            key={agent.id}
            agent={agent}
            busy={busyAgentId === agent.id}
            borderColor={index < agents.length - 1 ? border : 'transparent'}
            tint={tint}
            textSecondary={textSecondary}
            onHealth={() => onHealth(agent)}
            onToggle={onToggle ? (enabled) => onToggle(agent, enabled) : undefined}
            onEdit={onEdit ? () => onEdit(agent) : undefined}
          />
        ))}
      </View>
    </View>
  );
}

type AgentRowProps = {
  agent: ManagedAgent;
  busy: boolean;
  borderColor: string;
  tint: string;
  textSecondary: string;
  onHealth: () => void;
  onToggle?: (enabled: boolean) => void;
  onEdit?: () => void;
};

function AgentRow({ agent, busy, borderColor, tint, textSecondary, onHealth, onToggle, onEdit }: AgentRowProps) {
  const { t } = useTranslation();
  const success = useThemeColor({}, 'success');
  const warning = useThemeColor({}, 'warning');
  const error = useThemeColor({}, 'error');
  const statusColor = agent.status === 'online' ? success : agent.status === 'unchecked' ? warning : error;
  const details = agent.last_check_error_message || agent.command || agent.backend || agent.agent_type;

  return (
    <View
      testID={`agent-row-${agent.id}`}
      style={[styles.agentRow, { borderBottomColor: borderColor, opacity: agent.enabled ? 1 : 0.58 }]}
    >
      <View style={[styles.agentIcon, { backgroundColor: tint + '18' }]}>
        <ThemedText style={[styles.agentIconText, { color: tint }]}>{agent.icon || agent.name.charAt(0).toUpperCase()}</ThemedText>
      </View>
      <View style={styles.agentText}>
        <View style={styles.agentNameRow}>
          <ThemedText style={styles.agentName} numberOfLines={1}>{agent.name}</ThemedText>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <ThemedText type='caption' style={{ color: textSecondary }}>{t(`settings.agentStatus${capitalize(agent.status)}`)}</ThemedText>
        </View>
        <ThemedText type='caption' style={{ color: textSecondary }} numberOfLines={2}>{details}</ThemedText>
      </View>
      {onToggle && (
        <Switch
          testID={`agent-toggle-${agent.id}`}
          value={agent.enabled}
          onValueChange={onToggle}
          disabled={busy}
          trackColor={{ true: tint }}
        />
      )}
      {onEdit && (
        <TouchableOpacity
          accessibilityRole='button'
          accessibilityLabel={t('settings.editAgent', { agent: agent.name })}
          testID={`agent-edit-${agent.id}`}
          style={styles.rowIconButton}
          onPress={onEdit}
        >
          <Ionicons name='create-outline' size={20} color={textSecondary} />
        </TouchableOpacity>
      )}
      <TouchableOpacity
        accessibilityRole='button'
        accessibilityLabel={t('settings.healthCheckAgent', { agent: agent.name })}
        testID={`agent-health-${agent.id}`}
        style={styles.rowIconButton}
        onPress={onHealth}
        disabled={busy}
      >
        {busy ? <ActivityIndicator size='small' color={tint} /> : <Ionicons name='pulse-outline' size={20} color={textSecondary} />}
      </TouchableOpacity>
    </View>
  );
}

type AgentEditorSheetProps = {
  visible: boolean;
  agent: ManagedAgent | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
};

function AgentEditorSheet({ visible, agent, onClose, onSaved }: AgentEditorSheetProps) {
  const { t } = useTranslation();
  const background = useThemeColor({}, 'background');
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const tint = useThemeColor({}, 'tint');
  const errorColor = useThemeColor({}, 'error');
  const success = useThemeColor({}, 'success');
  const warning = useThemeColor({}, 'warning');
  const text = useThemeColor({}, 'text');
  const textSecondary = useThemeColor({}, 'textSecondary');
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [environment, setEnvironment] = useState('');
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [probeResult, setProbeResult] = useState<CustomAgentProbeResult | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(agent?.name || '');
    setCommand(agent?.command || '');
    setArgs(agent?.args.join(' ') || '');
    setEnvironment(serializeEnvironmentEntries(agent?.env || []));
    setDescription(agent?.description || '');
    setProbeResult(null);
  }, [agent, visible]);

  const draft = (): CustomAgentDraft => ({
    name: name.trim(),
    command: command.trim(),
    icon: agent?.icon,
    args: parseAgentArgs(args),
    env: parseEnvironmentText(environment),
    description: description.trim() || undefined,
  });

  const save = async () => {
    if (!name.trim() || !command.trim()) return;
    setIsSaving(true);
    try {
      if (agent) await updateCustomAgent(agent.id, draft());
      else await createCustomAgent(draft());
      await onSaved();
    } catch {
      Alert.alert(t('common.error'), t('settings.agentSaveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const testConnection = async () => {
    if (!command.trim()) return;
    setIsTesting(true);
    setProbeResult(null);
    try {
      setProbeResult(await testCustomAgent(draft()));
    } catch {
      setProbeResult({ step: 'fail_cli', error: t('settings.agentTestFailed') });
    } finally {
      setIsTesting(false);
    }
  };

  const confirmDelete = () => {
    if (!agent) return;
    Alert.alert(t('settings.deleteAgent'), t('settings.deleteAgentConfirm', { agent: agent.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCustomAgent(agent.id);
            await onSaved();
          } catch {
            Alert.alert(t('common.error'), t('settings.agentDeleteFailed'));
          }
        },
      },
    ]);
  };

  const probeColor = probeResult?.step === 'success' ? success : probeResult?.step === 'fail_cli' ? errorColor : warning;

  return (
    <Modal visible={visible} animationType='slide' transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView edges={['bottom']} style={[styles.editorSheet, { backgroundColor: background }]}>
          <View style={[styles.editorHeader, { borderBottomColor: border }]}>
            <TouchableOpacity accessibilityRole='button' accessibilityLabel={t('common.close')} style={styles.iconButton} onPress={onClose}>
              <Ionicons name='close-outline' size={25} color={textSecondary} />
            </TouchableOpacity>
            <ThemedText style={styles.editorTitle}>{agent ? t('settings.editCustomAgent') : t('settings.addCustomAgent')}</ThemedText>
            <TouchableOpacity
              accessibilityRole='button'
              accessibilityLabel={t('common.save')}
              testID='save-custom-agent'
              style={styles.iconButton}
              onPress={save}
              disabled={isSaving || !name.trim() || !command.trim()}
            >
              {isSaving ? <ActivityIndicator size='small' color={tint} /> : <Ionicons name='checkmark-outline' size={25} color={name.trim() && command.trim() ? tint : textSecondary} />}
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps='handled'>
            <AgentField label={t('settings.agentName')} value={name} onChangeText={setName} testID='agent-name-input' text={text} surface={surface} border={border} />
            <AgentField label={t('settings.agentCommand')} value={command} onChangeText={setCommand} testID='agent-command-input' text={text} surface={surface} border={border} autoCapitalize='none' />
            <AgentField label={t('settings.agentArguments')} value={args} onChangeText={setArgs} testID='agent-args-input' text={text} surface={surface} border={border} autoCapitalize='none' />
            <AgentField label={t('settings.agentEnvironment')} value={environment} onChangeText={setEnvironment} testID='agent-env-input' text={text} surface={surface} border={border} autoCapitalize='none' multiline />
            <AgentField label={t('settings.agentDescription')} value={description} onChangeText={setDescription} testID='agent-description-input' text={text} surface={surface} border={border} multiline />

            {probeResult && (
              <View style={[styles.probeResult, { borderColor: probeColor, backgroundColor: probeColor + '12' }]}>
                <Ionicons name={probeResult.step === 'success' ? 'checkmark-circle-outline' : 'alert-circle-outline'} size={20} color={probeColor} />
                <ThemedText style={[styles.probeText, { color: probeColor }]}>
                  {probeResult.step === 'success' ? t('settings.agentTestSuccess') : probeResult.error}
                </ThemedText>
              </View>
            )}

            <TouchableOpacity
              accessibilityRole='button'
              testID='test-custom-agent'
              style={[styles.testButton, { borderColor: tint }]}
              onPress={testConnection}
              disabled={isTesting || !command.trim()}
            >
              {isTesting ? <ActivityIndicator size='small' color={tint} /> : <Ionicons name='pulse-outline' size={19} color={tint} />}
              <ThemedText style={{ color: tint }}>{isTesting ? t('settings.testingAgent') : t('settings.testAgent')}</ThemedText>
            </TouchableOpacity>

            {agent && (
              <TouchableOpacity accessibilityRole='button' style={styles.deleteButton} onPress={confirmDelete}>
                <Ionicons name='trash-outline' size={19} color={errorColor} />
                <ThemedText style={{ color: errorColor }}>{t('settings.deleteAgent')}</ThemedText>
              </TouchableOpacity>
            )}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

type AgentFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  testID: string;
  text: string;
  surface: string;
  border: string;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences';
};

function AgentField({ label, value, onChangeText, testID, text, surface, border, multiline, autoCapitalize = 'sentences' }: AgentFieldProps) {
  return (
    <View style={styles.field}>
      <ThemedText type='caption' style={styles.fieldLabel}>{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        testID={testID}
        style={[styles.input, multiline && styles.multilineInput, { color: text, backgroundColor: surface, borderColor: border }]}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
    </View>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 6,
  },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontSize: 18, fontWeight: '600' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 24, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  retryButton: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  section: { gap: 8 },
  sectionTitle: { paddingHorizontal: 4, fontWeight: '600', letterSpacing: 0.5 },
  card: { borderRadius: 8, overflow: 'hidden' },
  emptyLabel: { padding: 18, textAlign: 'center' },
  agentRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  agentIcon: { width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  agentIconText: { fontSize: 17, fontWeight: '700' },
  agentText: { flex: 1, minWidth: 0 },
  agentNameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  agentName: { flexShrink: 1, fontWeight: '600' },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  rowIconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  editorSheet: { maxHeight: '94%', borderTopLeftRadius: 16, borderTopRightRadius: 16, overflow: 'hidden' },
  editorHeader: { minHeight: 56, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  editorTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },
  form: { padding: 16, gap: 16, paddingBottom: 28 },
  field: { gap: 6 },
  fieldLabel: { fontWeight: '600', paddingHorizontal: 2 },
  input: { minHeight: 46, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, fontSize: 16 },
  multilineInput: { minHeight: 88, paddingTop: 11 },
  probeResult: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 8, padding: 12 },
  probeText: { flex: 1, fontSize: 14 },
  testButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 8 },
  deleteButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
