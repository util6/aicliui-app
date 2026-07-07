export type AgentInfo = {
  backend: string;
  name: string;
  label?: string;
};

export type Conversation = {
  id: string;
  name: string;
  type: string;
  status?: 'pending' | 'running' | 'finished';
  createTime: number;
  modifyTime: number;
  model: { id: string; useModel: string };
  extra: {
    workspace?: string;
    customWorkspace?: boolean;
    backend?: string;
    agentName?: string;
    pinned?: boolean;
    pinnedAt?: number;
    currentModelId?: string;
    sessionMode?: string;
  };
};

export type IResponseMessage = {
  type: string;
  data: unknown;
  msg_id: string;
  conversation_id: string;
};

export type RuntimeInstallState = 'missing' | 'installing' | 'ready' | 'error';

export type AgentHealth = {
  backend: 'opencode' | 'gemini';
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
