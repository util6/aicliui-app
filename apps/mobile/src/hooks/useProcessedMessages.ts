import { useMemo } from 'react';
import type { TMessage, TMessageType } from '../utils/messageAdapter';
import {
  countNormalizedToolErrors,
  getCurrentNormalizedToolName,
  isNormalizedToolBatchComplete,
  normalizeToolMessages,
} from '../utils/normalizeToolCall';

export type ToolSummaryVO = {
  type: 'tool_summary';
  id: string;
  messages: TMessage[];
};

export type ProcessedItem = TMessage | ToolSummaryVO;

const TOOL_CALL_TYPES: Set<TMessageType> = new Set(['tool_call', 'tool_group', 'acp_tool_call', 'codex_tool_call']);

export function isToolCallType(type: TMessageType): boolean {
  return TOOL_CALL_TYPES.has(type);
}

export function isGroupComplete(messages: TMessage[]): boolean {
  return isNormalizedToolBatchComplete(normalizeToolMessages(messages));
}

export function countSteps(messages: TMessage[]): number {
  return normalizeToolMessages(messages).length;
}

export function countErrors(messages: TMessage[]): number {
  return countNormalizedToolErrors(normalizeToolMessages(messages));
}

export function getCurrentStepName(messages: TMessage[]): string {
  return getCurrentNormalizedToolName(normalizeToolMessages(messages));
}

export function useProcessedMessages(messages: TMessage[]): ProcessedItem[] {
  return useMemo(() => {
    const result: ProcessedItem[] = [];
    let toolBatch: TMessage[] = [];

    const flushBatch = () => {
      if (toolBatch.length === 0) return;
      const id = toolBatch.map((m) => m.id).join('-');
      result.push({ type: 'tool_summary', id, messages: toolBatch });
      toolBatch = [];
    };

    for (const msg of messages) {
      if (msg.hidden) continue;
      if (isToolCallType(msg.type)) {
        toolBatch.push(msg);
      } else {
        flushBatch();
        result.push(msg);
      }
    }
    flushBatch();

    return result;
  }, [messages]);
}
