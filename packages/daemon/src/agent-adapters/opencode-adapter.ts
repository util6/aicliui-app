import { stat } from 'node:fs/promises';
import { basename, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AgentHealth } from '@aicliui/shared';
import type {
  CliAgentAdapter,
  CliAgentEvent,
  CliConfirmation,
  CommandRunner,
  CommandSpec,
  SendMessageInput,
} from './types.js';
import type {
  OpenCodeCommandInput,
  OpenCodeCommandPart,
  OpenCodePermissionRequest,
  OpenCodePermissionReply,
  OpenCodePromptFile,
  OpenCodeQuestionRequest,
  OpenCodeSessionClient,
  OpenCodeStreamEvent,
} from './opencode-client.js';
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
  const pendingPermissions = new Map<string, { sessionId: string; requestId: string }>();
  const pendingQuestions = new Map<string, { sessionId: string; requestId: string }>();

  async function getActiveClient(): Promise<OpenCodeSessionClient | null> {
    return client ?? (serverManager ? await serverManager.ensureClient() : null);
  }

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
    async getModelInfo() {
      const activeClient = await getActiveClient();
      if (!activeClient?.listModels) return null;
      try {
        const availableModels = await activeClient.listModels();
        return {
          currentModelId: null,
          currentModelLabel: 'Default OpenCode model',
          availableModels,
          canSwitch: availableModels.length > 0,
          source: 'models' as const,
        };
      } catch {
        return null;
      }
    },
    async *sendMessage(input: SendMessageInput) {
      const activeClient = await getActiveClient();
      if (activeClient) {
        const cachedSessionId = sessionByConversationId.get(input.conversationId);
        const slashCommand = parseOpenCodeSlashCommand(input.input);
        if (slashCommand && (await isKnownOpenCodeCommand(activeClient, slashCommand.command, input.workspace))) {
          const parts = await buildOpenCodeCommandParts(input.files);
          const commandInput: OpenCodeCommandInput = {
            command: slashCommand.command,
            arguments: slashCommand.arguments,
            sessionId: cachedSessionId,
            directory: input.workspace,
            model: input.model,
            agent: input.sessionMode,
            ...(input.signal ? { signal: input.signal } : {}),
            ...(parts.length ? { parts } : {}),
          };
          if (activeClient.streamCommand) {
            yield* streamOpenCodeEvents(activeClient.streamCommand(commandInput), input.conversationId);
            return;
          }

          const result = await activeClient.sendCommand(commandInput);
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

        const promptFiles = await buildOpenCodePromptFiles(input.files, input.workspace);
        if (activeClient.streamPrompt) {
          yield* streamOpenCodeEvents(
            activeClient.streamPrompt({
              prompt: input.input,
              sessionId: cachedSessionId,
              directory: input.workspace,
              ...(input.signal ? { signal: input.signal } : {}),
              ...(input.model ? { model: input.model } : {}),
              ...(input.sessionMode ? { agent: input.sessionMode } : {}),
              ...(promptFiles.length ? { files: promptFiles } : {}),
            }),
            input.conversationId,
          );
          return;
        }

        const result = await activeClient.sendPrompt({
          prompt: input.input,
          sessionId: cachedSessionId,
          directory: input.workspace,
          ...(input.signal ? { signal: input.signal } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(input.sessionMode ? { agent: input.sessionMode } : {}),
          ...(promptFiles.length ? { files: promptFiles } : {}),
        });
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
      const activeClient = await getActiveClient();
      if (!activeClient) return [];
      return activeClient.listCommands({ directory: input.workspace });
    },
    async confirm(input) {
      const questionRecord = pendingQuestions.get(input.confirmationId);
      if (questionRecord) {
        const activeClient = await getActiveClient();
        if (input.data === 'reject') {
          if (!activeClient?.rejectQuestion) {
            return {
              success: false,
              error: { code: 'CONFIRMATION_NOT_SUPPORTED', message: 'OpenCode client cannot reject questions' },
            };
          }

          const result = await activeClient.rejectQuestion({
            sessionId: questionRecord.sessionId,
            requestId: questionRecord.requestId,
          });
          pendingQuestions.delete(input.confirmationId);
          return result;
        }

        if (!activeClient?.replyQuestion) {
          return {
            success: false,
            error: { code: 'CONFIRMATION_NOT_SUPPORTED', message: 'OpenCode client cannot answer questions' },
          };
        }

        const answer = normalizeOpenCodeQuestionAnswer(input.data);
        if (answer.length === 0) {
          return {
            success: false,
            error: { code: 'INVALID_CONFIRMATION_REPLY', message: 'Unsupported OpenCode question answer' },
          };
        }

        const result = await activeClient.replyQuestion({
          sessionId: questionRecord.sessionId,
          requestId: questionRecord.requestId,
          answers: [answer],
        });
        pendingQuestions.delete(input.confirmationId);
        return result;
      }

      const record = pendingPermissions.get(input.confirmationId);
      if (!record) {
        return {
          success: false,
          error: {
            code: 'CONFIRMATION_NOT_FOUND',
            message: `OpenCode confirmation not found: ${input.confirmationId}`,
          },
        };
      }

      const reply = normalizeOpenCodePermissionReply(input.data);
      if (!reply) {
        return {
          success: false,
          error: { code: 'INVALID_CONFIRMATION_REPLY', message: 'Unsupported OpenCode confirmation reply' },
        };
      }

      const activeClient = await getActiveClient();
      if (!activeClient?.confirmPermission) {
        return {
          success: false,
          error: { code: 'CONFIRMATION_NOT_SUPPORTED', message: 'OpenCode client cannot confirm permissions' },
        };
      }

      const result = await activeClient.confirmPermission({
        sessionId: record.sessionId,
        requestId: record.requestId,
        reply,
      });
      pendingPermissions.delete(input.confirmationId);
      return result;
    },
  };

  async function* streamOpenCodeEvents(
    stream: AsyncIterable<OpenCodeStreamEvent>,
    conversationId: string,
  ): AsyncIterable<CliAgentEvent> {
    for await (const event of stream) {
      switch (event.type) {
        case 'session':
          sessionByConversationId.set(conversationId, event.sessionId);
          yield {
            type: 'thought',
            subject: 'OpenCode',
            description: `session ${event.sessionId}`,
          };
          break;
        case 'content':
          yield {
            type: 'content',
            content: event.content,
          };
          break;
        case 'tool':
          yield {
            type: 'tool_group',
            tools: [event.tool],
          };
          break;
        case 'thinking':
          yield {
            type: 'thinking',
            subject: event.subject ?? 'OpenCode reasoning',
            content: event.content,
            status: event.status,
          };
          break;
        case 'context_usage':
          yield {
            type: 'context_usage',
            used: event.used,
            size: event.size,
          };
          break;
        case 'agent_status':
          yield {
            type: 'agent_status',
            data: event.data,
          };
          break;
        case 'permission': {
          const confirmation = toOpenCodeConfirmation(event.request);
          if (!confirmation) break;
          pendingPermissions.set(confirmation.id, {
            sessionId: event.request.sessionID,
            requestId: event.request.id,
          });
          yield {
            type: 'permission',
            confirmation,
          };
          break;
        }
        case 'permission_resolved':
          pendingPermissions.delete(event.requestId);
          yield {
            type: 'permission_resolved',
            confirmationId: event.requestId,
          };
          break;
        case 'question': {
          const confirmation = toOpenCodeQuestionConfirmation(event.request);
          if (!confirmation) break;
          pendingQuestions.set(confirmation.id, {
            sessionId: event.request.sessionID,
            requestId: event.request.id,
          });
          yield {
            type: 'permission',
            confirmation,
          };
          break;
        }
        case 'question_resolved':
          pendingQuestions.delete(event.requestId);
          yield {
            type: 'permission_resolved',
            confirmationId: event.requestId,
          };
          break;
      }
    }
  }
}

async function buildOpenCodePromptFiles(
  files: string[] = [],
  workspace?: string,
): Promise<OpenCodePromptFile[]> {
  const attachments: OpenCodePromptFile[] = [];
  for (const filePath of files) {
    try {
      const fileStats = await stat(filePath);
      if (!fileStats.isFile()) continue;
      attachments.push({
        uri: pathToFileURL(filePath).toString(),
        mime: fileMimeType(filePath),
        name: basename(filePath),
        description: workspace ? normalizeRelativePath(relative(workspace, filePath)) : basename(filePath),
      });
    } catch {
      // Ignore files that disappeared between selection and send.
    }
  }
  return attachments;
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

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/');
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

function toOpenCodeConfirmation(request: OpenCodePermissionRequest): CliConfirmation | null {
  const requestId = request.id;
  const sessionId = request.sessionID;
  if (!requestId || !sessionId) return null;

  const action =
    typeof request.action === 'string' && request.action ? request.action : stringValue(request.permission) || 'tool';
  const resources = Array.isArray(request.resources)
    ? request.resources.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : Array.isArray(request.patterns)
      ? request.patterns.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : [];
  const source = isRecord(request.source) ? request.source : isRecord(request.tool) ? request.tool : {};
  const callId = stringValue(source.callID) || requestId;
  return {
    id: requestId,
    title: 'OpenCode permission',
    action,
    description: openCodePermissionDescription(action, resources, request.metadata),
    call_id: callId,
    callId,
    options: [
      { label: 'Allow once', value: 'once' },
      { label: 'Allow always', value: 'always' },
      { label: 'Reject', value: 'reject' },
    ],
  };
}

function toOpenCodeQuestionConfirmation(request: OpenCodeQuestionRequest): CliConfirmation | null {
  const requestId = request.id;
  const sessionId = request.sessionID;
  if (!requestId || !sessionId) return null;

  const question = Array.isArray(request.questions) ? request.questions.find(isRecord) : undefined;
  const header = question ? stringValue(question.header) : undefined;
  const prompt = question ? stringValue(question.question) : undefined;
  const description = [header, prompt].filter(Boolean).join('\n') || 'OpenCode question';
  const source = isRecord(request.tool) ? request.tool : isRecord(request.source) ? request.source : {};
  const callId = stringValue(source.callID) || requestId;
  return {
    id: requestId,
    title: 'OpenCode question',
    action: 'question',
    description,
    call_id: callId,
    callId,
    command_type: 'question',
    options: [...openCodeQuestionOptions(question), { label: 'Reject', value: 'reject' }],
  };
}

function openCodeQuestionOptions(question: Record<string, unknown> | undefined): CliConfirmation['options'] {
  const rawOptions = Array.isArray(question?.options) ? question.options : [];
  return rawOptions
    .map((option) => {
      const label = typeof option === 'string' ? option : isRecord(option) ? stringValue(option.label) : undefined;
      return label ? { label, value: label } : null;
    })
    .filter((option): option is { label: string; value: string } => option !== null);
}

function openCodePermissionDescription(action: string, resources: string[], metadata: unknown): string {
  const lines = [`Action: ${action}`];
  if (resources.length) lines.push('Resources:', ...resources.map((item) => `- ${item}`));
  if (isRecord(metadata) && Object.keys(metadata).length) {
    lines.push(`Metadata: ${JSON.stringify(metadata)}`);
  }
  return lines.join('\n');
}

function normalizeOpenCodePermissionReply(value: unknown): OpenCodePermissionReply | null {
  if (value === 'once' || value === 'always' || value === 'reject') return value;
  if (value === 'proceed_once' || value === 'allow' || value === 'approve' || value === 'yes') return 'once';
  if (value === 'proceed_always' || value === 'proceed_always_tool' || value === 'proceed_always_server') {
    return 'always';
  }
  if (value === 'cancel' || value === 'deny' || value === 'no') return 'reject';
  return null;
}

function normalizeOpenCodeQuestionAnswer(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }
  return typeof value === 'string' && value.length > 0 ? [value] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
