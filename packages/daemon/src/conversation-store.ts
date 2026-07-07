import type { Conversation, ConversationArtifact, ConversationArtifactStatus } from '@aicliui/shared';

type Clock = () => number;
type IdGenerator = () => string;

export type StoredMessage = {
  id: string;
  msg_id: string;
  conversation_id: string;
  type: 'text';
  position: 'left' | 'right';
  content: { content: string };
  createdAt: number;
};

export type CreateConversationInput = {
  type?: string;
  name?: string;
  model?: { id: string; useModel: string };
  extra?: Conversation['extra'];
};

export class InMemoryConversationStore {
  private readonly conversations = new Map<string, Conversation>();
  private readonly messages = new Map<string, StoredMessage[]>();
  private readonly artifacts = new Map<string, ConversationArtifact[]>();
  private readonly now: Clock;
  private readonly id: IdGenerator;

  constructor(options?: { now?: Clock; id?: IdGenerator }) {
    this.now = options?.now ?? Date.now;
    this.id = options?.id ?? randomId;
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
    return updated;
  }

  addTextMessage(input: {
    conversationId: string;
    msgId?: string;
    position: StoredMessage['position'];
    content: string;
  }): StoredMessage {
    const conversation = this.requireConversation(input.conversationId);
    const timestamp = this.now();
    const message: StoredMessage = {
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
    return message;
  }

  removeConversation(id: string): boolean {
    const existed = this.conversations.delete(id);
    this.messages.delete(id);
    this.artifacts.delete(id);
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
    return true;
  }

  private requireConversation(id: string): Conversation {
    const conversation = this.conversations.get(id);
    if (!conversation) {
      throw new Error(`Conversation '${id}' was not found`);
    }
    return conversation;
  }
}

function randomId(): string {
  return `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
