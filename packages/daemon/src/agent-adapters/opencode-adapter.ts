import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AgentHealth } from '@aicliui/shared';
import type { CliAgentAdapter, CommandRunner, CommandSpec, SendMessageInput } from './types.js';
import type { OpenCodeCommandPart, OpenCodeSessionClient } from './opencode-client.js';
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
  const sessionByConversationId = new Map<string, string>();
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
        const cachedSessionId = sessionByConversationId.get(input.conversationId);
        const slashCommand = parseOpenCodeSlashCommand(input.input);
        let result;
        if (slashCommand && (await isKnownOpenCodeCommand(activeClient, slashCommand.command, input.workspace))) {
          const parts = await buildOpenCodeCommandParts(input.files);
          result = await activeClient.sendCommand({
            command: slashCommand.command,
            arguments: slashCommand.arguments,
            sessionId: cachedSessionId,
            directory: input.workspace,
            model: input.model,
            agent: input.sessionMode,
            ...(parts.length ? { parts } : {}),
          });
        } else {
          result = await activeClient.sendPrompt({
            prompt: input.input,
            sessionId: cachedSessionId,
            directory: input.workspace,
          });
        }
        sessionByConversationId.set(input.conversationId, result.sessionId);
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

async function isKnownOpenCodeCommand(
  client: OpenCodeSessionClient,
  command: string,
  directory?: string,
): Promise<boolean> {
  try {
    const commands = await client.listCommands({ directory });
    return commands.some((item) => item.command === command);
  } catch {
    return false;
  }
}

async function buildOpenCodeCommandParts(files: string[] = []): Promise<OpenCodeCommandPart[]> {
  const parts: OpenCodeCommandPart[] = [];
  for (const filePath of files) {
    try {
      const fileStats = await stat(filePath);
      if (!fileStats.isFile()) continue;
      parts.push({
        type: 'file',
        mime: fileMimeType(filePath),
        filename: basename(filePath),
        url: pathToFileURL(filePath).toString(),
      });
    } catch {
      // Ignore files that disappeared between selection and send.
    }
  }
  return parts;
}

function fileMimeType(path: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'bmp') return 'image/bmp';
  if (ext === 'avif') return 'image/avif';
  if (ext === 'json') return 'application/json';
  if (ext === 'html' || ext === 'htm') return 'text/html';
  if (ext === 'css') return 'text/css';
  if (ext === 'csv') return 'text/csv';
  if (ext === 'md' || ext === 'markdown') return 'text/markdown';
  return 'text/plain';
}

export function parseOpenCodeSlashCommand(input: string): { command: string; arguments: string } | null {
  const trimmed = input.trim();
  const match = trimmed.match(/^\/([a-zA-Z0-9_-]+)(?:\s+(.*))?$/);
  if (!match) return null;
  return {
    command: match[1],
    arguments: match[2] ?? '',
  };
}
