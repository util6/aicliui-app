import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { bridge } from '../services/bridge';
import { consumePendingInitialMessage } from '../services/pendingInitialMessages';
import { transformMessage, composeMessage, type TMessage, type IResponseMessage } from '../utils/messageAdapter';
import { mapAvailableCommandsToSlashCommands, type SlashCommandItem } from '../utils/slashCommands';
import {
  isArtifactStatus,
  normalizeConversationArtifact,
  normalizeConversationArtifacts,
  upsertConversationArtifacts,
  type ConversationArtifact,
  type ConversationArtifactStatus,
} from '../utils/artifacts';
import { uuid } from '../utils/uuid';
import { useConnection } from './ConnectionContext';

export type ThoughtData = { subject: string; description: string } | null;

type PendingConfirmation = {
  id?: string;
  msg_id?: string;
  conversation_id?: string;
  [key: string]: unknown;
};

type UserCreatedMessage = {
  conversation_id?: unknown;
  msg_id?: unknown;
  content?: unknown;
  position?: unknown;
  status?: unknown;
  hidden?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
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

type ExecuteSendOptions = {
  onSendFailure?: () => void;
};

export type QueuedCommand = {
  id: string;
  input: string;
  files: string[];
  createdAt: number;
};

export type ChatInputDraft = {
  id: string;
  text: string;
  files: string[];
};

export type QueuedCommandMoveDirection = 'up' | 'down';
export type QueuedCommandWarningReason =
  | 'emptyInput'
  | 'inputTooLong'
  | 'tooManyFiles'
  | 'queueFull'
  | 'queueTooLarge';

type QueuedCommandState = {
  items: QueuedCommand[];
  isPaused: boolean;
};

const MAX_QUEUED_COMMANDS = 20;
const MAX_QUEUED_COMMAND_INPUT_LENGTH = 20_000;
const MAX_QUEUED_COMMAND_FILES = 50;
const MAX_QUEUED_COMMAND_STATE_BYTES = 256 * 1024;

type ChatContextType = {
  messages: TMessage[];
  isStreaming: boolean;
  canSendMessage: boolean;
  queuedCommands: QueuedCommand[];
  isQueuePaused: boolean;
  queuedCommandWarning: QueuedCommandWarningReason | null;
  queuedCommandDraft: ChatInputDraft | null;
  conversationId: string | null;
  confirmations: any[];
  artifacts: ConversationArtifact[];
  contextUsage: { used: number; size: number } | null;
  slashCommands: SlashCommandItem[];
  thought: ThoughtData;
  loadConversation: (id: string) => void;
  sendMessage: (text: string, files?: string[]) => void;
  removeQueuedCommand: (commandId: string) => void;
  editQueuedCommand: (commandId: string) => void;
  clearQueuedCommandDraft: (draftId: string) => void;
  moveQueuedCommand: (commandId: string, direction: QueuedCommandMoveDirection) => void;
  clearQueuedCommands: () => void;
  resumeQueuedCommands: () => void;
  stopGeneration: () => void;
  confirmAction: (confirmationId: string, callId: string, confirmKey: unknown) => Promise<void>;
  updateArtifactStatus: (artifactId: string, status: ConversationArtifactStatus) => Promise<void>;
};

const getQueuedCommandsStorageKey = (conversationId: string) => `chat-command-queue/${conversationId}`;

const ChatContext = createContext<ChatContextType>({
  messages: [],
  isStreaming: false,
  canSendMessage: true,
  queuedCommands: [],
  isQueuePaused: false,
  queuedCommandWarning: null,
  queuedCommandDraft: null,
  conversationId: null,
  confirmations: [],
  artifacts: [],
  contextUsage: null,
  slashCommands: [],
  thought: null,
  loadConversation: () => {},
  sendMessage: () => {},
  removeQueuedCommand: () => {},
  editQueuedCommand: () => {},
  clearQueuedCommandDraft: () => {},
  moveQueuedCommand: () => {},
  clearQueuedCommands: () => {},
  resumeQueuedCommands: () => {},
  stopGeneration: () => {},
  confirmAction: () => Promise.resolve(),
  updateArtifactStatus: () => Promise.resolve(),
});

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<TMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [canSendMessage, setCanSendMessageState] = useState(true);
  const [queuedCommands, setQueuedCommandsState] = useState<QueuedCommand[]>([]);
  const [isQueuePaused, setIsQueuePausedState] = useState(false);
  const [queuedCommandWarning, setQueuedCommandWarning] = useState<QueuedCommandWarningReason | null>(null);
  const [queuedCommandDraft, setQueuedCommandDraft] = useState<ChatInputDraft | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [confirmations, setConfirmations] = useState<any[]>([]);
  const [artifacts, setArtifacts] = useState<ConversationArtifact[]>([]);
  const [contextUsage, setContextUsage] = useState<{ used: number; size: number } | null>(null);
  const [slashCommands, setSlashCommands] = useState<SlashCommandItem[]>([]);
  const [thought, setThought] = useState<ThoughtData>(null);
  const messagesRef = useRef<TMessage[]>([]);
  const loadRequestRef = useRef(0);
  const isStreamingRef = useRef(false);
  const canSendMessageRef = useRef(true);
  const queuedCommandsRef = useRef<QueuedCommand[]>([]);
  const isQueuePausedRef = useRef(false);
  const activeConversationIdRef = useRef<string | null>(null);
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

  const setQueuedCommands = useCallback((
    next: QueuedCommand[] | ((prev: QueuedCommand[]) => QueuedCommand[]),
    options?: { persist?: boolean; conversationId?: string },
  ) => {
    const resolved = typeof next === 'function' ? next(queuedCommandsRef.current) : next;
    queuedCommandsRef.current = resolved;
    setQueuedCommandsState(resolved);

    const shouldPersist = options?.persist !== false;
    const targetConversationId = options?.conversationId ?? activeConversationIdRef.current;
    if (shouldPersist && targetConversationId) {
      void persistQueuedCommandState(targetConversationId, {
        items: resolved,
        isPaused: isQueuePausedRef.current,
      });
    }
  }, []);

  const setQueuePaused = useCallback((value: boolean, options?: { persist?: boolean; conversationId?: string }) => {
    isQueuePausedRef.current = value;
    setIsQueuePausedState(value);

    const shouldPersist = options?.persist !== false;
    const targetConversationId = options?.conversationId ?? activeConversationIdRef.current;
    if (shouldPersist && targetConversationId) {
      void persistQueuedCommandState(targetConversationId, {
        items: queuedCommandsRef.current,
        isPaused: value,
      });
    }
  }, []);

  const restoreQueuedCommands = useCallback(
    async (id: string, requestId = loadRequestRef.current) => {
      try {
        const stored = await AsyncStorage.getItem(getQueuedCommandsStorageKey(id));
        if (requestId !== loadRequestRef.current) return;
        const restored = normalizeStoredQueuedCommandState(stored);
        setQueuedCommands(restored.items, { persist: false, conversationId: id });
        setQueuePaused(restored.isPaused, { persist: false, conversationId: id });
      } catch (e) {
        console.warn('[Chat] Failed to restore queued commands:', e);
      }
    },
    [setQueuePaused, setQueuedCommands],
  );

  const executeSend = useCallback(
    (text: string, files?: string[], options?: ExecuteSendOptions) => {
      const trimmed = text.trim();
      if (!conversationId || !trimmed) return false;
      setQueuedCommandWarning(null);

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
          options?.onSendFailure?.();
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
      const item: QueuedCommand = {
        id: uuid(),
        input: trimmed,
        files: uniqueFiles(files),
        createdAt: Date.now(),
      };
      const nextState: QueuedCommandState = {
        items: [...queuedCommandsRef.current, item],
        isPaused: isQueuePausedRef.current,
      };
      const failureReason = getQueuedCommandValidationFailureReason(nextState);

      if (failureReason) {
        setQueuedCommandWarning(failureReason);
        return;
      }

      setQueuedCommandWarning(null);
      setQueuedCommands(nextState.items);
    },
    [setQueuedCommands],
  );

  const drainNextQueuedCommand = useCallback(() => {
    if (!conversationId || isQueuePausedRef.current || !canSendMessageRef.current || isStreamingRef.current) return false;
    const [next, ...rest] = queuedCommandsRef.current;
    if (!next) return false;
    setQueuedCommands(rest);
    return executeSend(next.input, next.files, {
      onSendFailure: () => {
        if (activeConversationIdRef.current !== conversationId) return;
        setQueuedCommands((current) => restoreQueuedCommand(current, next));
        setQueuePaused(true);
      },
    });
  }, [conversationId, executeSend, setQueuePaused, setQueuedCommands]);

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

  const refreshArtifacts = useCallback(async (id: string, requestId = loadRequestRef.current) => {
    try {
      const data = await bridge.request('conversation.list-artifacts', {
        conversation_id: id,
      });
      if (requestId !== loadRequestRef.current) return;
      setArtifacts(upsertConversationArtifacts([], normalizeConversationArtifacts(data)));
    } catch (e) {
      if (isMissingArtifactRouteError(e)) return;
      console.warn('[Chat] Failed to load conversation artifacts:', e);
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
    activeConversationIdRef.current = id;
    setConversationId(id);
    setMessages([]);
    setQueuedCommands([], { persist: false, conversationId: id });
    setQueuePaused(false, { persist: false, conversationId: id });
    suppressNextQueueDrainRef.current = false;
    turnFinishedRef.current = false;
    activeThinkingRef.current = null;
    setStreamingState(false);
    setCanSendMessage(true);
    setConfirmations([]);
    setArtifacts([]);
    setContextUsage(null);
    setSlashCommands([]);
    setQueuedCommandWarning(null);
    setQueuedCommandDraft(null);
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
    await refreshArtifacts(id, requestId);
    await refreshSlashCommands(id, requestId);
    await restoreQueuedCommands(id, requestId);
  }, [
    refreshArtifacts,
    refreshSlashCommands,
    restorePendingConfirmations,
    restoreQueuedCommands,
    setCanSendMessage,
    setQueuePaused,
    setQueuedCommands,
    setStreamingState,
  ]);

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
    const unsubUserCreated = bridge.on('message.userCreated', (data: unknown) => {
      const message = normalizeUserCreatedMessage(data);
      if (!message || message.conversation_id !== conversationId) return;
      setMessages((prev) => mergeUserCreatedMessage(prev, message));
    });

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

    const unsubArtifact = bridge.on('conversation.artifact', (data: unknown) => {
      const artifact = normalizeConversationArtifact(data);
      if (!artifact || artifact.conversation_id !== conversationId) return;
      setArtifacts((prev) => upsertConversationArtifacts(prev, artifact));
    });

    return () => {
      unsub();
      unsubUserCreated();
      unsubConfirmAdd();
      unsubConfirmUpdate();
      unsubConfirmRemove();
      unsubArtifact();
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

  const removeQueuedCommand = useCallback(
    (commandId: string) => {
      setQueuedCommands((prev) => prev.filter((command) => command.id !== commandId));
      setQueuePaused(false);
      setQueuedCommandWarning(null);
    },
    [setQueuePaused, setQueuedCommands],
  );

  const editQueuedCommand = useCallback(
    (commandId: string) => {
      const command = queuedCommandsRef.current.find((item) => item.id === commandId);
      if (!command) return;

      setQueuedCommandDraft({
        id: command.id,
        text: command.input,
        files: [...command.files],
      });
      setQueuedCommands((prev) => prev.filter((item) => item.id !== commandId));
      setQueuePaused(false);
      setQueuedCommandWarning(null);
    },
    [setQueuePaused, setQueuedCommands],
  );

  const clearQueuedCommandDraft = useCallback((draftId: string) => {
    setQueuedCommandDraft((current) => (current?.id === draftId ? null : current));
  }, []);

  const moveQueuedCommand = useCallback(
    (commandId: string, direction: QueuedCommandMoveDirection) => {
      const nextCommands = moveQueuedCommandInDirection(queuedCommandsRef.current, commandId, direction);
      if (nextCommands === queuedCommandsRef.current) return;
      setQueuedCommands(nextCommands);
    },
    [setQueuedCommands],
  );

  const clearQueuedCommands = useCallback(() => {
    setQueuedCommands([]);
    setQueuePaused(false);
    setQueuedCommandWarning(null);
  }, [setQueuePaused, setQueuedCommands]);

  const resumeQueuedCommands = useCallback(() => {
    setQueuePaused(false);
    setQueuedCommandWarning(null);
    drainNextQueuedCommand();
  }, [drainNextQueuedCommand, setQueuePaused]);

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
    (confirmationId: string, callId: string, confirmKey: unknown) => {
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

  const updateArtifactStatus = useCallback(
    async (artifactId: string, status: ConversationArtifactStatus) => {
      if (!conversationId || !artifactId || !isArtifactStatus(status)) return;
      const response = await bridge.request('conversation.update-artifact', {
        conversation_id: conversationId,
        artifact_id: artifactId,
        status,
      });
      const updated = normalizeConversationArtifact(response);
      if (updated && updated.conversation_id === conversationId) {
        setArtifacts((prev) => upsertConversationArtifacts(prev, updated));
        return;
      }
      setArtifacts((prev) =>
        prev.map((artifact) =>
          artifact.id === artifactId
            ? { ...artifact, status, updated_at: Date.now() }
            : artifact,
        ),
      );
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
        isQueuePaused,
        queuedCommandWarning,
        queuedCommandDraft,
        conversationId,
        confirmations,
        artifacts,
        contextUsage,
        slashCommands,
        thought,
        loadConversation,
        sendMessage,
        removeQueuedCommand,
        editQueuedCommand,
        clearQueuedCommandDraft,
        moveQueuedCommand,
        clearQueuedCommands,
        resumeQueuedCommands,
        stopGeneration,
        confirmAction,
        updateArtifactStatus,
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

function isMissingArtifactRouteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return (
    message.includes('conversation.list-artifacts') &&
    (message.includes('No bridge handler registered') || message.includes('Unexpected bridge request'))
  );
}

function normalizeUserCreatedMessage(value: unknown): TMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const payload = value as UserCreatedMessage;
  if (typeof payload.conversation_id !== 'string' || payload.conversation_id.length === 0) return null;
  if (typeof payload.msg_id !== 'string' || payload.msg_id.length === 0) return null;
  const createdAt = payload.created_at ?? payload.createdAt;
  if (typeof createdAt !== 'number') return null;

  return {
    id: payload.msg_id,
    msg_id: payload.msg_id,
    conversation_id: payload.conversation_id,
    type: 'text',
    position: 'right',
    status: payload.status === 'finish' ? 'finish' : undefined,
    hidden: payload.hidden === true,
    createdAt,
    created_at: createdAt,
    content: {
      content: typeof payload.content === 'string' ? payload.content : String(payload.content ?? ''),
    },
  };
}

function mergeUserCreatedMessage(messages: TMessage[], incoming: TMessage): TMessage[] {
  let changed = false;
  const next = messages.map((message) => {
    if (message.type !== 'text' || message.position !== 'right' || message.msg_id !== incoming.msg_id) {
      return message;
    }
    changed = true;
    return {
      ...message,
      ...incoming,
      id: message.id,
    };
  });
  return changed ? next : composeMessage(incoming, messages);
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

function restoreQueuedCommand(commands: QueuedCommand[], failedCommand: QueuedCommand): QueuedCommand[] {
  return [failedCommand, ...commands.filter((command) => command.id !== failedCommand.id)];
}

function getQueuedCommandValidationFailureReason(state: QueuedCommandState): QueuedCommandWarningReason | null {
  if (state.items.length > MAX_QUEUED_COMMANDS) {
    return 'queueFull';
  }

  if (state.items.some((item) => item.input.trim().length === 0)) {
    return 'emptyInput';
  }

  if (state.items.some((item) => item.input.length > MAX_QUEUED_COMMAND_INPUT_LENGTH)) {
    return 'inputTooLong';
  }

  if (state.items.some((item) => item.files.length > MAX_QUEUED_COMMAND_FILES)) {
    return 'tooManyFiles';
  }

  if (measureQueuedCommandStateBytes(state) > MAX_QUEUED_COMMAND_STATE_BYTES) {
    return 'queueTooLarge';
  }

  return null;
}

function measureQueuedCommandStateBytes(state: QueuedCommandState): number {
  const serialized = JSON.stringify(state);
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(serialized).length;
  }

  return serialized.length;
}

function moveQueuedCommandInDirection(
  commands: QueuedCommand[],
  commandId: string,
  direction: QueuedCommandMoveDirection,
): QueuedCommand[] {
  const currentIndex = commands.findIndex((command) => command.id === commandId);
  if (currentIndex === -1) return commands;

  const targetIndex = currentIndex + (direction === 'up' ? -1 : 1);
  if (targetIndex < 0 || targetIndex >= commands.length) return commands;

  const next = [...commands];
  const [moved] = next.splice(currentIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

async function persistQueuedCommandState(conversationId: string, state: QueuedCommandState): Promise<void> {
  try {
    const key = getQueuedCommandsStorageKey(conversationId);
    if (state.items.length === 0 && !state.isPaused) {
      await AsyncStorage.removeItem(key);
      return;
    }

    await AsyncStorage.setItem(key, JSON.stringify({
      items: state.items,
      isPaused: state.items.length > 0 ? state.isPaused : false,
    }));
  } catch (e) {
    console.warn('[Chat] Failed to persist queued commands:', e);
  }
}

function normalizeStoredQueuedCommandState(value: string | null): QueuedCommandState {
  if (!value) return { items: [], isPaused: false };

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return normalizeQueuedCommandState({ items: parsed, isPaused: false });
    }
    if (typeof parsed !== 'object' || parsed === null) return { items: [], isPaused: false };
    return normalizeQueuedCommandState(parsed);
  } catch {
    return { items: [], isPaused: false };
  }
}

function normalizeQueuedCommandState(value: unknown): QueuedCommandState {
  if (typeof value !== 'object' || value === null) return { items: [], isPaused: false };
  const state = value as Partial<QueuedCommandState>;
  const rawItems = Array.isArray(state.items) ? state.items : [];
  const items: QueuedCommand[] = [];

  for (const rawItem of rawItems) {
    if (items.length >= MAX_QUEUED_COMMANDS) break;
    const item = normalizeStoredQueuedCommand(rawItem);
    if (!item) continue;
    const nextState = {
      items: [...items, item],
      isPaused: state.isPaused === true,
    };
    if (measureQueuedCommandStateBytes(nextState) > MAX_QUEUED_COMMAND_STATE_BYTES) break;
    items.push(item);
  }

  return {
    items,
    isPaused: items.length > 0 ? state.isPaused === true : false,
  };
}

function normalizeStoredQueuedCommand(value: unknown): QueuedCommand | null {
  if (typeof value !== 'object' || value === null) return null;
  const command = value as Partial<QueuedCommand>;
  if (typeof command.id !== 'string' || command.id.length === 0) return null;
  if (typeof command.input !== 'string') return null;
  if (!Array.isArray(command.files)) return null;
  if (typeof command.createdAt !== 'number' || !Number.isFinite(command.createdAt)) return null;

  const input = command.input.trim();
  if (!input) return null;
  if (input.length > MAX_QUEUED_COMMAND_INPUT_LENGTH) return null;

  const files = uniqueFiles(command.files);
  if (files.length > MAX_QUEUED_COMMAND_FILES) return null;

  return {
    id: command.id,
    input,
    files,
    createdAt: command.createdAt,
  };
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
