import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { bridge } from '../services/bridge';
import { consumePendingInitialMessage } from '../services/pendingInitialMessages';
import { transformMessage, composeMessage, type TMessage, type IResponseMessage } from '../utils/messageAdapter';
import { mapAvailableCommandsToSlashCommands, type SlashCommandItem } from '../utils/slashCommands';
import { uuid } from '../utils/uuid';
import { useConnection } from './ConnectionContext';

export type ThoughtData = { subject: string; description: string } | null;

type ChatContextType = {
  messages: TMessage[];
  isStreaming: boolean;
  conversationId: string | null;
  confirmations: any[];
  contextUsage: { used: number; size: number } | null;
  slashCommands: SlashCommandItem[];
  thought: ThoughtData;
  loadConversation: (id: string) => void;
  sendMessage: (text: string, files?: string[]) => void;
  stopGeneration: () => void;
  confirmAction: (confirmationId: string, callId: string, confirmKey: string) => void;
};

const ChatContext = createContext<ChatContextType>({
  messages: [],
  isStreaming: false,
  conversationId: null,
  confirmations: [],
  contextUsage: null,
  slashCommands: [],
  thought: null,
  loadConversation: () => {},
  sendMessage: () => {},
  stopGeneration: () => {},
  confirmAction: () => {},
});

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<TMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [confirmations, setConfirmations] = useState<any[]>([]);
  const [contextUsage, setContextUsage] = useState<{ used: number; size: number } | null>(null);
  const [slashCommands, setSlashCommands] = useState<SlashCommandItem[]>([]);
  const [thought, setThought] = useState<ThoughtData>(null);
  const messagesRef = useRef<TMessage[]>([]);
  const loadRequestRef = useRef(0);
  const isStreamingRef = useRef(false);
  const turnFinishedRef = useRef(false);
  const activeThinkingRef = useRef<{ msgId: string; startedAt: number } | null>(null);
  const { connectionState } = useConnection();
  const prevConnectionStateRef = useRef(connectionState);

  const setStreamingState = useCallback((value: boolean) => {
    isStreamingRef.current = value;
    setIsStreaming(value);
  }, []);

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

  // Load message history
  const loadConversation = useCallback(async (id: string) => {
    const requestId = ++loadRequestRef.current;
    setConversationId(id);
    setMessages([]);
    turnFinishedRef.current = false;
    activeThinkingRef.current = null;
    setStreamingState(false);
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

    await refreshSlashCommands(id, requestId);
  }, [refreshSlashCommands, setStreamingState]);

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
        return;
      }
      if (raw.type === 'finish') {
        completeActiveThinking(raw);
        turnFinishedRef.current = true;
        setStreamingState(false);
        setThought(null);
        return;
      }

      if (isErrorStreamMessage(raw)) {
        completeActiveThinking(raw);
        turnFinishedRef.current = true;
        setStreamingState(false);
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
      const confirmation = data as any;
      if (confirmation.conversation_id !== conversationId) return;
      setConfirmations((prev) => [...prev, confirmation]);

      // Also inject as acp_permission message for inline rendering
      const permMsg: TMessage = {
        id: uuid(),
        msg_id: confirmation.msg_id,
        conversation_id: conversationId,
        type: 'acp_permission',
        position: 'left',
        content: confirmation,
      };
      setMessages((prev) => [...prev, permMsg]);
    });

    const unsubConfirmUpdate = bridge.on('confirmation.update', (data: unknown) => {
      const update = data as any;
      setConfirmations((prev) => prev.map((c) => (c.id === update.id ? { ...c, ...update } : c)));
    });

    const unsubConfirmRemove = bridge.on('confirmation.remove', (data: unknown) => {
      const removal = data as any;
      setConfirmations((prev) => prev.filter((c) => c.id !== removal.id));
    });

    return () => {
      unsub();
      unsubConfirmAdd();
      unsubConfirmUpdate();
      unsubConfirmRemove();
    };
  }, [completeActiveThinking, conversationId, refreshSlashCommands, setStreamingState]);

  // Restore pending confirmations on reconnect (Issue 2)
  useEffect(() => {
    const wasDisconnected = prevConnectionStateRef.current !== 'connected';
    prevConnectionStateRef.current = connectionState;

    if (wasDisconnected && connectionState === 'connected' && conversationId) {
      bridge
        .request<any[]>('confirmation.list', { conversation_id: conversationId })
        .then((list) => {
          if (Array.isArray(list)) {
            setConfirmations(list);
          }
        })
        .catch((e) => console.warn('[Chat] Failed to restore confirmations:', e));
    }
  }, [connectionState, conversationId]);

  // Auto-send initial message when conversation was created via commitNewChat
  useEffect(() => {
    if (!conversationId) return;
    const pending = consumePendingInitialMessage(conversationId);
    if (!pending) return;

    const msgId = uuid();
    const userMsg: TMessage = {
      id: uuid(),
      msg_id: msgId,
      conversation_id: conversationId,
      type: 'text',
      position: 'right',
      content: { content: pending },
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    turnFinishedRef.current = false;

    bridge
      .request('chat.send.message', {
        input: pending,
        msg_id: msgId,
        conversation_id: conversationId,
      })
      .catch((e) => console.warn('[Chat] initial send failed:', e));
  }, [conversationId]);

  const sendMessage = useCallback(
    (text: string, files?: string[]) => {
      if (!conversationId || !text.trim()) return;

      const msgId = uuid();

      // Optimistic insert for user message
      const userMsg: TMessage = {
        id: uuid(),
        msg_id: msgId,
        conversation_id: conversationId,
        type: 'text',
        position: 'right',
        content: { content: text },
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      turnFinishedRef.current = false;

      // Send via bridge
      bridge
        .request('chat.send.message', {
          input: text,
          msg_id: msgId,
          conversation_id: conversationId,
          ...(files?.length ? { files } : {}),
        })
        .catch((e) => console.warn('[Chat] send failed:', e));
    },
    [conversationId],
  );

  const stopGeneration = useCallback(() => {
    if (!conversationId) return;
    turnFinishedRef.current = true;
    activeThinkingRef.current = null;
    setStreamingState(false);
    setThought(null);
    bridge
      .request('chat.stop.stream', { conversation_id: conversationId })
      .catch((e) => console.warn('[Chat] stop stream failed:', e));
  }, [conversationId, setStreamingState]);

  const confirmAction = useCallback(
    (confirmationId: string, callId: string, confirmKey: string) => {
      if (!conversationId) return;
      bridge
        .request('confirmation.confirm', {
          conversation_id: conversationId,
          msg_id: confirmationId,
          callId,
          data: confirmKey,
        })
        .catch((e) => console.warn('[Chat] confirm failed:', e));
    },
    [conversationId],
  );

  return (
    <ChatContext.Provider
      value={{
        messages,
        isStreaming,
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
