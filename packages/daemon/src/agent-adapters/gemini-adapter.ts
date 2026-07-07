import { relative } from 'node:path';
import type { AgentHealth, AgentModelInfo } from '@aicliui/shared';
import type { CliAgentAdapter, CliAgentEvent, CommandRunner, CommandSpec, SendMessageInput } from './types.js';

const DEFAULT_GEMINI_MODELS = [
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
];

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
    async getModelInfo(): Promise<AgentModelInfo> {
      return {
        currentModelId: null,
        currentModelLabel: 'Default Gemini model',
        availableModels: DEFAULT_GEMINI_MODELS,
        canSwitch: DEFAULT_GEMINI_MODELS.length > 0,
        source: 'models',
      };
    },
    async *sendMessage(input: SendMessageInput) {
      const prompt = appendSelectedFilesToPrompt(input.input, input.files ?? [], input.workspace);
      const command = buildGeminiCommand({
        prompt,
        model: input.model,
        approvalMode: input.sessionMode,
      });
      yield {
        type: 'thought',
        subject: 'Gemini CLI',
        description: [command.command, ...command.args].join(' '),
      };

      if (!runner.runCommand) {
        yield {
          type: 'content',
          content: 'Gemini CLI execution is queued for the Termux runtime adapter.',
        };
        return;
      }

      let lineBuffer = '';
      let emittedContent = '';
      const queue = createAsyncQueue<CliAgentEvent>();
      const emitContent = (content: string) => {
        if (!content) return;
        emittedContent += content;
        queue.push({ type: 'content', content });
      };
      const handleStdout = (chunk: Buffer) => {
        const lines = (lineBuffer + chunk.toString()).split(/\r?\n/);
        lineBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const parsed = parseGeminiStreamJsonLine(line);
          if (parsed) emitContent(parsed.content);
        }
      };

      const run = runner.runCommand(command, {
        cwd: input.workspace || process.env.HOME || process.cwd(),
        signal: input.signal,
        onStdout: handleStdout,
      });
      const finalized = run.then(
        (result) => {
          const tail = parseGeminiStreamJsonLine(lineBuffer);
          if (tail) emitContent(tail.content);
          if (!emittedContent) {
            const fallback = extractGeminiStreamText(result.stdout) || result.stdout.trim();
            if (fallback) emitContent(fallback);
          }
          queue.close();
          return result;
        },
        (error) => {
          queue.fail(error);
          return { stdout: '', stderr: '' };
        },
      );

      for await (const event of queue) {
        yield event;
      }
      await finalized;
    },
  };
}

function extractGeminiStreamText(stdout: string): string {
  return stdout
    .split(/\r?\n/)
    .map((line) => parseGeminiStreamJsonLine(line)?.content ?? '')
    .join('');
}

function appendSelectedFilesToPrompt(input: string, files: string[], workspace?: string): string {
  if (files.length === 0) return input;
  const root = workspace || process.cwd();
  const fileList = files.map((filePath) => `- ${normalizeRelativePath(relative(root, filePath))}`).join('\n');
  return `${input}\n\nSelected files:\n${fileList}`;
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function createAsyncQueue<T>(): {
  push: (value: T) => void;
  close: () => void;
  fail: (error: unknown) => void;
  [Symbol.asyncIterator]: () => AsyncIterator<T>;
} {
  const values: T[] = [];
  const waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: unknown) => void;
  }> = [];
  let closed = false;
  let failure: unknown;

  const next = (): Promise<IteratorResult<T>> => {
    if (values.length > 0) return Promise.resolve({ value: values.shift() as T, done: false });
    if (failure !== undefined) return Promise.reject(failure);
    if (closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      waiters.push({ resolve, reject });
    });
  };

  return {
    push(value) {
      if (closed || failure !== undefined) return;
      const waiter = waiters.shift();
      if (waiter) {
        waiter.resolve({ value, done: false });
        return;
      }
      values.push(value);
    },
    close() {
      if (closed) return;
      closed = true;
      for (const waiter of waiters.splice(0)) {
        waiter.resolve({ value: undefined, done: true });
      }
    },
    fail(error) {
      if (closed || failure !== undefined) return;
      failure = error;
      for (const waiter of waiters.splice(0)) {
        waiter.reject(error);
      }
    },
    [Symbol.asyncIterator]() {
      return { next };
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
