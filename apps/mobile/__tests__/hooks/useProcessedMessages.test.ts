import { renderHook } from '@testing-library/react-native';
import { countErrors, getCurrentStepName, isGroupComplete, useProcessedMessages } from '@/src/hooks/useProcessedMessages';
import type { TMessage } from '@/src/utils/messageAdapter';

const makeMessage = (overrides: Partial<TMessage>): TMessage => ({
  id: 'msg-1',
  msg_id: 'turn-1',
  conversation_id: 'conv-1',
  type: 'text',
  position: 'left',
  content: { content: 'visible' },
  ...overrides,
});

describe('useProcessedMessages', () => {
  it('filters hidden messages from the rendered chat stream', () => {
    const visible = makeMessage({ id: 'visible', content: { content: 'shown' } });
    const hidden = makeMessage({ id: 'hidden', hidden: true, content: { content: 'secret context' } });

    const { result } = renderHook(() => useProcessedMessages([hidden, visible]));

    expect(result.current).toEqual([visible]);
  });

  it('excludes hidden tool calls from tool summaries', () => {
    const hiddenTool = makeMessage({
      id: 'hidden-tool',
      type: 'codex_tool_call',
      hidden: true,
      content: { toolCallId: 'tool-hidden', title: 'Hidden tool', status: 'success' },
    });
    const visibleTool = makeMessage({
      id: 'visible-tool',
      type: 'codex_tool_call',
      content: { toolCallId: 'tool-visible', title: 'Visible tool', status: 'success' },
    });

    const { result } = renderHook(() => useProcessedMessages([hiddenTool, visibleTool]));

    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({
      type: 'tool_summary',
      messages: [visibleTool],
    });
  });

  it('inserts visible AionUi conversation artifacts into the chronological chat stream', () => {
    const user = makeMessage({
      id: 'user-1',
      msg_id: 'user-turn',
      position: 'right',
      content: { content: 'run schedule' },
      createdAt: 1000,
      created_at: 1000,
    });
    const assistant = makeMessage({
      id: 'assistant-1',
      msg_id: 'assistant-turn',
      position: 'left',
      content: { content: 'done' },
      createdAt: 3000,
      created_at: 3000,
    });
    const skillSuggestion = {
      id: 'artifact-skill',
      conversation_id: 'conv-1',
      kind: 'skill_suggest',
      status: 'pending',
      payload: {
        cron_job_id: 'cron-1',
        name: 'Review skill',
        description: 'Review local changes',
        skill_content: '# Review',
      },
      created_at: 2000,
      updated_at: 2000,
    } as const;
    const dismissedSuggestion = {
      ...skillSuggestion,
      id: 'artifact-dismissed',
      status: 'dismissed',
      created_at: 2500,
      updated_at: 2500,
    } as const;

    const { result } = renderHook(() => useProcessedMessages([user, assistant], [dismissedSuggestion, skillSuggestion]));

    expect(result.current.map((item) => item.id)).toEqual(['user-1', 'artifact-skill', 'assistant-1']);
    expect(result.current[1]).toMatchObject({
      type: 'artifact',
      artifact: skillSuggestion,
      created_at: 2000,
    });
  });
});

describe('tool summary helpers', () => {
  it('treats desktop-style completed tool_call status as complete', () => {
    expect(
      isGroupComplete([
        makeMessage({
          type: 'tool_call',
          content: { call_id: 'call-1', name: 'Shell', status: 'completed' },
        }),
      ]),
    ).toBe(true);
  });

  it('counts desktop-style failed tool_call status as an error', () => {
    expect(
      countErrors([
        makeMessage({
          type: 'tool_call',
          content: { call_id: 'call-1', name: 'Shell', status: 'failed' },
        }),
      ]),
    ).toBe(1);
  });

  it('uses desktop-style running tool_call as the current step', () => {
    expect(
      getCurrentStepName([
        makeMessage({
          type: 'tool_call',
          content: { call_id: 'call-1', name: 'Shell', status: 'running' },
        }),
      ]),
    ).toBe('Shell');
  });
});
