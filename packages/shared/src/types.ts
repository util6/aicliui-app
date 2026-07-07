export type AgentInfo = {
  backend: string;
  name: string;
  label?: string;
};

export type AgentModelOption = {
  id: string;
  label: string;
};

export type AgentModelInfo = {
  currentModelId: string | null;
  currentModelLabel: string | null;
  availableModels: AgentModelOption[];
  canSwitch: boolean;
  source: 'configOption' | 'models';
  configOptionId?: string;
};

export type AgentConfigOptionType = 'select' | 'boolean' | 'string';

export type AgentConfigSelectOption = {
  value: string;
  name?: string;
  label?: string;
  description?: string;
};

export type AgentConfigOption = {
  id: string;
  name?: string;
  label?: string;
  description?: string;
  category?: string;
  type?: AgentConfigOptionType;
  option_type?: AgentConfigOptionType;
  current_value?: string | null;
  options: AgentConfigSelectOption[];
};

export type EnsureConversationRuntimeResponse = {
  recovered: boolean;
  config_options: AgentConfigOption[];
  runtime: ConversationRuntimeSummary;
  modelInfo?: AgentModelInfo | null;
};

export type SetConfigOptionResponse = {
  confirmation: 'observed' | 'command_ack';
  config_options: AgentConfigOption[];
  modelInfo?: AgentModelInfo | null;
};

export type AgentModeOption = {
  value: string;
  label: string;
  description?: string;
};

export const AGENT_MODES: Record<string, AgentModeOption[]> = {
  claude: [
    { value: 'default', label: 'Default' },
    { value: 'plan', label: 'Plan' },
    { value: 'bypassPermissions', label: 'YOLO' },
  ],
  qwen: [
    { value: 'default', label: 'Default' },
    { value: 'yolo', label: 'YOLO' },
  ],
  opencode: [
    { value: 'build', label: 'Build' },
    { value: 'plan', label: 'Plan' },
  ],
  gemini: [
    { value: 'default', label: 'Default' },
    { value: 'autoEdit', label: 'Auto-Accept Edits' },
    { value: 'yolo', label: 'YOLO' },
  ],
  codex: [
    { value: 'default', label: 'Plan' },
    { value: 'autoEdit', label: 'Auto Edit' },
    { value: 'yolo', label: 'Full Auto' },
  ],
  cursor: [
    { value: 'agent', label: 'Agent', description: 'Full agent capabilities with tool access' },
    { value: 'plan', label: 'Plan', description: 'Read-only mode for planning and designing before implementation' },
    { value: 'ask', label: 'Ask', description: 'Q&A mode - no edits or command execution' },
  ],
  snow: [
    { value: 'default', label: 'Agent' },
    { value: 'yolo', label: 'YOLO' },
  ],
};

export function getAgentModes(backend: string | undefined): AgentModeOption[] {
  if (!backend) return [];
  return [...(AGENT_MODES[backend] || [])];
}

export type ConversationStatus = 'pending' | 'running' | 'waiting_confirmation' | 'finished';

export type Conversation = {
  id: string;
  name: string;
  type: string;
  status?: ConversationStatus;
  runtime?: ConversationRuntimeSummary;
  createTime: number;
  modifyTime: number;
  model: { id: string; useModel: string };
  extra: {
    workspace?: string;
    customWorkspace?: boolean;
    backend?: string;
    agentName?: string;
    defaultFiles?: string[];
    pinned?: boolean;
    pinnedAt?: number;
    currentModelId?: string;
    currentModelLabel?: string;
    sessionMode?: string;
    lastContextUsage?: {
      used: number;
      size: number;
    };
  };
};

export type ConversationRuntimeState = 'idle' | 'starting' | 'running' | 'cancelling' | 'waiting_confirmation';

export type ConversationRuntimeSummary = {
  state: ConversationRuntimeState;
  can_send_message: boolean;
  has_task: boolean;
  task_status?: ConversationStatus;
  is_processing: boolean;
  pending_confirmations: number;
  turn_id: string | null;
};

export type ConversationTurnCompletedEvent = {
  session_id: string;
  turn_id: string;
  status: ConversationStatus;
  state: string;
  detail: string;
  can_send_message: boolean;
  runtime: ConversationRuntimeSummary;
  workspace: string;
  model: {
    platform: string;
    name: string;
    use_model: string;
  };
  last_message: {
    id?: string;
    type?: string;
    content: unknown;
    status?: string | null;
    created_at: number;
  };
};

export type ConversationUserCreatedEvent = {
  conversation_id: string;
  msg_id: string;
  content: string;
  position: 'right';
  status: 'finish';
  hidden: boolean;
  created_at: number;
};

export type ConversationListChangedEvent = {
  conversation_id: string;
  action: 'created' | 'updated' | 'deleted';
  source?: string;
};

export type IResponseMessage = {
  type: string;
  data: unknown;
  msg_id: string;
  conversation_id: string;
};

export type RuntimeInstallState = 'missing' | 'installing' | 'ready' | 'error';

export type AgentBackend = 'opencode' | 'gemini' | 'codex';

export type AgentHealth = {
  backend: AgentBackend;
  state: RuntimeInstallState;
  version?: string;
  detail?: string;
};

export type RuntimeStatus = {
  daemon: {
    version: string;
    startedAt: number;
    pid?: number;
  };
  bootstrap?: {
    phase: string;
    detail?: string;
    updatedAt?: number;
  };
  termux: {
    runCommandPermission: 'unknown' | 'granted' | 'denied';
    allowExternalApps: 'unknown' | 'enabled' | 'disabled';
  };
  agents: AgentHealth[];
};

export type BridgeError = {
  success: false;
  error: {
    code: string;
    message: string;
  };
};
