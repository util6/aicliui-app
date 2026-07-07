import type { AgentHealth } from '@aicliui/shared';
import type { CliAgentAdapter, SendMessageInput } from './types.js';

export function createFallbackAdapter(backend: string, label?: string): CliAgentAdapter {
  return {
    backend,
    name: backend,
    label,
    async probe(): Promise<AgentHealth> {
      return { backend: backend as AgentHealth['backend'], state: 'missing', detail: 'CLI adapter is not configured' };
    },
    async *sendMessage(input: SendMessageInput) {
      yield { type: 'content', content: `Local daemon received: ${input.input}` };
    },
  };
}
