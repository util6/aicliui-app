import { useMemo } from 'react';
import type { TMessage, TMessageType } from '../utils/messageAdapter';
import {
  countNormalizedToolErrors,
  getCurrentNormalizedToolName,
  isNormalizedToolBatchComplete,
  normalizeToolMessages,
} from '../utils/normalizeToolCall';
import { isVisibleConversationArtifact, type ConversationArtifact } from '../utils/artifacts';

export type ToolSummaryVO = {
  type: 'tool_summary';
  id: string;
  messages: TMessage[];
  created_at: number;
};

export type ArtifactVO = {
  type: 'artifact';
  id: string;
  artifact: ConversationArtifact;
  created_at: number;
};

export type ProcessedItem = TMessage | ToolSummaryVO | ArtifactVO;

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

export function useProcessedMessages(
  messages: TMessage[],
  artifacts: readonly ConversationArtifact[] = [],
): ProcessedItem[] {
  return useMemo(() => {
    const result: ProcessedItem[] = [];
    let toolBatch: TMessage[] = [];

    const flushBatch = () => {
      if (toolBatch.length === 0) return;
      const id = toolBatch.map((m) => m.id).join('-');
      result.push({ type: 'tool_summary', id, messages: toolBatch, created_at: getMessageCreatedAt(toolBatch[0]) });
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

    const visibleArtifacts = artifacts
      .filter(isVisibleConversationArtifact)
      .map<ArtifactVO>((artifact) => ({
        type: 'artifact',
        id: artifact.id,
        artifact,
        created_at: artifact.created_at,
      }));

    return [...result, ...visibleArtifacts].sort((a, b) => getProcessedItemCreatedAt(a) - getProcessedItemCreatedAt(b));
  }, [artifacts, messages]);
}

function getProcessedItemCreatedAt(item: ProcessedItem): number {
  if ('type' in item && (item.type === 'tool_summary' || item.type === 'artifact')) {
    return item.created_at;
  }
  return getMessageCreatedAt(item);
}

function getMessageCreatedAt(message: TMessage | undefined): number {
  return message?.created_at ?? message?.createdAt ?? 0;
}
