import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { bridge } from '../services/bridge';
import { setPendingInitialMessage } from '../services/pendingInitialMessages';
import { useConnection } from './ConnectionContext';

/**
 * Conversation type matching TChatConversation from AionUi.
 * Simplified for mobile — we only need display-relevant fields.
 */
export type Conversation = {
  id: string;
  name: string;
  type: string;
  status?: 'pending' | 'running' | 'waiting_confirmation' | 'finished';
  runtime?: {
    state: 'idle' | 'starting' | 'running' | 'cancelling' | 'waiting_confirmation';
    can_send_message: boolean;
    has_task: boolean;
    task_status?: 'pending' | 'running' | 'waiting_confirmation' | 'finished';
    is_processing: boolean;
    pending_confirmations: number;
    turn_id: string | null;
  };
  createTime: number;
  modifyTime: number;
  model: { id: string; useModel: string };
  extra: {
    workspace?: string;
    customWorkspace?: boolean;
    backend?: string;
    agentName?: string;
    defaultFiles?: string[];
    currentModelId?: string;
    currentModelLabel?: string;
    sessionMode?: string;
    lastContextUsage?: {
      used: number;
      size: number;
    };
    pinned?: boolean;
    pinnedAt?: number;
  };
};

export type AgentInfo = {
  backend: string;
  name: string;
  label?: string;
};

type CreateConversationParams = {
  agentBackend: string;
  agentName?: string;
  cliPath?: string;
  workspace?: string;
  customWorkspace?: boolean;
  model?: { id: string; useModel: string };
  input?: string;
  defaultFiles?: string[];
  sessionMode?: string;
  currentModelId?: string;
  currentModelLabel?: string;
};

export type CommitNewChatOptions = {
  workspace?: string;
  customWorkspace?: boolean;
  defaultFiles?: string[];
  sessionMode?: string;
  currentModelId?: string;
  currentModelLabel?: string;
};

export type ConversationExecutionContextPatch = {
  sessionMode?: string;
  currentModelId?: string;
  currentModelLabel?: string;
};

type ConversationContextType = {
  conversations: Conversation[];
  isLoading: boolean;
  availableAgents: AgentInfo[];
  activeConversationId: string | null;
  pendingAgent: AgentInfo | null;
  setActiveConversationId: (id: string | null) => void;
  startNewChat: (agent: AgentInfo) => void;
  commitNewChat: (message: string, options?: CommitNewChatOptions) => Promise<void>;
  cancelNewChat: () => void;
  refresh: () => Promise<void>;
  fetchAgents: () => Promise<void>;
  createConversation: (params: CreateConversationParams) => Promise<Conversation | null>;
  updateConversationExecutionContext: (
    id: string,
    patch: ConversationExecutionContextPatch,
  ) => Promise<boolean>;
  deleteConversation: (id: string) => Promise<boolean>;
  renameConversation: (id: string, name: string) => Promise<boolean>;
};

type StreamStatusMessage = {
  type?: string;
  conversation_id?: string;
  data?: unknown;
};

type TurnCompletedMessage = {
  session_id?: unknown;
  sessionId?: unknown;
  conversation_id?: unknown;
  conversationId?: unknown;
  status?: unknown;
  runtime?: unknown;
};

type ListChangedMessage = {
  conversation_id?: unknown;
  conversationId?: unknown;
  action?: unknown;
};

const ConversationContext = createContext<ConversationContextType>({
  conversations: [],
  isLoading: false,
  availableAgents: [],
  activeConversationId: null,
  pendingAgent: null,
  setActiveConversationId: () => {},
  startNewChat: () => {},
  commitNewChat: async () => {},
  cancelNewChat: () => {},
  refresh: async () => {},
  fetchAgents: async () => {},
  createConversation: async () => null,
  updateConversationExecutionContext: async () => false,
  deleteConversation: async () => false,
  renameConversation: async () => false,
});

export function ConversationProvider({ children }: { children: React.ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [availableAgents, setAvailableAgents] = useState<AgentInfo[]>([]);
  const [activeConversationId, setActiveConversationIdRaw] = useState<string | null>(null);
  const [pendingAgent, setPendingAgent] = useState<AgentInfo | null>(null);
  const completedConversationIdsRef = useRef<Set<string>>(new Set());
  const { connectionState, config } = useConnection();

  // When selecting an existing conversation, clear pendingAgent
  const setActiveConversationId = useCallback((id: string | null) => {
    setActiveConversationIdRaw(id);
    if (id !== null) {
      setPendingAgent(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (connectionState !== 'connected') return;
    setIsLoading(true);
    try {
      const data = await bridge.request<Conversation[]>('database.get-user-conversations', {
        page: 0,
        pageSize: 100,
      });
      if (Array.isArray(data)) {
        setConversations(data);
      }
    } catch (e) {
      console.warn('[Conversations] Failed to fetch:', e);
    } finally {
      setIsLoading(false);
    }
  }, [connectionState]);

  // Auto-fetch when connected
  useEffect(() => {
    if (connectionState === 'connected') {
      void refresh();
    }
  }, [connectionState, refresh]);

  // Clear data only when user actively disconnects (config becomes null)
  useEffect(() => {
    if (config === null) {
      setConversations([]);
      setActiveConversationIdRaw(null);
      setPendingAgent(null);
    }
  }, [config]);

  // Auto-select most recent conversation when loaded and no active selection
  useEffect(() => {
    if (conversations.length > 0 && !activeConversationId && !pendingAgent) {
      setActiveConversationIdRaw(conversations[0].id);
    }
  }, [conversations, activeConversationId, pendingAgent]);

  // Refresh conversation list when app returns to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && connectionState === 'connected') {
        void refresh();
      }
    });
    return () => sub.remove();
  }, [connectionState, refresh]);

  // Poll conversation list every 30s while connected
  useEffect(() => {
    if (connectionState !== 'connected') return;
    const timer = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(timer);
  }, [connectionState, refresh]);

  // Keep sidebar status in sync with live streams, then refresh after terminal
  // events to pick up persisted metadata such as modifyTime.
  useEffect(() => {
    const debounceRef = { timer: null as ReturnType<typeof setTimeout> | null };
    const scheduleRefresh = () => {
      if (debounceRef.timer) clearTimeout(debounceRef.timer);
      debounceRef.timer = setTimeout(() => void refresh(), 1000);
    };

    const unsub = bridge.on('chat.response.stream', (data: unknown) => {
      const raw = data as StreamStatusMessage;
      const conversationId = raw.conversation_id;
      if (!conversationId) return;
      const status = getStreamConversationStatus(raw, completedConversationIdsRef.current);
      if (!status) return;

      if (status === 'finished') {
        completedConversationIdsRef.current.add(conversationId);
      } else {
        completedConversationIdsRef.current.delete(conversationId);
      }

      setConversations((prev) => patchConversationStatus(prev, conversationId, status));
      if (status !== 'finished') return;
      scheduleRefresh();
    });

    const unsubTurnCompleted = bridge.on('turn.completed', (data: unknown) => {
      const completed = normalizeTurnCompleted(data);
      if (!completed) return;

      if (completed.status === 'finished') {
        completedConversationIdsRef.current.add(completed.conversationId);
      } else {
        completedConversationIdsRef.current.delete(completed.conversationId);
      }

      setConversations((prev) =>
        patchConversationRuntime(prev, completed.conversationId, completed.status, completed.runtime),
      );
      if (completed.status === 'finished') {
        scheduleRefresh();
      }
    });

    const unsubListChanged = bridge.on('conversation.listChanged', (data: unknown) => {
      const event = normalizeListChanged(data);
      if (!event) return;

      if (event.action === 'deleted') {
        completedConversationIdsRef.current.delete(event.conversationId);
        setConversations((prev) => {
          const next = prev.filter((conversation) => conversation.id !== event.conversationId);
          if (activeConversationId === event.conversationId) {
            setActiveConversationIdRaw(next[0]?.id ?? null);
          }
          return next.length === prev.length ? prev : next;
        });
      }

      void refresh();
    });

    const unsubConfirmAdd = bridge.on('confirmation.add', (data: unknown) => {
      const conversationId = getConversationId(data);
      if (!conversationId) return;
      if (completedConversationIdsRef.current.has(conversationId)) return;
      completedConversationIdsRef.current.delete(conversationId);
      setConversations((prev) => patchConversationStatus(prev, conversationId, 'waiting_confirmation'));
    });

    const unsubConfirmRemove = bridge.on('confirmation.remove', (data: unknown) => {
      const conversationId = getConversationId(data);
      if (!conversationId || completedConversationIdsRef.current.has(conversationId)) return;
      setConversations((prev) => patchConversationStatus(prev, conversationId, 'running'));
    });

    return () => {
      unsub();
      unsubTurnCompleted();
      unsubListChanged();
      unsubConfirmAdd();
      unsubConfirmRemove();
      if (debounceRef.timer) clearTimeout(debounceRef.timer);
    };
  }, [activeConversationId, refresh]);

  const fetchAgents = useCallback(async () => {
    if (connectionState !== 'connected') return;
    try {
      const response = await bridge.request<{ success: boolean; data?: AgentInfo[] }>(
        'acp.get-available-agents',
      );
      if (response?.success && Array.isArray(response.data)) {
        setAvailableAgents(response.data);
      }
    } catch (e) {
      console.warn('[Conversations] Failed to fetch agents:', e);
    }
  }, [connectionState]);

  const createConversation = useCallback(
    async (params: CreateConversationParams) => {
      try {
        // Most agents are ACP type; only a few special types map directly
        const SPECIAL_TYPES = new Set(['gemini', 'codex', 'openclaw-gateway', 'nanobot']);
        const conversationType = SPECIAL_TYPES.has(params.agentBackend)
          ? params.agentBackend
          : 'acp';

        // Use provided workspace, or infer from most recent conversation that has one
        const workspace =
          params.workspace ?? conversations.find((c) => c.extra?.workspace)?.extra?.workspace;

        const fullParams = {
          type: conversationType,
          name: params.input || params.agentName || params.agentBackend,
          model: params.model || { id: '', useModel: '' },
          extra: {
            backend: params.agentBackend,
            agentName: params.agentName,
            ...(workspace ? { workspace, customWorkspace: params.customWorkspace ?? true } : {}),
            ...(params.cliPath ? { cliPath: params.cliPath } : {}),
            ...(params.defaultFiles?.length ? { defaultFiles: params.defaultFiles } : {}),
            ...(params.sessionMode ? { sessionMode: params.sessionMode } : {}),
            ...(params.currentModelId ? { currentModelId: params.currentModelId } : {}),
            ...(params.currentModelLabel ? { currentModelLabel: params.currentModelLabel } : {}),
          },
        };
        const result = await bridge.request<Conversation>('create-conversation', fullParams);
        if (result?.id) {
          await refresh();
          return result;
        }
      } catch (e) {
        console.warn('[Conversations] Failed to create:', e);
      }
      return null;
    },
    [refresh, conversations]
  );

  const startNewChat = useCallback((agent: AgentInfo) => {
    setPendingAgent(agent);
    setActiveConversationIdRaw(null);
  }, []);

  const commitNewChat = useCallback(
    async (message: string, options?: CommitNewChatOptions) => {
      if (!pendingAgent) return;
      const agent = pendingAgent;
      const result = await createConversation({
        agentBackend: agent.backend,
        agentName: agent.name,
        input: message,
        ...options,
      });
      if (result?.id) {
        setPendingInitialMessage(result.id, message);
        setPendingAgent(null);
        setActiveConversationIdRaw(result.id);
      }
    },
    [pendingAgent, createConversation],
  );

  const cancelNewChat = useCallback(() => {
    setPendingAgent(null);
  }, []);

  const deleteConversation = useCallback(
    async (id: string) => {
      try {
        await bridge.request('remove-conversation', { id });
        // If deleting the active conversation, switch to next one
        if (id === activeConversationId) {
          const remaining = conversations.filter((c) => c.id !== id);
          setActiveConversationId(remaining.length > 0 ? remaining[0].id : null);
        }
        await refresh();
        return true;
      } catch (e) {
        console.warn('[Conversations] Failed to delete:', e);
        return false;
      }
    },
    [refresh, activeConversationId, conversations]
  );

  const updateConversationExecutionContext = useCallback(
    async (id: string, patch: ConversationExecutionContextPatch) => {
      try {
        const extra: Conversation['extra'] = {};
        if (patch.sessionMode !== undefined) {
          extra.sessionMode = patch.sessionMode;
        }
        if (patch.currentModelId !== undefined) {
          extra.currentModelId = patch.currentModelId;
        }
        if (patch.currentModelLabel !== undefined) {
          extra.currentModelLabel = patch.currentModelLabel;
        }

        const success = await bridge.request<boolean>('update-conversation', {
          id,
          updates: { extra },
        });
        if (success) {
          await refresh();
        }
        return !!success;
      } catch (e) {
        console.warn('[Conversations] Failed to update execution context:', e);
        return false;
      }
    },
    [refresh],
  );

  const renameConversation = useCallback(
    async (id: string, name: string) => {
      try {
        const success = await bridge.request<boolean>('update-conversation', {
          id,
          updates: { name },
        });
        if (success) {
          await refresh();
        }
        return !!success;
      } catch (e) {
        console.warn('[Conversations] Failed to rename:', e);
        return false;
      }
    },
    [refresh]
  );

  return (
    <ConversationContext.Provider
      value={{
        conversations,
        isLoading,
        availableAgents,
        activeConversationId,
        pendingAgent,
        setActiveConversationId,
        startNewChat,
        commitNewChat,
        cancelNewChat,
        refresh,
        fetchAgents,
        createConversation,
        updateConversationExecutionContext,
        deleteConversation,
        renameConversation,
      }}
    >
      {children}
    </ConversationContext.Provider>
  );
}

export function useConversations() {
  return useContext(ConversationContext);
}

function getStreamConversationStatus(
  message: StreamStatusMessage,
  completedConversationIds: Set<string>,
): Conversation['status'] | null {
  if (message.type === 'start') return 'running';
  if (message.type === 'finish' || message.type === 'error') return 'finished';
  if (isErrorTipMessage(message)) return 'finished';
  if (message.type === 'agent_status' && isTerminalAgentStatus(message.data)) return 'finished';
  if (message.conversation_id && completedConversationIds.has(message.conversation_id)) return null;
  if (isPermissionStreamMessage(message.type)) return 'waiting_confirmation';
  if (!isGeneratingStreamMessage(message.type)) return null;
  return 'running';
}

function isPermissionStreamMessage(type: unknown): boolean {
  return type === 'acp_permission' || type === 'permission' || type === 'codex_permission';
}

function isGeneratingStreamMessage(type: unknown): boolean {
  return (
    type === 'content' ||
    type === 'thought' ||
    type === 'thinking' ||
    type === 'tool_call' ||
    type === 'tool_group' ||
    type === 'acp_tool_call' ||
    type === 'codex_tool_call' ||
    type === 'plan'
  );
}

function patchConversationStatus(
  conversations: Conversation[],
  conversationId: string,
  status: Conversation['status'],
): Conversation[] {
  let changed = false;
  const next = conversations.map((conversation) => {
    if (conversation.id !== conversationId || conversation.status === status) {
      return conversation;
    }
    changed = true;
    return { ...conversation, status };
  });
  return changed ? next : conversations;
}

function patchConversationRuntime(
  conversations: Conversation[],
  conversationId: string,
  status: Conversation['status'],
  runtime: NonNullable<Conversation['runtime']>,
): Conversation[] {
  let changed = false;
  const next = conversations.map((conversation) => {
    if (conversation.id !== conversationId) {
      return conversation;
    }
    changed = true;
    return {
      ...conversation,
      status,
      runtime,
    };
  });
  return changed ? next : conversations;
}

function normalizeTurnCompleted(value: unknown): {
  conversationId: string;
  status: NonNullable<Conversation['status']>;
  runtime: NonNullable<Conversation['runtime']>;
} | null {
  if (typeof value !== 'object' || value === null) return null;
  const event = value as TurnCompletedMessage;
  const conversationId = firstNonEmptyString(
    event.session_id,
    event.sessionId,
    event.conversation_id,
    event.conversationId,
  );
  if (!conversationId) return null;
  const runtime = normalizeRuntimeSummary(event.runtime);
  if (!runtime) return null;
  return {
    conversationId,
    status: isConversationStatus(event.status) ? event.status : runtime.task_status ?? 'finished',
    runtime,
  };
}

function normalizeRuntimeSummary(value: unknown): NonNullable<Conversation['runtime']> | null {
  if (typeof value !== 'object' || value === null) return null;
  const runtime = value as Record<string, unknown>;
  const state = runtime.state;
  const canSendMessage = runtime.can_send_message ?? runtime.canSendMessage;
  const hasTask = runtime.has_task ?? runtime.hasTask;
  const taskStatus = runtime.task_status ?? runtime.taskStatus;
  const isProcessing = runtime.is_processing ?? runtime.isProcessing;
  const pendingConfirmations = runtime.pending_confirmations ?? runtime.pendingConfirmations;
  const turnId = runtime.turn_id ?? runtime.turnId ?? null;
  if (!isRuntimeState(state)) return null;
  if (typeof canSendMessage !== 'boolean') return null;
  if (typeof hasTask !== 'boolean') return null;
  if (typeof isProcessing !== 'boolean') return null;
  if (typeof pendingConfirmations !== 'number') return null;
  if (turnId !== null && typeof turnId !== 'string') return null;
  return {
    state,
    can_send_message: canSendMessage,
    has_task: hasTask,
    ...(isConversationStatus(taskStatus) ? { task_status: taskStatus } : {}),
    is_processing: isProcessing,
    pending_confirmations: pendingConfirmations,
    turn_id: turnId,
  };
}

function normalizeListChanged(value: unknown): {
  conversationId: string;
  action: 'created' | 'updated' | 'deleted';
} | null {
  if (typeof value !== 'object' || value === null) return null;
  const event = value as ListChangedMessage;
  const conversationId = firstNonEmptyString(event.conversation_id, event.conversationId);
  if (!conversationId) return null;
  if (event.action !== 'created' && event.action !== 'updated' && event.action !== 'deleted') return null;
  return {
    conversationId,
    action: event.action,
  };
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

function isRuntimeState(value: unknown): value is NonNullable<Conversation['runtime']>['state'] {
  return (
    value === 'idle' ||
    value === 'starting' ||
    value === 'running' ||
    value === 'cancelling' ||
    value === 'waiting_confirmation'
  );
}

function isConversationStatus(value: unknown): value is NonNullable<Conversation['status']> {
  return value === 'pending' || value === 'running' || value === 'waiting_confirmation' || value === 'finished';
}

function isErrorTipMessage(message: { type?: string; data?: unknown }): boolean {
  if (message.type !== 'tips') return false;
  return (
    typeof message.data === 'object' &&
    message.data !== null &&
    (message.data as { type?: unknown }).type === 'error'
  );
}

function isTerminalAgentStatus(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false;
  const status = (data as { status?: unknown }).status;
  return status === 'error' || status === 'disconnected';
}

function getConversationId(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const conversationId = (data as { conversation_id?: unknown }).conversation_id;
  return typeof conversationId === 'string' && conversationId.length > 0 ? conversationId : null;
}
