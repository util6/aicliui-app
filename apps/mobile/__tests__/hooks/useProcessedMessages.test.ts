import { renderHook } from '@testing-library/react-native';
import { useProcessedMessages } from '@/src/hooks/useProcessedMessages';
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
