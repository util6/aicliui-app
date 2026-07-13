import { relative } from 'node:path';
import type { AgentHealth, AgentModelInfo } from '@aicliui/shared';
import type { CliAgentAdapter, CliAgentEvent, CommandRunner, CommandSpec, SendMessageInput } from './types.js';

const DEFAULT_CODEX_MODELS = [
  { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
  { id: 'gpt-5', label: 'GPT-5' },
  { id: 'gpt-5-mini', label: 'GPT-5 Mini' },
];

export type CodexCommandOptions = {
  prompt: string;
  model?: string;
  approvalMode?: string;
};

export function buildCodexCommand(options: CodexCommandOptions): CommandSpec {
  const args = ['exec', '--json', '--skip-git-repo-check'];
  if (options.model) args.push('--model', options.model);
  if (options.approvalMode === 'yolo') {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  } else {
    args.push('--sandbox', options.approvalMode === 'autoEdit' ? 'workspace-write' : 'read-only');
  }
  args.push(options.prompt);
  return { command: 'codex', args };
}

export function createCodexAdapter(runner: CommandRunner): CliAgentAdapter {
  return {
    backend: 'codex',
    name: 'codex',
    label: 'Codex CLI',
    async probe(): Promise<AgentHealth> {
      const exists = await runner.commandExists('codex');
      if (!exists) return { backend: 'codex', state: 'missing', detail: 'codex command not found' };
      return {
        backend: 'codex',
        state: 'ready',
        version: await runner.readVersion?.('codex', ['--version']),
      };
    },
    async getModelInfo(): Promise<AgentModelInfo> {
      return {
        currentModelId: null,
        currentModelLabel: 'Default Codex model',
        availableModels: DEFAULT_CODEX_MODELS,
        canSwitch: DEFAULT_CODEX_MODELS.length > 0,
        source: 'models',
      };
    },
    async *sendMessage(input: SendMessageInput) {
      const prompt = appendSelectedFilesToPrompt(input.input, input.files ?? [], input.workspace);
      const command = buildCodexCommand({
        prompt,
        model: input.model,
        approvalMode: input.sessionMode,
      });
      yield {
        type: 'thought',
        subject: 'Codex CLI',
        description: [command.command, ...command.args].join(' '),
      };

      if (!runner.runCommand) {
        yield {
          type: 'content',
          content: 'Codex CLI execution is queued for the embedded runtime adapter.',
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
      const handleEvent = (event: unknown) => {
        emitContent(extractCodexEventText(event));
        const tool = extractCodexToolUpdate(event);
        if (tool) queue.push({ type: 'codex_tool_call', data: tool });
        const plan = extractCodexPlanUpdate(event);
        if (plan) queue.push({ type: 'plan', data: plan });
      };
      const handleStdout = (chunk: Buffer) => {
        const lines = (lineBuffer + chunk.toString()).split(/\r?\n/);
        lineBuffer = lines.pop() ?? '';
        for (const line of lines) {
          handleEvent(parseCodexJsonEvent(line));
        }
      };

      const run = runner.runCommand(command, {
        cwd: input.workspace || process.env.HOME || process.cwd(),
        signal: input.signal,
        onStdout: handleStdout,
      });
      const finalized = run.then(
        (result) => {
          handleEvent(parseCodexJsonEvent(lineBuffer));
          if (!emittedContent) {
            const fallback = extractCodexJsonText(result.stdout) || result.stdout.trim();
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

export function parseCodexJsonEvent(line: string): unknown {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return null;
  }
}

export function extractCodexEventText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return '';

  const item = isRecord(value.item) ? value.item : {};
  if (value.type === 'item.completed' && item.type === 'agent_message' && typeof item.text === 'string') {
    return item.text;
  }

  if (value.type === 'error' && typeof value.message === 'string') return value.message;
  if (value.type === 'turn.failed' && isRecord(value.error) && typeof value.error.message === 'string') {
    return value.error.message;
  }

  const direct =
    stringValue(value.text) ||
    stringValue(value.content) ||
    stringValue(value.delta) ||
    (isRecord(value.message) ? stringValue(value.message.content) : undefined);
  if (direct) return direct;

  if (isRecord(value.data)) return extractCodexEventText(value.data);
  return '';
}

export function extractCodexToolUpdate(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const type = typeof value.type === 'string' ? value.type : '';
  if (!(type === 'item.started' || type === 'item.completed')) return null;
  const item = isRecord(value.item) ? value.item : {};
  if (item.type === 'agent_message') return null;
  if (item.type === 'todo_list') return null;
  if (item.type === 'command_execution') return codexCommandExecutionTool(type, item);
  if (item.type === 'web_search') return codexWebSearchTool(type, item);
  if (item.type === 'file_change') return codexFileChangeTool(type, item);
  if (item.type === 'mcp_tool_call') return codexMcpToolCallTool(type, item);
  return codexGenericTool(type, item);
}

export function extractCodexPlanUpdate(value: unknown): { sessionId: string; entries: Array<{ title: string; status: string }> } | null {
  if (!isRecord(value)) return null;
  const type = typeof value.type === 'string' ? value.type : '';
  if (!(type === 'item.started' || type === 'item.updated' || type === 'item.completed')) return null;
  const item = isRecord(value.item) ? value.item : {};
  if (item.type !== 'todo_list') return null;
  return codexTodoListPlan(item);
}

function extractCodexJsonText(stdout: string): string {
  return stdout
    .split(/\r?\n/)
    .map((line) => extractCodexEventText(parseCodexJsonEvent(line)))
    .join('');
}

function codexTodoListPlan(item: Record<string, unknown>): { sessionId: string; entries: Array<{ title: string; status: string }> } | null {
  const sessionId = stringValue(item.id);
  const items = Array.isArray(item.items) ? item.items.filter(isRecord) : [];
  if (!sessionId) return null;
  return {
    sessionId,
    entries: items.map((todo) => ({
      title: stringValue(todo.text) || '',
      status: todo.completed ? 'completed' : 'pending',
    })),
  };
}

function codexCommandExecutionTool(type: string, item: Record<string, unknown>): Record<string, unknown> | null {
  const toolCallId = stringValue(item.id);
  if (!toolCallId) return null;
  const command = stringValue(item.command) || 'command';
  const output = stringValue(item.aggregated_output) || '';
  const description = [command, output.trim()].filter(Boolean).join('\n\n');
  return {
    toolCallId,
    kind: 'command_execution',
    title: command,
    description,
    status: codexToolStatus(type, item),
  };
}

function codexWebSearchTool(type: string, item: Record<string, unknown>): Record<string, unknown> | null {
  const toolCallId = stringValue(item.id);
  if (!toolCallId) return null;
  const query = stringValue(item.query) || '';
  return {
    toolCallId,
    kind: 'web_search',
    subtype: type === 'item.started' ? 'web_search_begin' : 'web_search_end',
    title: query || 'Web search',
    description: query,
    status: type === 'item.started' ? 'executing' : 'success',
    data: { query },
  };
}

function codexFileChangeTool(type: string, item: Record<string, unknown>): Record<string, unknown> | null {
  const toolCallId = stringValue(item.id);
  if (!toolCallId) return null;
  const changes = Array.isArray(item.changes) ? item.changes.filter(isRecord) : [];
  return {
    toolCallId,
    kind: 'file_change',
    title: codexFileChangeTitle(changes),
    description: codexFileChangeDescription(item),
    status: codexToolStatus(type, item),
    data: { changes },
  };
}

function codexMcpToolCallTool(type: string, item: Record<string, unknown>): Record<string, unknown> | null {
  const toolCallId = stringValue(item.id);
  if (!toolCallId) return null;
  const server = stringValue(item.server) || '';
  const tool = stringValue(item.tool) || '';
  return {
    toolCallId,
    kind: 'mcp_tool_call',
    title: [server, tool].filter(Boolean).join('/') || 'MCP tool call',
    description: codexMcpToolDescription(item),
    status: codexToolStatus(type, item),
    data: { server, tool, arguments: item.arguments, result: item.result, error: item.error },
  };
}

function codexGenericTool(type: string, item: Record<string, unknown>): Record<string, unknown> | null {
  const toolCallId = stringValue(item.id);
  if (!toolCallId) return null;
  const kind = stringValue(item.type) || 'tool';
  return {
    toolCallId,
    kind,
    title: codexToolTitle(item, kind),
    description: codexToolDescription(item),
    status: codexToolStatus(type, item),
  };
}

function codexFileChangeTitle(changes: Record<string, unknown>[]): string {
  if (changes.length === 1) return codexFileChangeLabel(changes[0]);
  return changes.length ? `${changes.length} file changes` : 'File changes';
}

function codexFileChangeDescription(item: Record<string, unknown>): string {
  const changes = Array.isArray(item.changes) ? item.changes.filter(isRecord) : [];
  return changes.map(codexFileChangeLabel).filter(Boolean).join('\n');
}

function codexFileChangeLabel(change: Record<string, unknown>): string {
  const path = stringValue(change.path);
  const kind = stringValue(change.kind);
  return [kind, path].filter(Boolean).join(' ');
}

function codexMcpToolDescription(item: Record<string, unknown>): string {
  const parts: string[] = [];
  if (item.arguments !== undefined) parts.push(`Arguments: ${safeJsonStringify(item.arguments)}`);
  if (item.result !== undefined) parts.push(`Result: ${safeJsonStringify(item.result)}`);
  if (isRecord(item.error) && typeof item.error.message === 'string') {
    parts.push(`Error: ${item.error.message}`);
  } else if (typeof item.error === 'string') {
    parts.push(`Error: ${item.error}`);
  }
  return parts.join('\n\n');
}

function codexToolStatus(type: string, item: Record<string, unknown>): string {
  if (type === 'item.started' || item.status === 'in_progress') return 'executing';
  if (item.status === 'failed' || item.status === 'error') return 'error';
  if (typeof item.exit_code === 'number' && item.exit_code !== 0) return 'error';
  if (type === 'item.completed' || item.status === 'completed') return 'success';
  if (item.status === 'canceled' || item.status === 'cancelled') return 'canceled';
  return 'pending';
}

function codexToolTitle(item: Record<string, unknown>, fallback: string): string {
  return stringValue(item.title) || stringValue(item.name) || stringValue(item.command) || fallback;
}

function codexToolDescription(item: Record<string, unknown>): string {
  return (
    stringValue(item.description) ||
    stringValue(item.aggregated_output) ||
    stringValue(item.output) ||
    stringValue(item.error) ||
    ''
  );
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

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
