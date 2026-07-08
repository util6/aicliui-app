/**
 * Message adapter: converts IResponseMessage from WebSocket to TMessage for UI.
 * This is a simplified port of src/common/chatLib.ts transformMessage + composeMessage.
 * We avoid importing chatLib directly to avoid potential Metro resolution issues
 * with its import chain. Instead, we replicate the core logic.
 */

import { uuid } from './uuid';

// Simplified TMessage types for mobile rendering
export type TMessageType =
  | 'text'
  | 'tips'
  | 'tool_call'
  | 'tool_group'
  | 'agent_status'
  | 'acp_permission'
  | 'acp_tool_call'
  | 'codex_permission'
  | 'codex_tool_call'
  | 'plan'
  | 'thinking';

export type TMessage = {
  id: string;
  msg_id?: string;
  conversation_id: string;
  type: TMessageType;
  content: any;
  createdAt?: number;
  created_at?: number;
  position?: 'left' | 'right' | 'center' | 'pop';
  status?: 'finish' | 'pending' | 'error' | 'work';
  hidden?: boolean;
};

export type IResponseMessage = {
  type: string;
  data: unknown;
  msg_id: string;
  conversation_id: string;
  createdAt?: number;
  created_at?: number;
  position?: 'left' | 'right' | 'center' | 'pop';
  status?: 'finish' | 'pending' | 'error' | 'work';
  replace?: boolean;
  hidden?: boolean;
};

/**
 * Transform a raw WebSocket IResponseMessage into a renderable TMessage.
 */
export function transformMessage(message: IResponseMessage): TMessage | undefined {
  const createdAt = message.createdAt ?? message.created_at ?? Date.now();
  const withMetadata = <T extends TMessage>(value: T): T => ({
    ...value,
    createdAt,
    created_at: createdAt,
    ...(message.hidden ? { hidden: true } : {}),
  });

  switch (message.type) {
    case 'error': {
      const error = normalizeErrorPayload(message.data);
      return withMetadata({
        id: uuid(),
        type: 'tips',
        msg_id: message.msg_id,
        position: 'center',
        conversation_id: message.conversation_id,
        content: {
          content: error.message,
          type: 'error',
          ...(error.error ? { error: error.error } : {}),
        },
      });
    }

    case 'tips': {
      const data = isRecord(message.data) ? message.data : { content: String(message.data ?? '') };
      const tipType = isTipType(data.type) ? data.type : 'warning';
      const structuredError =
        tipType === 'error' ? normalizeErrorPayload(data.error ?? { ...data, message: data.content }).error : undefined;

      return withMetadata({
        id: uuid(),
        type: 'tips',
        msg_id: message.msg_id,
        position: 'center',
        conversation_id: message.conversation_id,
        content: {
          content: typeof data.content === 'string' ? data.content : String(data.content ?? ''),
          type: tipType,
          ...(typeof data.code === 'string' ? { code: data.code } : {}),
          ...(isRecord(data.params) ? { params: data.params } : {}),
          ...(structuredError ? { error: structuredError } : {}),
        },
      });
    }

    case 'text':
    case 'content':
    case 'user_content': {
      const data = message.data;
      const position =
        message.position ??
        (message.type === 'user_content' ? 'right' : 'left');
      return withMetadata({
        id: uuid(),
        type: 'text',
        msg_id: message.msg_id,
        position,
        ...(message.status ? { status: message.status } : {}),
        conversation_id: message.conversation_id,
        content: normalizeTextContent(data, message.replace),
      });
    }

    case 'tool_call':
      return withMetadata({
        id: uuid(),
        type: 'tool_call',
        msg_id: message.msg_id,
        conversation_id: message.conversation_id,
        position: 'left',
        content: message.data,
      });

    case 'tool_group':
      return withMetadata({
        id: uuid(),
        type: 'tool_group',
        msg_id: message.msg_id,
        conversation_id: message.conversation_id,
        content: message.data,
      });

    case 'agent_status':
      return withMetadata({
        id: uuid(),
        type: 'agent_status',
        msg_id: message.msg_id,
        position: 'center',
        conversation_id: message.conversation_id,
        content: message.data,
      });

    case 'acp_permission':
      return withMetadata({
        id: uuid(),
        type: 'acp_permission',
        msg_id: message.msg_id,
        position: 'left',
        conversation_id: message.conversation_id,
        content: message.data,
      });

    case 'acp_tool_call':
      return withMetadata({
        id: uuid(),
        type: 'acp_tool_call',
        msg_id: message.msg_id,
        position: 'left',
        conversation_id: message.conversation_id,
        content: message.data,
      });

    case 'codex_permission':
      return withMetadata({
        id: uuid(),
        type: 'codex_permission',
        msg_id: message.msg_id,
        position: 'left',
        conversation_id: message.conversation_id,
        content: message.data,
      });

    case 'codex_tool_call':
      return withMetadata({
        id: uuid(),
        type: 'codex_tool_call',
        msg_id: message.msg_id,
        position: 'left',
        conversation_id: message.conversation_id,
        content: message.data,
      });

    case 'plan':
      return withMetadata({
        id: uuid(),
        type: 'plan',
        msg_id: message.msg_id,
        position: 'left',
        conversation_id: message.conversation_id,
        content: message.data,
      });

    case 'thinking': {
      const data = isRecord(message.data) ? message.data : { content: String(message.data ?? '') };
      return withMetadata({
        id: uuid(),
        type: 'thinking',
        msg_id: message.msg_id,
        position: 'left',
        conversation_id: message.conversation_id,
        content: {
          content: typeof data.content === 'string' ? data.content : '',
          ...(typeof data.subject === 'string' ? { subject: data.subject } : {}),
          ...(typeof data.duration === 'number'
            ? { duration: data.duration }
            : typeof data.duration_ms === 'number'
              ? { duration: data.duration_ms }
              : {}),
          status: data.status === 'done' ? 'done' : 'thinking',
        },
      });
    }

    // Ignored types (same as chatLib.ts)
    case 'thought':
    case 'start':
    case 'finish':
    case 'system':
    case 'acp_model_info':
    case 'codex_model_info':
    case 'acp_context_usage':
    case 'request_trace':
    case 'available_commands':
      return undefined;

    default:
      return undefined;
  }
}

/**
 * Compose/merge a new message into the message list.
 * Handles streaming text concatenation and tool call merging.
 */
export function composeMessage(message: TMessage | undefined, list: TMessage[]): TMessage[] {
  if (!message) return list;
  if (!list.length) return [message];

  const last = list[list.length - 1];

  // Tool group merging by callId
  if (message.type === 'tool_group' && Array.isArray(message.content)) {
    const remainingMap = new Map<string, any>();
    const unkeyedTools: any[] = [];

    for (const tool of message.content) {
      const key = getToolGroupCallId(tool);
      if (key) {
        remainingMap.set(key, tool);
      } else {
        unkeyedTools.push(tool);
      }
    }

    if (remainingMap.size === 0 && unkeyedTools.length === 0) return list;

    let didUpdate = false;
    const updatedList = list.map((existingMsg) => {
      if (existingMsg.type !== 'tool_group' || !Array.isArray(existingMsg.content)) return existingMsg;

      let merged = false;
      const newContent = existingMsg.content.map((tool: any) => {
        const key = getToolGroupCallId(tool);
        if (!key) return tool;
        const update = remainingMap.get(key);
        if (!update) return tool;
        merged = true;
        remainingMap.delete(key);
        return { ...tool, ...update };
      });

      if (!merged) return existingMsg;
      didUpdate = true;
      return { ...existingMsg, content: newContent };
    });

    const base = didUpdate ? updatedList : list;
    if (remainingMap.size > 0 || unkeyedTools.length > 0) {
      return [...base, { ...message, content: [...Array.from(remainingMap.values()), ...unkeyedTools] }];
    }
    return didUpdate ? base : list;
  }

  // Tool call merging by callId
  if (message.type === 'tool_call') {
    const incomingCallId = message.content.callId ?? message.content.call_id;
    for (let i = 0; i < list.length; i++) {
      const msg = list[i];
      if (msg.type === 'tool_call' && incomingCallId && (msg.content.callId ?? msg.content.call_id) === incomingCallId) {
        const updated = [...list];
        updated[i] = { ...msg, content: { ...msg.content, ...message.content } };
        return updated;
      }
    }
    return [...list, message];
  }

  // Codex/ACP tool call merging
  if (message.type === 'codex_tool_call') {
    for (let i = 0; i < list.length; i++) {
      const msg = list[i];
      if (msg.type === 'codex_tool_call' && msg.content.toolCallId === message.content.toolCallId) {
        const updated = [...list];
        updated[i] = { ...msg, content: { ...msg.content, ...message.content } };
        return updated;
      }
    }
    return [...list, message];
  }

  if (message.type === 'acp_tool_call') {
    const incomingToolCallId = message.content.update?.toolCallId ?? message.content.update?.tool_call_id;
    for (let i = 0; i < list.length; i++) {
      const msg = list[i];
      const existingToolCallId = msg.content.update?.toolCallId ?? msg.content.update?.tool_call_id;
      if (msg.type === 'acp_tool_call' && incomingToolCallId && existingToolCallId === incomingToolCallId) {
        const updated = [...list];
        updated[i] = { ...msg, content: { ...msg.content, ...message.content } };
        return updated;
      }
    }
    return [...list, message];
  }

  // Plan merging by sessionId
  if (message.type === 'plan') {
    const incomingSessionId = message.content.sessionId ?? message.content.session_id;
    for (let i = 0; i < list.length; i++) {
      const msg = list[i];
      const existingSessionId = msg.content.sessionId ?? msg.content.session_id;
      if (msg.type === 'plan' && incomingSessionId && existingSessionId === incomingSessionId) {
        const updated = [...list];
        updated[i] = { ...msg, content: { ...msg.content, ...message.content } };
        return updated;
      }
    }
    return [...list, message];
  }

  if (message.type === 'thinking') {
    const incomingSubject = getThinkingSubject(message);

    if (message.content.status === 'done') {
      for (let i = list.length - 1; i >= 0; i--) {
        const msg = list[i];
        if (msg.type !== 'thinking' || msg.msg_id !== message.msg_id) continue;
        if (incomingSubject && getThinkingSubject(msg) !== incomingSubject) continue;
        const updated = [...list];
        updated[i] = {
          ...msg,
          content: {
            ...msg.content,
            status: 'done',
            ...(message.content.duration !== undefined ? { duration: message.content.duration } : {}),
            ...(incomingSubject ? { subject: incomingSubject } : {}),
          },
        };
        return updated;
      }
      return list;
    }

    if (
      last.type === 'thinking' &&
      last.msg_id === message.msg_id &&
      last.content.status !== 'done' &&
      thinkingSubjectsCanMerge(getThinkingSubject(last), incomingSubject)
    ) {
      const updated = [...list];
      updated[updated.length - 1] = {
        ...last,
        content: {
          ...last.content,
          ...message.content,
          content: String(last.content.content || '') + String(message.content.content || ''),
          subject: message.content.subject || last.content.subject,
        },
      };
      return updated;
    }
    return [...list, message];
  }

  // Text streaming: concat if same msg_id and type
  if (last.msg_id !== message.msg_id || last.type !== message.type) {
    return [...list, message];
  }

  if (message.type === 'text' && last.type === 'text') {
    if (message.content.replace === true) {
      const updated = [...list];
      updated[updated.length - 1] = {
        ...last,
        ...message,
        id: last.id,
        content: { ...message.content },
      };
      return updated;
    }

    const merged = {
      ...last,
      ...message,
      id: last.id,
      content: {
        ...message.content,
        content: last.content.content + message.content.content,
      },
    };
    const updated = [...list];
    updated[updated.length - 1] = merged;
    return updated;
  }

  const updated = [...list];
  updated[updated.length - 1] = { ...last, ...message, id: last.id };
  return updated;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTipType(value: unknown): value is 'error' | 'info' | 'success' | 'warning' {
  return value === 'error' || value === 'info' || value === 'success' || value === 'warning';
}

function getToolGroupCallId(tool: unknown): string | undefined {
  if (!isRecord(tool)) return undefined;
  const value = tool.callId ?? tool.call_id;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getThinkingSubject(message: TMessage): string | undefined {
  const value = message.content?.subject;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function thinkingSubjectsCanMerge(existingSubject: string | undefined, incomingSubject: string | undefined): boolean {
  return !existingSubject || !incomingSubject || existingSubject === incomingSubject;
}

function normalizeErrorPayload(value: unknown): { message: string; error?: Record<string, unknown> } {
  if (typeof value === 'string') return { message: value };
  if (!isRecord(value)) return { message: String(value ?? '') };

  const message = typeof value.message === 'string' ? value.message : JSON.stringify(value);
  return {
    message,
    error: { ...value, message },
  };
}

function normalizeTextContent(data: unknown, replace?: boolean): { content: string; replace?: boolean } {
  if (isRecord(data) && 'content' in data) {
    return {
      ...data,
      content: typeof data.content === 'string' ? data.content : String(data.content ?? ''),
      ...(replace === true || data.replace === true ? { replace: true } : {}),
    };
  }

  return {
    content: typeof data === 'string' ? data : String(data ?? ''),
    ...(replace === true ? { replace: true } : {}),
  };
}
