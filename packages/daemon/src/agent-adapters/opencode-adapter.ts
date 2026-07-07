import type { AgentHealth } from '@aicliui/shared';
import type { CliAgentAdapter, CommandRunner, CommandSpec, SendMessageInput } from './types.js';
import type { OpenCodeSessionClient } from './opencode-client.js';
import type { OpenCodeServerManager } from './opencode-server.js';

export type OpenCodeServeCommandOptions = {
  port: number;
  hostname?: string;
};

export function buildOpenCodeServeCommand(options: OpenCodeServeCommandOptions): CommandSpec {
  return {
    command: 'opencode',
    args: ['serve', '--hostname', options.hostname ?? '127.0.0.1', '--port', String(options.port)],
  };
}

export function createOpenCodeAdapter(
  runner: CommandRunner,
  options?: { port?: number; client?: OpenCodeSessionClient; serverManager?: OpenCodeServerManager },
): CliAgentAdapter {
  const port = options?.port ?? 4096;
  const client = options?.client;
  const serverManager = options?.serverManager;
  return {
    backend: 'opencode',
    name: 'opencode',
    label: 'OpenCode',
    async probe(): Promise<AgentHealth> {
      const exists = await runner.commandExists('opencode');
      if (!exists) return { backend: 'opencode', state: 'missing', detail: 'opencode command not found' };
      return {
        backend: 'opencode',
        state: 'ready',
        version: await runner.readVersion?.('opencode', ['--version']),
      };
    },
    async *sendMessage(input: SendMessageInput) {
      const activeClient = client ?? (serverManager ? await serverManager.ensureClient() : null);
      if (activeClient) {
        const result = await activeClient.sendPrompt({
          prompt: input.input,
          directory: input.workspace,
        });
        yield {
          type: 'thought',
          subject: 'OpenCode',
          description: `session ${result.sessionId}`,
        };
        yield {
          type: 'content',
          content: result.text,
        };
        return;
      }

      const command = buildOpenCodeServeCommand({ port });
      yield {
        type: 'thought',
        subject: 'OpenCode',
        description: `${[command.command, ...command.args].join(' ')} for ${input.conversationId}`,
      };
      yield {
        type: 'content',
        content: 'OpenCode server adapter is prepared; session HTTP/SSE wiring is the next runtime slice.',
      };
    },
    async getSlashCommands(input) {
      const activeClient = client ?? (serverManager ? await serverManager.ensureClient() : null);
      if (!activeClient) return [];
      return activeClient.listCommands({ directory: input.workspace });
    },
  };
}
