import type { Conversation, ConversationArtifact, ConversationArtifactStatus } from '@aicliui/shared';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

type Clock = () => number;
type IdGenerator = () => string;
type StoreOptions = {
  now?: Clock;
  id?: IdGenerator;
  initialSnapshot?: ConversationStoreSnapshot;
};

type StoredMessageBase = {
  id: string;
  msg_id: string;
  conversation_id: string;
  type: string;
  position?: 'left' | 'right' | 'center' | 'pop';
  content: unknown;
  createdAt: number;
};

export type StoredTextMessage = StoredMessageBase & {
  type: 'text';
  position: 'left' | 'right';
  content: { content: string };
};

export type StoredStructuredMessage = StoredMessageBase & {
  type: 'tool_call' | 'tool_group' | 'acp_tool_call' | 'codex_tool_call' | 'plan';
};

export type StoredMessage = StoredTextMessage | StoredStructuredMessage;

export type CreateConversationInput = {
  type?: string;
  name?: string;
  model?: { id: string; useModel: string };
  extra?: Conversation['extra'];
};

export type ConversationStoreSnapshot = {
  version: 1;
  conversations: Conversation[];
  messages: Record<string, StoredMessage[]>;
  artifacts: Record<string, ConversationArtifact[]>;
};

export class InMemoryConversationStore {
  private readonly conversations = new Map<string, Conversation>();
  private readonly messages = new Map<string, StoredMessage[]>();
  private readonly artifacts = new Map<string, ConversationArtifact[]>();
  private readonly now: Clock;
  private readonly id: IdGenerator;

  constructor(options?: StoreOptions) {
    this.now = options?.now ?? Date.now;
    this.id = options?.id ?? randomId;
    if (options?.initialSnapshot) {
      this.restoreSnapshot(options.initialSnapshot);
    }
  }

  createConversation(input: CreateConversationInput): Conversation {
    const timestamp = this.now();
    const conversation: Conversation = {
      id: this.id(),
      name: input.name?.trim() || 'New conversation',
      type: input.type || 'acp',
      status: 'finished',
      runtime: {
        state: 'idle',
        can_send_message: true,
        has_task: false,
        task_status: 'finished',
        is_processing: false,
        pending_confirmations: 0,
        turn_id: null,
      },
      createTime: timestamp,
      modifyTime: timestamp,
      model: input.model || { id: '', useModel: '' },
      extra: input.extra || {},
    };
    this.conversations.set(conversation.id, conversation);
    this.messages.set(conversation.id, []);
    this.artifacts.set(conversation.id, []);
    this.didMutate();
    return conversation;
  }

  listConversations(page = 0, pageSize = 100): Conversation[] {
    const start = Math.max(0, page) * Math.max(1, pageSize);
    const end = start + Math.max(1, pageSize);
    return [...this.conversations.values()]
      .sort((a, b) => b.modifyTime - a.modifyTime)
      .slice(start, end);
  }

  getMessages(conversationId: string): StoredMessage[] {
    return [...(this.messages.get(conversationId) ?? [])];
  }

  getConversation(conversationId: string): Conversation | undefined {
    return this.conversations.get(conversationId);
  }

  listArtifacts(conversationId: string): ConversationArtifact[] {
    this.requireConversation(conversationId);
    return [...(this.artifacts.get(conversationId) ?? [])].sort((a, b) => a.created_at - b.created_at);
  }

  upsertArtifact(artifact: ConversationArtifact): ConversationArtifact {
    this.requireConversation(artifact.conversation_id);
    const current = this.artifacts.get(artifact.conversation_id) ?? [];
    const index = current.findIndex((candidate) => candidate.id === artifact.id);
    const next = [...current];
    if (index === -1) {
      next.push(artifact);
    } else {
      next[index] = artifact;
    }
    this.artifacts.set(artifact.conversation_id, next);
    this.didMutate();
    return artifact;
  }

  updateArtifactStatus(
    conversationId: string,
    artifactId: string,
    status: ConversationArtifactStatus,
  ): ConversationArtifact | null {
    this.requireConversation(conversationId);
    const current = this.artifacts.get(conversationId) ?? [];
    const index = current.findIndex((artifact) => artifact.id === artifactId);
    if (index === -1) return null;

    const updated: ConversationArtifact = {
      ...current[index],
      status,
      updated_at: this.now(),
    };
    const next = [...current];
    next[index] = updated;
    this.artifacts.set(conversationId, next);
    this.didMutate();
    return updated;
  }

  addTextMessage(input: {
    conversationId: string;
    msgId?: string;
    position: StoredTextMessage['position'];
    content: string;
  }): StoredTextMessage {
    const conversation = this.requireConversation(input.conversationId);
    const timestamp = this.now();
    const message: StoredTextMessage = {
      id: this.id(),
      msg_id: input.msgId || this.id(),
      conversation_id: input.conversationId,
      type: 'text',
      position: input.position,
      content: { content: input.content },
      createdAt: timestamp,
    };
    this.messages.get(input.conversationId)?.push(message);
    conversation.modifyTime = timestamp;
    this.didMutate();
    return message;
  }

  upsertToolGroupMessage(input: {
    conversationId: string;
    msgId: string;
    tool: unknown;
  }): StoredStructuredMessage | null {
    const tool = isRecord(input.tool) ? input.tool : null;
    const callId = tool && typeof tool.callId === 'string' ? tool.callId : null;
    if (!tool || !callId) return null;
    const conversation = this.requireConversation(input.conversationId);
    const list = this.messages.get(input.conversationId) ?? [];
    const timestamp = this.now();

    for (const message of list) {
      if (message.type !== 'tool_group' || !Array.isArray(message.content)) continue;
      const toolIndex = message.content.findIndex(
        (candidate) => isRecord(candidate) && candidate.callId === callId,
      );
      if (toolIndex === -1) continue;
      const current = message.content[toolIndex];
      message.content[toolIndex] = isRecord(current) ? { ...current, ...tool } : tool;
      conversation.modifyTime = timestamp;
      this.didMutate();
      return message;
    }

    const message: StoredStructuredMessage = {
      id: this.id(),
      msg_id: input.msgId,
      conversation_id: input.conversationId,
      type: 'tool_group',
      content: [tool],
      createdAt: timestamp,
    };
    list.push(message);
    this.messages.set(input.conversationId, list);
    conversation.modifyTime = timestamp;
    this.didMutate();
    return message;
  }

  upsertStructuredMessage(input: {
    conversationId: string;
    msgId: string;
    type: Exclude<StoredStructuredMessage['type'], 'tool_group'>;
    content: unknown;
    identityKeys: string[];
  }): StoredStructuredMessage | null {
    const content = isRecord(input.content) ? input.content : null;
    const identity = content ? firstStringProperty(content, input.identityKeys) : null;
    if (!content || !identity) return null;
    const conversation = this.requireConversation(input.conversationId);
    const list = this.messages.get(input.conversationId) ?? [];
    const timestamp = this.now();

    for (const message of list) {
      if (message.type !== input.type || !isRecord(message.content)) continue;
      if (firstStringProperty(message.content, input.identityKeys) !== identity) continue;
      message.content = { ...message.content, ...content };
      conversation.modifyTime = timestamp;
      this.didMutate();
      return message;
    }

    const message: StoredStructuredMessage = {
      id: this.id(),
      msg_id: input.msgId,
      conversation_id: input.conversationId,
      type: input.type,
      position: 'left',
      content,
      createdAt: timestamp,
    };
    list.push(message);
    this.messages.set(input.conversationId, list);
    conversation.modifyTime = timestamp;
    this.didMutate();
    return message;
  }

  removeConversation(id: string): boolean {
    const existed = this.conversations.delete(id);
    this.messages.delete(id);
    this.artifacts.delete(id);
    if (existed) this.didMutate();
    return existed;
  }

  updateConversation(id: string, updates: Partial<Conversation>): boolean {
    const conversation = this.conversations.get(id);
    if (!conversation) return false;
    this.conversations.set(id, {
      ...conversation,
      ...updates,
      extra: updates.extra ? { ...conversation.extra, ...updates.extra } : conversation.extra,
      modifyTime: this.now(),
    });
    this.didMutate();
    return true;
  }

  exportSnapshot(): ConversationStoreSnapshot {
    return {
      version: 1,
      conversations: [...this.conversations.values()],
      messages: Object.fromEntries(this.messages.entries()),
      artifacts: Object.fromEntries(this.artifacts.entries()),
    };
  }

  protected didMutate(): void {}

  private restoreSnapshot(snapshot: ConversationStoreSnapshot): void {
    for (const rawConversation of snapshot.conversations) {
      if (!isConversation(rawConversation)) continue;
      const conversation = normalizeRestoredConversation(rawConversation);
      this.conversations.set(conversation.id, conversation);
      this.messages.set(conversation.id, validMessages(snapshot.messages[conversation.id], conversation.id));
      this.artifacts.set(conversation.id, validArtifacts(snapshot.artifacts[conversation.id], conversation.id));
    }
  }

  private requireConversation(id: string): Conversation {
    const conversation = this.conversations.get(id);
    if (!conversation) {
      throw new Error(`Conversation '${id}' was not found`);
    }
    return conversation;
  }
}

export class JsonConversationStore extends InMemoryConversationStore {
  private readonly filePath: string;

  constructor(filePath: string, options?: Omit<StoreOptions, 'initialSnapshot'>) {
    super({ ...options, initialSnapshot: readSnapshot(filePath) });
    this.filePath = filePath;
  }

  protected override didMutate(): void {
    const directory = dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(this.exportSnapshot(), null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      renameSync(temporaryPath, this.filePath);
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }
}

function readSnapshot(filePath: string): ConversationStoreSnapshot | undefined {
  try {
    const value = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    return isConversationStoreSnapshot(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isConversationStoreSnapshot(value: unknown): value is ConversationStoreSnapshot {
  if (!isRecord(value) || value.version !== 1) return false;
  return Array.isArray(value.conversations) && isRecord(value.messages) && isRecord(value.artifacts);
}

function isConversation(value: unknown): value is Conversation {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.createTime === 'number' &&
    typeof value.modifyTime === 'number' &&
    isRecord(value.model) &&
    isRecord(value.extra)
  );
}

function validMessages(value: unknown, conversationId: string): StoredMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter((message): message is StoredMessage => isStoredMessage(message, conversationId));
}

function isStoredMessage(value: unknown, conversationId: string): value is StoredMessage {
  if (
    !isRecord(value) ||
    value.conversation_id !== conversationId ||
    typeof value.id !== 'string' ||
    typeof value.msg_id !== 'string' ||
    typeof value.type !== 'string' ||
    typeof value.createdAt !== 'number'
  ) {
    return false;
  }
  if (value.type === 'text') {
    return (
      (value.position === 'left' || value.position === 'right') &&
      isRecord(value.content) &&
      typeof value.content.content === 'string'
    );
  }
  if (value.type === 'tool_group') return Array.isArray(value.content);
  if (
    value.type === 'tool_call' ||
    value.type === 'acp_tool_call' ||
    value.type === 'codex_tool_call' ||
    value.type === 'plan'
  ) {
    return isRecord(value.content);
  }
  return false;
}

function validArtifacts(value: unknown, conversationId: string): ConversationArtifact[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (artifact): artifact is ConversationArtifact =>
      isRecord(artifact) &&
      artifact.conversation_id === conversationId &&
      typeof artifact.id === 'string' &&
      (artifact.kind === 'cron_trigger' || artifact.kind === 'skill_suggest') &&
      (artifact.status === 'active' ||
        artifact.status === 'pending' ||
        artifact.status === 'dismissed' ||
        artifact.status === 'saved') &&
      isRecord(artifact.payload) &&
      typeof artifact.created_at === 'number' &&
      typeof artifact.updated_at === 'number',
  );
}

function normalizeRestoredConversation(conversation: Conversation): Conversation {
  const runtime = conversation.runtime;
  const wasInterrupted =
    conversation.status === 'running' ||
    conversation.status === 'waiting_confirmation' ||
    Boolean(runtime && (runtime.state !== 'idle' || runtime.is_processing || runtime.has_task));
  if (!wasInterrupted) return conversation;

  return {
    ...conversation,
    status: 'finished',
    runtime: {
      state: 'idle',
      can_send_message: true,
      has_task: false,
      task_status: 'finished',
      is_processing: false,
      pending_confirmations: 0,
      turn_id: null,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function firstStringProperty(value: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (typeof value[key] === 'string' && value[key]) return value[key];
  }
  return null;
}

function randomId(): string {
  return `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
