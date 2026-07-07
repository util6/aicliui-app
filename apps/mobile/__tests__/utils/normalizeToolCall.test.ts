import {
  countNormalizedToolErrors,
  getCurrentNormalizedToolName,
  hasRunningNormalizedTools,
  isNormalizedToolBatchComplete,
  normalizeToolMessages,
} from '@/src/utils/normalizeToolCall';
import type { TMessage } from '@/src/utils/messageAdapter';

const makeMessage = (overrides: Partial<TMessage>): TMessage => ({
  id: 'msg-1',
  msg_id: 'turn-1',
  conversation_id: 'conv-1',
  type: 'tool_call',
  position: 'left',
  content: {},
  ...overrides,
});

describe('normalizeToolMessages', () => {
  it('normalizes desktop-style tool_group entries', () => {
    const tools = normalizeToolMessages([
      makeMessage({
        type: 'tool_group',
        content: [
          {
            call_id: 'call-1',
            name: 'ReadFile',
            description: 'Read package.json',
            status: 'Success',
            result_display: 'package contents',
          },
        ],
      }),
    ]);

    expect(tools).toEqual([
      {
        key: 'call-1',
        name: 'ReadFile',
        status: 'completed',
        description: 'Read package.json',
        input: 'Read package.json',
        output: 'package contents',
      },
    ]);
  });

  it('normalizes ACP raw input and content output', () => {
    const tools = normalizeToolMessages([
      makeMessage({
        id: 'msg-acp',
        type: 'acp_tool_call',
        content: {
          _compact: { truncated: true },
          update: {
            tool_call_id: 'call-2',
            title: 'Shell',
            kind: 'execute',
            status: 'in_progress',
            raw_input: { command: 'npm test' },
            content: [{ type: 'content', content: { text: 'running tests' } }],
          },
        },
      }),
    ]);

    expect(tools).toEqual([
      expect.objectContaining({
        key: 'call-2',
        name: 'Shell',
        status: 'running',
        description: 'npm test',
        input: '{\n  "command": "npm test"\n}',
        output: 'running tests',
        truncated: true,
        messageId: 'msg-acp',
        conversationId: 'conv-1',
      }),
    ]);
  });

  it('normalizes Codex MCP tool calls as first-class tool rows', () => {
    const tools = normalizeToolMessages([
      makeMessage({
        id: 'msg-codex',
        type: 'codex_tool_call',
        content: {
          toolCallId: 'call-3',
          kind: 'mcp_tool_call',
          title: 'GitHub: create_issue',
          status: 'success',
          description: 'github:create_issue',
          data: { arguments: { title: 'Bug' }, result: 'created #12' },
        },
      }),
    ]);

    expect(tools).toEqual([
      expect.objectContaining({
        key: 'call-3',
        name: 'GitHub: create_issue',
        status: 'completed',
        description: 'github:create_issue',
        input: '{\n  "title": "Bug"\n}',
        output: 'created #12',
        messageId: 'msg-codex',
        conversationId: 'conv-1',
      }),
    ]);
  });
});

describe('normalized tool aggregate helpers', () => {
  const tools = normalizeToolMessages([
    makeMessage({
      id: 'running',
      type: 'tool_call',
      content: { call_id: 'call-running', name: 'Shell', status: 'running' },
    }),
    makeMessage({
      id: 'failed',
      type: 'acp_tool_call',
      content: { update: { tool_call_id: 'call-failed', title: 'Edit', kind: 'edit', status: 'failed' } },
    }),
  ]);

  it('detects running tools', () => {
    expect(hasRunningNormalizedTools(tools)).toBe(true);
    expect(isNormalizedToolBatchComplete(tools)).toBe(false);
  });

  it('counts errors and returns the latest running step name', () => {
    expect(countNormalizedToolErrors(tools)).toBe(1);
    expect(getCurrentNormalizedToolName(tools)).toBe('Shell');
  });
});
