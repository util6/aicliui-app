import type { AgentHealth } from '@aicliui/shared';
import type { CliAgentAdapter, CommandRunner, CommandSpec, SendMessageInput } from './types.js';

export type GeminiCommandOptions = {
  prompt: string;
  model?: string;
  approvalMode?: string;
};

export function buildGeminiCommand(options: GeminiCommandOptions): CommandSpec {
  return {
    command: 'gemini',
    args: [
      '-p',
      options.prompt,
      '--output-format',
      'stream-json',
      ...(options.model ? ['--model', options.model] : []),
      ...(options.approvalMode ? ['--approval-mode', options.approvalMode] : []),
    ],
  };
}

export function parseGeminiStreamJsonLine(line: string): { type: 'content'; content: string } | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }

  const content = extractText(value);
  return content ? { type: 'content', content } : null;
}

export function createGeminiAdapter(runner: CommandRunner): CliAgentAdapter {
  return {
    backend: 'gemini',
    name: 'gemini',
    label: 'Gemini CLI',
    async probe(): Promise<AgentHealth> {
      const exists = await runner.commandExists('gemini');
      if (!exists) return { backend: 'gemini', state: 'missing', detail: 'gemini command not found' };
      return {
        backend: 'gemini',
        state: 'ready',
        version: await runner.readVersion?.('gemini', ['--version']),
      };
    },
    async *sendMessage(input: SendMessageInput) {
      const command = buildGeminiCommand({
        prompt: input.input,
        model: input.model,
        approvalMode: input.sessionMode,
      });
      yield {
        type: 'thought',
        subject: 'Gemini CLI',
        description: [command.command, ...command.args].join(' '),
      };
      yield {
        type: 'content',
        content: 'Gemini CLI execution is queued for the Termux runtime adapter.',
      };
    },
  };
}

function extractText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return null;

  const direct =
    stringValue(value.value) ??
    stringValue(value.text) ??
    stringValue(value.content) ??
    stringValue(value.delta) ??
    stringValue((value.message as { content?: unknown } | undefined)?.content);
  if (direct) return direct;

  const candidateText = extractCandidateText(value.candidates);
  return candidateText || null;
}

function extractCandidateText(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const parts = value
    .flatMap((candidate) => {
      if (!isRecord(candidate)) return [];
      const content = candidate.content;
      if (!isRecord(content) || !Array.isArray(content.parts)) return [];
      return content.parts.map((part) => (isRecord(part) ? stringValue(part.text) : undefined));
    })
    .filter((text): text is string => Boolean(text));
  return parts.join('') || null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
