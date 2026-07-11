import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonConversationStore } from './conversation-store.js';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('JsonConversationStore', () => {
  it('restores conversations, messages, and artifacts after a restart', () => {
    const storePath = createStorePath();
    const store = new JsonConversationStore(storePath, {
      now: () => 1000,
      id: sequentialIds('conversation-1', 'message-1'),
    });
    const conversation = store.createConversation({
      name: 'Persistent task',
      extra: { backend: 'codex', workspace: '/tmp/project' },
    });
    store.addTextMessage({
      conversationId: conversation.id,
      msgId: 'user-1',
      position: 'right',
      content: 'Inspect the project',
    });
    store.upsertArtifact({
      id: 'artifact-1',
      conversation_id: conversation.id,
      kind: 'skill_suggest',
      status: 'pending',
      payload: {
        cron_job_id: 'job-1',
        name: 'Project review',
        description: 'Review the current workspace',
      },
      created_at: 1000,
      updated_at: 1000,
    });
    store.updateArtifactStatus(conversation.id, 'artifact-1', 'saved');

    const restored = new JsonConversationStore(storePath);

    expect(restored.listConversations()).toEqual([
      expect.objectContaining({
        id: 'conversation-1',
        name: 'Persistent task',
        extra: expect.objectContaining({ backend: 'codex', workspace: '/tmp/project' }),
      }),
    ]);
    expect(restored.getMessages('conversation-1')).toEqual([
      expect.objectContaining({ msg_id: 'user-1', content: { content: 'Inspect the project' } }),
    ]);
    expect(restored.listArtifacts('conversation-1')).toEqual([
      expect.objectContaining({ id: 'artifact-1', kind: 'skill_suggest', status: 'saved' }),
    ]);
    expect(readdirSync(join(storePath, '..')).filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('persists conversation updates and removals', () => {
    const storePath = createStorePath();
    const store = new JsonConversationStore(storePath, {
      now: () => 1500,
      id: sequentialIds('conversation-update'),
    });
    const conversation = store.createConversation({ name: 'Initial name' });

    store.updateConversation(conversation.id, { name: 'Updated name' });
    expect(new JsonConversationStore(storePath).getConversation(conversation.id)?.name).toBe('Updated name');

    store.removeConversation(conversation.id);
    expect(new JsonConversationStore(storePath).listConversations()).toEqual([]);
  });

  it('normalizes an interrupted running conversation to an idle runtime on restart', () => {
    const storePath = createStorePath();
    const store = new JsonConversationStore(storePath, {
      now: () => 2000,
      id: sequentialIds('conversation-2'),
    });
    const conversation = store.createConversation({ name: 'Interrupted task' });
    store.updateConversation(conversation.id, {
      status: 'running',
      runtime: {
        state: 'running',
        can_send_message: false,
        has_task: true,
        task_status: 'running',
        is_processing: true,
        pending_confirmations: 0,
        turn_id: 'turn-1',
      },
    });

    const restored = new JsonConversationStore(storePath);
    const restoredConversation = restored.getConversation(conversation.id);

    expect(restoredConversation?.status).toBe('finished');
    expect(restoredConversation?.runtime).toEqual({
      state: 'idle',
      can_send_message: true,
      has_task: false,
      task_status: 'finished',
      is_processing: false,
      pending_confirmations: 0,
      turn_id: null,
    });
  });

  it('recovers from an invalid store file on the next mutation', () => {
    const storePath = createStorePath();
    writeFileSync(storePath, '{invalid json', 'utf8');
    const store = new JsonConversationStore(storePath, {
      id: sequentialIds('conversation-3'),
    });

    expect(store.listConversations()).toEqual([]);
    store.createConversation({ name: 'Recovered task' });

    expect(JSON.parse(readFileSync(storePath, 'utf8'))).toEqual(
      expect.objectContaining({
        version: 1,
        conversations: [expect.objectContaining({ id: 'conversation-3', name: 'Recovered task' })],
      }),
    );
  });
});

function createStorePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'aicliui-store-'));
  tempDirectories.push(directory);
  mkdirSync(join(directory, 'daemon'), { recursive: true });
  return join(directory, 'daemon', 'store.json');
}

function sequentialIds(...ids: string[]): () => string {
  let index = 0;
  return () => ids[index++] ?? `generated-${index}`;
}
