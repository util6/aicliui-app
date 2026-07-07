import type { Conversation } from '@aicliui/shared';

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
      createTime: timestamp,
      modifyTime: timestamp,
      model: input.model || { id: '', useModel: '' },
      extra: input.extra || {},
    };
    this.conversations.set(conversation.id, conversation);
    this.messages.set(conversation.id, []);
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
