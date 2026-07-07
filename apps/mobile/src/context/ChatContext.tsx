import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { bridge } from '../services/bridge';
import { consumePendingInitialMessage } from '../services/pendingInitialMessages';
import { transformMessage, composeMessage, type TMessage, type IResponseMessage } from '../utils/messageAdapter';
import { mapAvailableCommandsToSlashCommands, type SlashCommandItem } from '../utils/slashCommands';
import { uuid } from '../utils/uuid';
import { useConnection } from './ConnectionContext';

export type ThoughtData = { subject: string; description: string } | null;

type PendingConfirmation = {
  id?: string;
  msg_id?: string;
  conversation_id?: string;
  [key: string]: unknown;
};

type RuntimeSummary = {
  state: 'idle' | 'starting' | 'running' | 'cancelling' | 'waiting_confirmation';
  can_send_message: boolean;
  has_task: boolean;
  task_status?: 'pending' | 'running' | 'waiting_confirmation' | 'finished';
  is_processing: boolean;
  pending_confirmations: number;
  turn_id: string | null;
};

export type QueuedCommand = {
  id: string;
  input: string;
  files: string[];
  createdAt: number;
};

type ChatContextType = {
  messages: TMessage[];
  isStreaming: boolean;
  canSendMessage: boolean;
  queuedCommands: QueuedCommand[];
  conversationId: string | null;
  confirmations: any[];
  contextUsage: { used: number; size: number } | null;
  slashCommands: SlashCommandItem[];
  thought: ThoughtData;
  loadConversation: (id: string) => void;
  sendMessage: (text: string, files?: string[]) => void;
  stopGeneration: () => void;
  confirmAction: (confirmationId: string, callId: string, confirmKey: string) => Promise<void>;
};

const ChatContext = createContext<ChatContextType>({
  messages: [],
  isStreaming: false,
  canSendMessage: true,
  queuedCommands: [],
  conversationId: null,
  confirmations: [],
  contextUsage: null,
  slashCommands: [],
  thought: null,
  loadConversation: () => {},
  sendMessage: () => {},
  stopGeneration: () => {},
  confirmAction: () => Promise.resolve(),
});

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<TMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [canSendMessage, setCanSendMessageState] = useState(true);
  const [queuedCommands, setQueuedCommandsState] = useState<QueuedCommand[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [confirmations, setConfirmations] = useState<any[]>([]);
  const [contextUsage, setContextUsage] = useState<{ used: number; size: number } | null>(null);
  const [slashCommands, setSlashCommands] = useState<SlashCommandItem[]>([]);
  const [thought, setThought] = useState<ThoughtData>(null);
  const messagesRef = useRef<TMessage[]>([]);
  const loadRequestRef = useRef(0);
  const isStreamingRef = useRef(false);
  const canSendMessageRef = useRef(true);
  const queuedCommandsRef = useRef<QueuedCommand[]>([]);
  const suppressNextQueueDrainRef = useRef(false);
  const turnFinishedRef = useRef(false);
  const activeThinkingRef = useRef<{ msgId: string; startedAt: number } | null>(null);
  const { connectionState } = useConnection();
  const prevConnectionStateRef = useRef(connectionState);

  const setStreamingState = useCallback((value: boolean) => {
    isStreamingRef.current = value;
    setIsStreaming(value);
  }, []);

  const setCanSendMessage = useCallback((value: boolean) => {
    canSendMessageRef.current = value;
    setCanSendMessageState(value);
  }, []);

  const setQueuedCommands = useCallback((next: QueuedCommand[] | ((prev: QueuedCommand[]) => QueuedCommand[])) => {
    const resolved = typeof next === 'function' ? next(queuedCommandsRef.current) : next;
    queuedCommandsRef.current = resolved;
    setQueuedCommandsState(resolved);
  }, []);

  const executeSend = useCallback(
    (text: string, files?: string[]) => {
      const trimmed = text.trim();
      if (!conversationId || !trimmed) return false;

      const msgId = uuid();
      const userMsg: TMessage = {
        id: uuid(),
        msg_id: msgId,
        conversation_id: conversationId,
        type: 'text',
        position: 'right',
        content: { content: trimmed },
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      turnFinishedRef.current = false;
      setStreamingState(true);
      setCanSendMessage(false);

      bridge
        .request('chat.send.message', {
          input: trimmed,
          msg_id: msgId,
          conversation_id: conversationId,
          ...(files?.length ? { files } : {}),
        })
        .catch((e) => {
          setStreamingState(false);
          setCanSendMessage(true);
          console.warn('[Chat] send failed:', e);
        });
      return true;
    },
    [conversationId, setCanSendMessage, setStreamingState],
  );

  const enqueueMessage = useCallback(
    (text: string, files?: string[]) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setQueuedCommands((prev) => [
        ...prev,
        {
          id: uuid(),
          input: trimmed,
          files: uniqueFiles(files),
          createdAt: Date.now(),
        },
      ]);
    },
    [setQueuedCommands],
  );

  const drainNextQueuedCommand = useCallback(() => {
    if (!conversationId || !canSendMessageRef.current || isStreamingRef.current) return false;
    const [next, ...rest] = queuedCommandsRef.current;
    if (!next) return false;
    setQueuedCommands(rest);
    return executeSend(next.input, next.files);
  }, [conversationId, executeSend, setQueuedCommands]);

  const completeActiveThinking = useCallback(
    (boundary: Pick<IResponseMessage, 'conversation_id' | 'createdAt' | 'created_at'>, duration?: number) => {
      const activeThinking = activeThinkingRef.current;
      if (!activeThinking) return;

      const endTime = boundary.createdAt ?? boundary.created_at ?? Date.now();
      const elapsed = duration ?? Math.max(0, endTime - activeThinking.startedAt);
      const doneMessage: TMessage = {
        id: `${activeThinking.msgId}-thinking-done`,
        type: 'thinking',
        msg_id: activeThinking.msgId,
        conversation_id: boundary.conversation_id,
        position: 'left',
        createdAt: endTime,
        created_at: endTime,
        content: {
          content: '',
          duration: elapsed,
          status: 'done',
        },
      };

      setMessages((prev) => composeMessage(doneMessage, prev));
      activeThinkingRef.current = null;
    },
    [],
  );

  // Keep ref in sync
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const refreshSlashCommands = useCallback(async (id: string, requestId = loadRequestRef.current) => {
    try {
      const data = await bridge.request('conversation.get-slash-commands', {
        conversation_id: id,
      });
      if (requestId !== loadRequestRef.current) return;
      setSlashCommands(mapAvailableCommandsToSlashCommands(data));
    } catch (e) {
      console.warn('[Chat] Failed to load slash commands:', e);
    }
  }, []);

  const restorePendingConfirmations = useCallback(async (id: string, requestId = loadRequestRef.current) => {
    try {
      const list = await bridge.request<PendingConfirmation[]>('confirmation.list', {
        conversation_id: id,
      });
      if (requestId !== loadRequestRef.current) return;
      if (!Array.isArray(list)) return;
      setConfirmations(list);
      setMessages((prev) => appendConfirmationMessages(prev, id, list));
      if (list.length > 0) {
        turnFinishedRef.current = false;
        setStreamingState(true);
        setCanSendMessage(false);
      }
    } catch (e) {
      console.warn('[Chat] Failed to restore confirmations:', e);
    }
  }, [setCanSendMessage, setStreamingState]);

  // Load message history
  const loadConversation = useCallback(async (id: string) => {
    const requestId = ++loadRequestRef.current;
    setConversationId(id);
    setMessages([]);
    setQueuedCommands([]);
    suppressNextQueueDrainRef.current = false;
    turnFinishedRef.current = false;
    activeThinkingRef.current = null;
    setStreamingState(false);
    setCanSendMessage(true);
    setConfirmations([]);
    setContextUsage(null);
    setSlashCommands([]);
    setThought(null);

    try {
      const data = await bridge.request<TMessage[]>('database.get-conversation-messages', {
        conversation_id: id,
      });
      if (Array.isArray(data)) {
        if (requestId !== loadRequestRef.current) return;
        setMessages(data);
      }
    } catch (e) {
      console.warn('[Chat] Failed to load messages:', e);
    }

    try {
      const conversation = await bridge.request<{
        status?: string;
        runtime?: unknown;
        extra?: { lastContextUsage?: unknown };
      } | null>('conversation.get', {
        conversation_id: id,
      });
      if (requestId !== loadRequestRef.current) return;
      const runtime = normalizeRuntimeSummary(conversation?.runtime);
      if (runtime) {
        setStreamingState(isProcessingRuntimeSummary(runtime));
        setCanSendMessage(runtime.can_send_message);
      } else if (isProcessingConversationStatus(conversation?.status)) {
        turnFinishedRef.current = false;
        setStreamingState(true);
        setCanSendMessage(false);
      }
      const restoredUsage = normalizeContextUsage(conversation?.extra?.lastContextUsage);
      if (restoredUsage) {
        setContextUsage(restoredUsage);
      }
    } catch (e) {
      console.warn('[Chat] Failed to load conversation context:', e);
    }

    await restorePendingConfirmations(id, requestId);
    await refreshSlashCommands(id, requestId);
  }, [refreshSlashCommands, restorePendingConfirmations, setCanSendMessage, setStreamingState]);

  // Subscribe to streaming responses
  useEffect(() => {
    if (!conversationId) return;

    const unsub = bridge.on('chat.response.stream', (data: unknown) => {
      const raw = data as IResponseMessage;
      if (raw.conversation_id !== conversationId) return;

      // Track streaming state
      if (raw.type === 'start') {
        turnFinishedRef.current = false;
        setStreamingState(true);
        setCanSendMessage(false);
        return;
      }
      if (raw.type === 'finish') {
        completeActiveThinking(raw);
        turnFinishedRef.current = true;
        setStreamingState(false);
        setCanSendMessage(true);
        setThought(null);
        if (suppressNextQueueDrainRef.current) {
          suppressNextQueueDrainRef.current = false;
        } else {
          drainNextQueuedCommand();
        }
        return;
      }

      if (isErrorStreamMessage(raw)) {
        completeActiveThinking(raw);
        turnFinishedRef.current = true;
        setStreamingState(false);
        setCanSendMessage(true);
        setThought(null);
        const msg = transformMessage(raw);
        if (msg) {
          setMessages((prev) => composeMessage(msg, prev));
        }
        return;
      }

      if (raw.type === 'thinking') {
        const thinkingData = raw.data as { status?: string; duration?: number; duration_ms?: number };
        if (thinkingData?.status === 'done') {
          activeThinkingRef.current = null;
        } else {
          if (!turnFinishedRef.current && !isStreamingRef.current) {
            setStreamingState(true);
            setCanSendMessage(false);
          }
          activeThinkingRef.current = {
            msgId: raw.msg_id,
            startedAt: raw.createdAt ?? raw.created_at ?? Date.now(),
          };
        }
      }

      // Ephemeral thought — update state, don't add to message list
      if (raw.type === 'thought') {
        if (turnFinishedRef.current) return;
        if (!isStreamingRef.current) {
          setStreamingState(true);
          setCanSendMessage(false);
        }
        const data = raw.data as { subject: string; description: string };
        setThought({ subject: data.subject, description: data.description });
        return;
      }

      // Clear thought when content arrives
      if (raw.type === 'content') {
        completeActiveThinking(raw);
        if (!turnFinishedRef.current && !isStreamingRef.current) {
          setStreamingState(true);
          setCanSendMessage(false);
        }
        setThought(null);
      }

      // Extract context usage metadata
      if (raw.type === 'acp_context_usage') {
        setContextUsage(raw.data as { used: number; size: number });
        return;
      }

      if (raw.type === 'available_commands') {
        setSlashCommands(mapAvailableCommandsToSlashCommands(raw.data));
        return;
      }

      if (raw.type === 'slash_commands_updated') {
        void refreshSlashCommands(conversationId);
        return;
      }

      const msg = transformMessage(raw);
      if (msg) {
        setMessages((prev) => composeMessage(msg, prev));
      }
    });

    // Confirmation lifecycle events
    const unsubConfirmAdd = bridge.on('confirmation.add', (data: unknown) => {
      const confirmation = data as PendingConfirmation;
      if (confirmation.conversation_id !== conversationId) return;
      turnFinishedRef.current = false;
      setStreamingState(true);
      setCanSendMessage(false);
      setConfirmations((prev) => upsertConfirmation(prev, confirmation));
      setMessages((prev) => appendConfirmationMessages(prev, conversationId, [confirmation]));
    });

    const unsubConfirmUpdate = bridge.on('confirmation.update', (data: unknown) => {
      const update = data as PendingConfirmation;
      if (update.conversation_id && update.conversation_id !== conversationId) return;
      setConfirmations((prev) => prev.map((c) => (c.id === update.id ? { ...c, ...update } : c)));
      setMessages((prev) => updateConfirmationMessages(prev, update));
    });

    const unsubConfirmRemove = bridge.on('confirmation.remove', (data: unknown) => {
      const removal = data as PendingConfirmation;
      if (removal.conversation_id && removal.conversation_id !== conversationId) return;
      setConfirmations((prev) => prev.filter((c) => c.id !== removal.id));
      setMessages((prev) => removeConfirmationMessages(prev, removal.id));
      if (!isStreamingRef.current) {
        setCanSendMessage(true);
      }
    });

    return () => {
      unsub();
      unsubConfirmAdd();
      unsubConfirmUpdate();
      unsubConfirmRemove();
    };
  }, [
    completeActiveThinking,
    conversationId,
    drainNextQueuedCommand,
    refreshSlashCommands,
    setCanSendMessage,
    setStreamingState,
  ]);

  // Restore pending confirmations on reconnect (Issue 2)
  useEffect(() => {
    const wasDisconnected = prevConnectionStateRef.current !== 'connected';
    prevConnectionStateRef.current = connectionState;

    if (wasDisconnected && connectionState === 'connected' && conversationId) {
      void restorePendingConfirmations(conversationId);
    }
  }, [connectionState, conversationId, restorePendingConfirmations]);

  // Auto-send initial message when conversation was created via commitNewChat
  useEffect(() => {
    if (!conversationId) return;
    const pending = consumePendingInitialMessage(conversationId);
    if (!pending) return;

    executeSend(pending);
  }, [conversationId, executeSend]);

  const sendMessage = useCallback(
    (text: string, files?: string[]) => {
      if (!conversationId || !text.trim()) return;
      if (!canSendMessageRef.current || isStreamingRef.current || queuedCommandsRef.current.length > 0) {
        enqueueMessage(text, files);
        return;
      }
      executeSend(text, files);
    },
    [conversationId, enqueueMessage, executeSend],
  );

  const stopGeneration = useCallback(() => {
    if (!conversationId) return;
    suppressNextQueueDrainRef.current = true;
    turnFinishedRef.current = true;
    activeThinkingRef.current = null;
    setStreamingState(false);
    setCanSendMessage(true);
    setThought(null);
    bridge
      .request('chat.stop.stream', { conversation_id: conversationId })
      .catch((e) => console.warn('[Chat] stop stream failed:', e));
  }, [conversationId, setCanSendMessage, setStreamingState]);

  const confirmAction = useCallback(
    (confirmationId: string, callId: string, confirmKey: string) => {
      if (!conversationId) {
        return Promise.reject(new Error('No active conversation'));
      }
      return bridge
        .request('confirmation.confirm', {
          conversation_id: conversationId,
          msg_id: confirmationId,
          callId,
          data: confirmKey,
        })
        .then((response) => {
          const errorMessage = getBridgeFailureMessage(response);
          if (errorMessage) {
            throw new Error(errorMessage);
          }
        })
        .catch((e) => {
          console.warn('[Chat] confirm failed:', e);
          throw e;
        });
    },
    [conversationId],
  );

  return (
    <ChatContext.Provider
      value={{
        messages,
        isStreaming,
        canSendMessage,
        queuedCommands,
        conversationId,
        confirmations,
        contextUsage,
        slashCommands,
        thought,
        loadConversation,
        sendMessage,
        stopGeneration,
        confirmAction,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  return useContext(ChatContext);
}

function isErrorStreamMessage(message: IResponseMessage): boolean {
  if (message.type === 'error') return true;
  if (message.type !== 'tips') return false;
  return (
    typeof message.data === 'object' &&
    message.data !== null &&
    (message.data as { type?: unknown }).type === 'error'
  );
}

function normalizeContextUsage(value: unknown): { used: number; size: number } | null {
  if (typeof value !== 'object' || value === null) return null;
  const usage = value as { used?: unknown; size?: unknown };
  return typeof usage.used === 'number' && typeof usage.size === 'number'
    ? { used: usage.used, size: usage.size }
    : null;
}

function upsertConfirmation(
  confirmations: PendingConfirmation[],
  confirmation: PendingConfirmation,
): PendingConfirmation[] {
  if (!confirmation.id) return [...confirmations, confirmation];
  const index = confirmations.findIndex((item) => item.id === confirmation.id);
  if (index === -1) return [...confirmations, confirmation];
  const next = [...confirmations];
  next[index] = confirmation;
  return next;
}

function appendConfirmationMessages(
  messages: TMessage[],
  conversationId: string,
  confirmations: PendingConfirmation[],
): TMessage[] {
  let next = messages;
  const existingConfirmationIds = new Set(
    messages
      .filter((message) => message.type === 'acp_permission')
      .map((message) => (message.content as PendingConfirmation | undefined)?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );

  for (const confirmation of confirmations) {
    if (!confirmation.id || existingConfirmationIds.has(confirmation.id)) continue;
    if (next === messages) next = [...messages];
    existingConfirmationIds.add(confirmation.id);
    next.push({
      id: `confirmation_${confirmation.id}`,
      msg_id: confirmation.msg_id || confirmation.id,
      conversation_id: confirmation.conversation_id || conversationId,
      type: 'acp_permission',
      position: 'left',
      content: confirmation,
    });
  }

  return next;
}

function updateConfirmationMessages(messages: TMessage[], update: PendingConfirmation): TMessage[] {
  if (!update.id) return messages;
  let changed = false;
  const next = messages.map((message) => {
    if (!isConfirmationMessage(message)) return message;
    const content = message.content as PendingConfirmation | undefined;
    if (content?.id !== update.id) return message;
    changed = true;
    return {
      ...message,
      content: {
        ...content,
        ...update,
      },
    };
  });
  return changed ? next : messages;
}

function removeConfirmationMessages(messages: TMessage[], confirmationId: unknown): TMessage[] {
  if (typeof confirmationId !== 'string' || confirmationId.length === 0) return messages;
  const next = messages.filter((message) => {
    if (!isConfirmationMessage(message)) return true;
    return (message.content as PendingConfirmation | undefined)?.id !== confirmationId;
  });
  return next.length === messages.length ? messages : next;
}

function isConfirmationMessage(message: TMessage): boolean {
  return message.type === 'acp_permission' || message.type === 'codex_permission';
}

function isProcessingConversationStatus(status: unknown): boolean {
  return status === 'running' || status === 'waiting_confirmation';
}

function uniqueFiles(files: string[] | undefined): string[] {
  return Array.from(new Set((files ?? []).filter((file) => typeof file === 'string' && file.length > 0)));
}

function normalizeRuntimeSummary(value: unknown): RuntimeSummary | null {
  if (typeof value !== 'object' || value === null) return null;
  const runtime = value as Partial<RuntimeSummary>;
  if (!isRuntimeState(runtime.state)) return null;
  if (typeof runtime.can_send_message !== 'boolean') return null;
  if (typeof runtime.has_task !== 'boolean') return null;
  if (typeof runtime.is_processing !== 'boolean') return null;
  if (typeof runtime.pending_confirmations !== 'number') return null;
  if (runtime.turn_id !== null && typeof runtime.turn_id !== 'string') return null;
  return {
    state: runtime.state,
    can_send_message: runtime.can_send_message,
    has_task: runtime.has_task,
    ...(isConversationStatus(runtime.task_status) ? { task_status: runtime.task_status } : {}),
    is_processing: runtime.is_processing,
    pending_confirmations: runtime.pending_confirmations,
    turn_id: runtime.turn_id,
  };
}

function isProcessingRuntimeSummary(runtime: RuntimeSummary): boolean {
  return runtime.is_processing || runtime.has_task || runtime.pending_confirmations > 0 || runtime.state !== 'idle';
}

function isRuntimeState(value: unknown): value is RuntimeSummary['state'] {
  return (
    value === 'idle' ||
    value === 'starting' ||
    value === 'running' ||
    value === 'cancelling' ||
    value === 'waiting_confirmation'
  );
}

function isConversationStatus(value: unknown): value is NonNullable<RuntimeSummary['task_status']> {
  return value === 'pending' || value === 'running' || value === 'waiting_confirmation' || value === 'finished';
}

function getBridgeFailureMessage(response: unknown): string | null {
  if (typeof response !== 'object' || response === null) return null;
  const result = response as { success?: unknown; error?: unknown };
  if (result.success !== false) return null;
  if (typeof result.error === 'object' && result.error !== null) {
    const error = result.error as { message?: unknown; code?: unknown };
    if (typeof error.message === 'string' && error.message.length > 0) return error.message;
    if (typeof error.code === 'string' && error.code.length > 0) return error.code;
  }
  if (typeof result.error === 'string' && result.error.length > 0) return result.error;
  return 'Confirmation failed';
}
