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
