import { transformMessage, composeMessage, IResponseMessage, TMessage } from '@/src/utils/messageAdapter';

// Deterministic uuid for snapshot stability
jest.mock('@/src/utils/uuid', () => {
  let count = 0;
  return { uuid: () => `test-id-${++count}` };
});

beforeEach(() => {
  jest.resetModules();
});

const makeResponse = (overrides: Partial<IResponseMessage> & { type: string }): IResponseMessage => ({
  msg_id: 'msg-1',
  conversation_id: 'conv-1',
  data: 'test',
  ...overrides,
});

describe('transformMessage', () => {
  it('transforms error → tips at center', () => {
    const result = transformMessage(makeResponse({ type: 'error', data: 'Something failed' }));
    expect(result).toMatchObject({
      type: 'tips',
      position: 'center',
      content: { content: 'Something failed', type: 'error' },
    });
  });

  it('transforms structured error payloads like desktop chatLib', () => {
    const result = transformMessage(
      makeResponse({
        type: 'error',
        data: { message: 'Provider failed', code: 'provider_error', detail: 'quota exceeded' },
      }),
    );

    expect(result).toMatchObject({
      type: 'tips',
      position: 'center',
      content: {
        content: 'Provider failed',
        type: 'error',
        error: {
          message: 'Provider failed',
          code: 'provider_error',
          detail: 'quota exceeded',
        },
      },
    });
  });

  it('transforms tips payloads with code and params', () => {
    const result = transformMessage(
      makeResponse({
        type: 'tips',
        data: {
          content: 'Retrying stream',
          type: 'warning',
          code: 'retry',
          params: { attempt: 2 },
        },
      }),
    );

    expect(result).toMatchObject({
      type: 'tips',
      position: 'center',
      content: {
        content: 'Retrying stream',
        type: 'warning',
        code: 'retry',
        params: { attempt: 2 },
      },
    });
  });

  it('transforms content → text at left', () => {
    const result = transformMessage(makeResponse({ type: 'content', data: 'hello' }));
    expect(result).toMatchObject({
      type: 'text',
      position: 'left',
      content: { content: 'hello' },
    });
  });

  it('transforms content with rich data object', () => {
    const result = transformMessage(makeResponse({ type: 'content', data: { content: 'rich text' } }));
    expect(result).toMatchObject({
      type: 'text',
      position: 'left',
      content: { content: 'rich text' },
    });
  });

  it('preserves desktop stream metadata on text messages', () => {
    const result = transformMessage({
      type: 'text',
      msg_id: 'msg-1',
      conversation_id: 'conv-1',
      data: { content: 'replacement', replace: true },
      position: 'center',
      status: 'work',
      created_at: 1234,
      hidden: true,
      replace: true,
    });

    expect(result).toMatchObject({
      type: 'text',
      position: 'center',
      status: 'work',
      createdAt: 1234,
      created_at: 1234,
      hidden: true,
      content: { content: 'replacement', replace: true },
    });
  });

  it('transforms user_content → text at right', () => {
    const result = transformMessage(makeResponse({ type: 'user_content', data: 'user msg' }));
    expect(result).toMatchObject({
      type: 'text',
      position: 'right',
      content: { content: 'user msg' },
    });
  });

  it('transforms tool_call → tool_call at left', () => {
    const data = { callId: 'c1', name: 'search', status: 'running' };
    const result = transformMessage(makeResponse({ type: 'tool_call', data }));
    expect(result).toMatchObject({
      type: 'tool_call',
      position: 'left',
      content: data,
    });
  });

  it('transforms tool_group', () => {
    const data = [{ callId: 'c1' }, { callId: 'c2' }];
    const result = transformMessage(makeResponse({ type: 'tool_group', data }));
    expect(result).toMatchObject({ type: 'tool_group', content: data });
  });

  it('transforms agent_status → center', () => {
    const result = transformMessage(makeResponse({ type: 'agent_status', data: { status: 'thinking' } }));
    expect(result).toMatchObject({ type: 'agent_status', position: 'center' });
  });

  it('transforms acp_permission → left', () => {
    const result = transformMessage(makeResponse({ type: 'acp_permission', data: {} }));
    expect(result).toMatchObject({ type: 'acp_permission', position: 'left' });
  });

  it('transforms acp_tool_call → left', () => {
    const result = transformMessage(makeResponse({ type: 'acp_tool_call', data: {} }));
    expect(result).toMatchObject({ type: 'acp_tool_call', position: 'left' });
  });

  it('transforms codex_permission → left', () => {
    const result = transformMessage(makeResponse({ type: 'codex_permission', data: {} }));
    expect(result).toMatchObject({ type: 'codex_permission', position: 'left' });
  });

  it('transforms codex_tool_call → left', () => {
    const result = transformMessage(makeResponse({ type: 'codex_tool_call', data: {} }));
    expect(result).toMatchObject({ type: 'codex_tool_call', position: 'left' });
  });

  it('transforms plan → left', () => {
    const data = { sessionId: 's1', steps: [] };
    const result = transformMessage(makeResponse({ type: 'plan', data }));
    expect(result).toMatchObject({ type: 'plan', position: 'left', content: data });
  });

  it('transforms thinking messages', () => {
    const result = transformMessage(
      makeResponse({
        type: 'thinking',
        data: { content: 'Looking at files', subject: 'Inspecting', duration_ms: 1500, status: 'thinking' },
      }),
    );

    expect(result).toMatchObject({
      type: 'thinking',
      position: 'left',
      content: {
        content: 'Looking at files',
        subject: 'Inspecting',
        duration: 1500,
        status: 'thinking',
      },
    });
  });

  it.each(['start', 'finish', 'thought', 'system', 'acp_model_info', 'codex_model_info', 'acp_context_usage', 'request_trace', 'available_commands'])(
    'returns undefined for ignored type: %s',
    (type) => {
      expect(transformMessage(makeResponse({ type }))).toBeUndefined();
    },
  );

  it('returns undefined for unknown types', () => {
    expect(transformMessage(makeResponse({ type: 'nonexistent_type' }))).toBeUndefined();
  });
});

describe('composeMessage', () => {
  const makeMsg = (overrides: Partial<TMessage>): TMessage => ({
    id: 'id-1',
    msg_id: 'msg-1',
    conversation_id: 'conv-1',
    type: 'text',
    content: { content: 'hello' },
    position: 'left',
    ...overrides,
  });

  it('returns the same list when message is undefined', () => {
    const list = [makeMsg({})];
    expect(composeMessage(undefined, list)).toBe(list);
  });

  it('returns a new list with the message when list is empty', () => {
    const msg = makeMsg({});
    const result = composeMessage(msg, []);
    expect(result).toEqual([msg]);
  });

  it('appends message when msg_id differs', () => {
    const existing = makeMsg({ msg_id: 'msg-1' });
    const incoming = makeMsg({ id: 'id-2', msg_id: 'msg-2', content: { content: 'world' } });
    const result = composeMessage(incoming, [existing]);
    expect(result).toHaveLength(2);
    expect(result[1]).toBe(incoming);
  });

  describe('text streaming', () => {
    it('concatenates content for same msg_id text messages', () => {
      const existing = makeMsg({ msg_id: 'msg-1', type: 'text', content: { content: 'hel' } });
      const incoming = makeMsg({ id: 'id-2', msg_id: 'msg-1', type: 'text', content: { content: 'lo' } });
      const result = composeMessage(incoming, [existing]);
      expect(result).toHaveLength(1);
      expect(result[0].content.content).toBe('hello');
      // Keeps original id
      expect(result[0].id).toBe('id-1');
    });

    it('replaces accumulated text when replace is true', () => {
      const existing = makeMsg({ msg_id: 'msg-1', type: 'text', content: { content: 'draft answer' } });
      const incoming = makeMsg({
        id: 'id-2',
        msg_id: 'msg-1',
        type: 'text',
        content: { content: 'final answer', replace: true },
      });

      const result = composeMessage(incoming, [existing]);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('id-1');
      expect(result[0].content).toEqual({ content: 'final answer', replace: true });
    });
  });

  describe('tool_call merging', () => {
    it('merges tool_call with same callId', () => {
      const existing = makeMsg({
        type: 'tool_call',
        content: { callId: 'c1', name: 'search', status: 'running' },
      });
      const incoming = makeMsg({
        id: 'id-2',
        type: 'tool_call',
        content: { callId: 'c1', status: 'done', result: 'found' },
      });
      const result = composeMessage(incoming, [existing]);
      expect(result).toHaveLength(1);
      expect(result[0].content).toEqual({ callId: 'c1', name: 'search', status: 'done', result: 'found' });
    });

    it('appends tool_call with different callId', () => {
      const existing = makeMsg({ type: 'tool_call', content: { callId: 'c1' } });
      const incoming = makeMsg({ id: 'id-2', type: 'tool_call', content: { callId: 'c2' } });
      const result = composeMessage(incoming, [existing]);
      expect(result).toHaveLength(2);
    });
  });

  describe('tool_group merging', () => {
    it('merges tool_group items by callId across existing groups', () => {
      const existing = makeMsg({
        type: 'tool_group',
        content: [{ callId: 'c1', status: 'running' }, { callId: 'c2', status: 'running' }],
      });
      const incoming = makeMsg({
        id: 'id-2',
        type: 'tool_group',
        content: [{ callId: 'c1', status: 'done', result: 'ok' }],
      });
      const result = composeMessage(incoming, [existing]);
      expect(result).toHaveLength(1);
      expect(result[0].content[0]).toEqual({ callId: 'c1', status: 'done', result: 'ok' });
      expect(result[0].content[1]).toEqual({ callId: 'c2', status: 'running' });
    });

    it('appends unmatched tool_group items as a new group', () => {
      const existing = makeMsg({
        type: 'tool_group',
        content: [{ callId: 'c1', status: 'done' }],
      });
      const incoming = makeMsg({
        id: 'id-2',
        type: 'tool_group',
        content: [{ callId: 'c3', status: 'running' }],
      });
      const result = composeMessage(incoming, [existing]);
      expect(result).toHaveLength(2);
      expect(result[1].content).toEqual([{ callId: 'c3', status: 'running' }]);
    });

    it('returns same list for empty tool_group content', () => {
      const existing = makeMsg({ type: 'text', content: { content: 'hi' } });
      const list = [existing];
      const incoming = makeMsg({ id: 'id-2', type: 'tool_group', content: [] });
      const result = composeMessage(incoming, list);
      expect(result).toBe(list);
    });
  });

  describe('plan merging', () => {
    it('merges plan with same sessionId', () => {
      const existing = makeMsg({
        type: 'plan',
        content: { sessionId: 's1', steps: ['step1'] },
      });
      const incoming = makeMsg({
        id: 'id-2',
        type: 'plan',
        content: { sessionId: 's1', steps: ['step1', 'step2'], status: 'complete' },
      });
      const result = composeMessage(incoming, [existing]);
      expect(result).toHaveLength(1);
      expect(result[0].content.steps).toEqual(['step1', 'step2']);
      expect(result[0].content.status).toBe('complete');
    });

    it('appends plan with different sessionId', () => {
      const existing = makeMsg({ type: 'plan', content: { sessionId: 's1' } });
      const incoming = makeMsg({ id: 'id-2', type: 'plan', content: { sessionId: 's2' } });
      const result = composeMessage(incoming, [existing]);
      expect(result).toHaveLength(2);
    });

    it('merges desktop-style plan messages by session_id', () => {
      const existing = makeMsg({ type: 'plan', content: { session_id: 's1', entries: [{ title: 'one' }] } });
      const incoming = makeMsg({
        id: 'id-2',
        type: 'plan',
        content: { session_id: 's1', entries: [{ title: 'one' }, { title: 'two' }] },
      });

      const result = composeMessage(incoming, [existing]);

      expect(result).toHaveLength(1);
      expect(result[0].content.entries).toEqual([{ title: 'one' }, { title: 'two' }]);
    });

    it('does not merge desktop-style plans with different session_id values', () => {
      const existing = makeMsg({ type: 'plan', content: { session_id: 's1' } });
      const incoming = makeMsg({ id: 'id-2', type: 'plan', content: { session_id: 's2' } });
      const result = composeMessage(incoming, [existing]);
      expect(result).toHaveLength(2);
    });
  });

  describe('codex_tool_call merging', () => {
    it('merges by toolCallId', () => {
      const existing = makeMsg({
        type: 'codex_tool_call',
        content: { toolCallId: 't1', status: 'running' },
      });
      const incoming = makeMsg({
        id: 'id-2',
        type: 'codex_tool_call',
        content: { toolCallId: 't1', status: 'done' },
      });
      const result = composeMessage(incoming, [existing]);
      expect(result).toHaveLength(1);
      expect(result[0].content.status).toBe('done');
    });
  });

  describe('acp_tool_call merging', () => {
    it('merges by update.toolCallId', () => {
      const existing = makeMsg({
        type: 'acp_tool_call',
        content: { update: { toolCallId: 't1' }, status: 'running' },
      });
      const incoming = makeMsg({
        id: 'id-2',
        type: 'acp_tool_call',
        content: { update: { toolCallId: 't1' }, status: 'done' },
      });
      const result = composeMessage(incoming, [existing]);
      expect(result).toHaveLength(1);
      expect(result[0].content.status).toBe('done');
    });

    it('merges desktop-style ACP updates by update.tool_call_id', () => {
      const existing = makeMsg({
        type: 'acp_tool_call',
        content: { update: { tool_call_id: 't1', status: 'in_progress' } },
      });
      const incoming = makeMsg({
        id: 'id-2',
        type: 'acp_tool_call',
        content: { update: { tool_call_id: 't1', status: 'completed' } },
      });

      const result = composeMessage(incoming, [existing]);

      expect(result).toHaveLength(1);
      expect(result[0].content.update.status).toBe('completed');
    });

    it('does not merge desktop-style ACP updates with different tool_call_id values', () => {
      const existing = makeMsg({
        type: 'acp_tool_call',
        content: { update: { tool_call_id: 't1', status: 'in_progress' } },
      });
      const incoming = makeMsg({
        id: 'id-2',
        type: 'acp_tool_call',
        content: { update: { tool_call_id: 't2', status: 'completed' } },
      });

      const result = composeMessage(incoming, [existing]);

      expect(result).toHaveLength(2);
    });
  });

  describe('thinking merging', () => {
    it('appends thinking chunks for the same msg_id', () => {
      const existing = makeMsg({
        type: 'thinking',
        content: { content: 'Reading ', subject: 'Inspecting', status: 'thinking' },
      });
      const incoming = makeMsg({
        id: 'id-2',
        type: 'thinking',
        content: { content: 'files', status: 'thinking' },
      });

      const result = composeMessage(incoming, [existing]);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('id-1');
      expect(result[0].content).toEqual({
        content: 'Reading files',
        subject: 'Inspecting',
        status: 'thinking',
      });
    });

    it('marks the latest thinking message done', () => {
      const existing = makeMsg({
        type: 'thinking',
        content: { content: 'Reading files', subject: 'Inspecting', status: 'thinking' },
      });
      const incoming = makeMsg({
        id: 'id-2',
        type: 'thinking',
        content: { content: '', status: 'done', duration: 2500 },
      });

      const result = composeMessage(incoming, [existing]);

      expect(result).toHaveLength(1);
      expect(result[0].content).toEqual({
        content: 'Reading files',
        subject: 'Inspecting',
        status: 'done',
        duration: 2500,
      });
    });
  });
});
