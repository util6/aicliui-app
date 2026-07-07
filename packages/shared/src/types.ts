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
