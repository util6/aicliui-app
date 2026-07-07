import type { TMessage } from './messageAdapter';

export type NormalizedToolStatus = 'pending' | 'running' | 'completed' | 'error' | 'canceled';

export type NormalizedToolCall = {
  key: string;
  name: string;
  status: NormalizedToolStatus;
  description?: string;
  input?: string;
  output?: string;
  truncated?: boolean;
  messageId?: string;
  conversationId?: string;
  imagePath?: string;
};

export function normalizeToolMessages(messages: TMessage[]): NormalizedToolCall[] {
  return messages
    .flatMap((message) => {
      if (message.type === 'tool_group') return normalizeToolGroup(message);
      if (message.type === 'tool_call') return normalizeToolCall(message);
      if (message.type === 'acp_tool_call') return normalizeAcpToolCall(message);
      if (message.type === 'codex_tool_call') return normalizeCodexToolCall(message);
      return undefined;
    })
    .filter((tool): tool is NormalizedToolCall => tool !== undefined);
}

export function hasRunningNormalizedTools(tools: NormalizedToolCall[]): boolean {
  return tools.some((tool) => tool.status === 'running');
}

export function isNormalizedToolBatchComplete(tools: NormalizedToolCall[]): boolean {
  return tools.every((tool) => tool.status === 'completed' || tool.status === 'error' || tool.status === 'canceled');
}

export function countNormalizedToolErrors(tools: NormalizedToolCall[]): number {
  return tools.filter((tool) => tool.status === 'error').length;
}

export function getCurrentNormalizedToolName(tools: NormalizedToolCall[]): string {
  for (let i = tools.length - 1; i >= 0; i--) {
    if (tools[i].status === 'running') return tools[i].description || tools[i].name;
  }
  return '';
}

function normalizeToolGroup(message: TMessage): NormalizedToolCall[] {
  if (!Array.isArray(message.content)) return [];

  return message.content
    .map((tool: any, index: number): NormalizedToolCall | undefined => {
      const key = stringValue(tool.call_id ?? tool.callId) ?? `${message.id}-${index}`;
      const name = stringValue(tool.name) ?? 'Tool';
      const confirmationDetails = isRecord(tool.confirmationDetails) ? tool.confirmationDetails : undefined;
      const description = getToolGroupDescription(tool, confirmationDetails);
      const input = getToolGroupInput(tool, confirmationDetails);

      const output = getResultDisplayText(tool.result_display ?? tool.resultDisplay);

      return {
        key,
        name,
        status: normalizeToolGroupStatus(stringValue(tool.status)),
        ...(description ? { description } : {}),
        ...(input ? { input } : {}),
        ...(output ? { output } : {}),
      };
    })
    .filter((tool): tool is NormalizedToolCall => tool !== undefined);
}

function normalizeToolCall(message: TMessage): NormalizedToolCall | undefined {
  const content = message.content;
  const key = stringValue(content?.call_id ?? content?.callId);
  if (!key) return undefined;

  const input = content.input
    ? formatValue(content.input)
    : isRecord(content.args) && Object.keys(content.args).length > 0
      ? formatValue(content.args)
      : undefined;

  return {
    key,
    name: stringValue(content.name) ?? 'Tool',
    status: normalizeGenericStatus(stringValue(content.status)),
    ...(stringValue(content.description) ? { description: stringValue(content.description) } : {}),
    ...(input ? { input } : {}),
    ...(stringValue(content.output) ? { output: stringValue(content.output) } : {}),
  };
}

function normalizeAcpToolCall(message: TMessage): NormalizedToolCall | undefined {
  const content = message.content;
  const update = content?.update;
  if (!isRecord(update)) return undefined;

  const key = stringValue(update.tool_call_id ?? update.toolCallId);
  if (!key) return undefined;

  const kind = stringValue(update.kind) ?? '';
  const rawInput = recordValue(update.rawInput ?? update.raw_input);
  const input = rawInput ? formatValue(rawInput) : undefined;
  const output = getAcpOutput(update);
  const description = buildParamSummary(kind, rawInput) ?? stringValue(update.description) ?? kind;

  return {
    key,
    name: stringValue(update.title) ?? (kind || 'Tool'),
    status: normalizeAcpStatus(stringValue(update.status)),
    ...(description ? { description } : {}),
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
    ...(content?._compact?.truncated === true ? { truncated: true } : {}),
    messageId: message.id,
    conversationId: message.conversation_id,
  };
}

function normalizeCodexToolCall(message: TMessage): NormalizedToolCall | undefined {
  const content = message.content;
  const key = stringValue(content?.toolCallId ?? content?.tool_call_id ?? content?.id);
  if (!key) return undefined;

  const data = isRecord(content.data) ? content.data : {};
  const inputValue = data.arguments ?? data.input ?? content.input ?? content.args;
  const outputValue = data.result ?? data.output ?? data.unified_diff ?? content.output ?? content.result;
  const kind = stringValue(content.kind) ?? stringValue(content.subtype) ?? 'codex_tool_call';
  const description = stringValue(content.description) ?? buildCodexDescription(kind, data);

  return {
    key,
    name: stringValue(content.title) ?? stringValue(content.name) ?? kind,
    status: normalizeGenericStatus(stringValue(content.status)),
    ...(description ? { description } : {}),
    ...(inputValue !== undefined ? { input: formatValue(inputValue) } : {}),
    ...(outputValue !== undefined ? { output: formatValue(outputValue) } : {}),
    messageId: message.id,
    conversationId: message.conversation_id,
  };
}

function normalizeToolGroupStatus(status: string | undefined): NormalizedToolStatus {
  switch (status) {
    case 'Success':
      return 'completed';
    case 'Error':
      return 'error';
    case 'Canceled':
    case 'Cancelled':
      return 'canceled';
    case 'Pending':
      return 'pending';
    case 'Executing':
    case 'Confirming':
      return 'running';
    default:
      return normalizeGenericStatus(status);
  }
}

function normalizeAcpStatus(status: string | undefined): NormalizedToolStatus {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'error';
    case 'in_progress':
      return 'running';
    case 'pending':
    default:
      return 'pending';
  }
}

function normalizeGenericStatus(status: string | undefined): NormalizedToolStatus {
  const value = status?.toLowerCase();
  if (value === 'success' || value === 'completed' || value === 'done') return 'completed';
  if (value === 'error' || value === 'failed') return 'error';
  if (value === 'canceled' || value === 'cancelled') return 'canceled';
  if (value === 'running' || value === 'executing' || value === 'in_progress') return 'running';
  return 'pending';
}

function getToolGroupDescription(tool: any, confirmationDetails?: Record<string, any>): string | undefined {
  const type = stringValue(confirmationDetails?.type);
  if (type === 'edit') return stringValue(confirmationDetails?.file_name);
  if (type === 'exec') return stringValue(confirmationDetails?.command);
  if (type === 'info') return arrayOfStrings(confirmationDetails?.urls)?.join(';') || stringValue(confirmationDetails?.title);
  if (type === 'mcp') {
    const server = stringValue(confirmationDetails?.server_name);
    const toolName = stringValue(confirmationDetails?.tool_name);
    return server && toolName ? `${server}:${toolName}` : toolName ?? server;
  }
  return stringValue(tool.description)?.slice(0, 100);
}

function getToolGroupInput(tool: any, confirmationDetails?: Record<string, any>): string | undefined {
  if (!confirmationDetails) return stringValue(tool.description);

  const { title: _title, type: _type, ...rest } = confirmationDetails;
  return Object.keys(rest).length > 0 ? formatValue(rest) : undefined;
}

function getResultDisplayText(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return formatValue(value);
  return stringValue(value.file_diff) ?? stringValue(value.relative_path) ?? stringValue(value.img_url);
}

function getAcpOutput(update: Record<string, any>): string | undefined {
  if (!Array.isArray(update.content)) return undefined;
  return update.content
    .map((item) => {
      if (!isRecord(item)) return '';
      if (item.type === 'content' && isRecord(item.content) && typeof item.content.text === 'string') {
        return item.content.text;
      }
      if (item.type === 'diff' && typeof item.path === 'string') return `[diff] ${item.path}`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function buildParamSummary(kind: string, rawInput?: Record<string, unknown>): string | undefined {
  if (!rawInput) return undefined;
  if (kind === 'read' || kind === 'edit') {
    return stringValue(rawInput.file_path) ?? stringValue(rawInput.path) ?? stringValue(rawInput.file_name);
  }
  if (kind === 'execute') return stringValue(rawInput.command);
  if (kind === 'search' || kind === 'grep') {
    const parts: string[] = [];
    if (rawInput.pattern) parts.push(`"${rawInput.pattern}"`);
    if (rawInput.path) parts.push(`in ${rawInput.path}`);
    else if (rawInput.glob) parts.push(`in ${rawInput.glob}`);
    return parts.length > 0 ? parts.join(' ') : undefined;
  }
  if (kind === 'glob') {
    const parts: string[] = [];
    if (rawInput.pattern) parts.push(String(rawInput.pattern));
    if (rawInput.path) parts.push(`in ${rawInput.path}`);
    return parts.length > 0 ? parts.join(' ') : undefined;
  }
  if (kind === 'write') return stringValue(rawInput.file_path) ?? stringValue(rawInput.path);

  for (const key of ['file_path', 'command', 'path', 'pattern', 'query', 'url']) {
    const value = stringValue(rawInput[key]);
    if (value) return value;
  }
  return undefined;
}

function buildCodexDescription(kind: string, data: Record<string, unknown>): string | undefined {
  if (kind === 'web_search') return stringValue(data.query);
  if (kind === 'file_change') return stringValue(data.path) ?? stringValue(data.file_path);
  if (kind === 'command_execution') return stringValue(data.command);
  return undefined;
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function arrayOfStrings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
}
