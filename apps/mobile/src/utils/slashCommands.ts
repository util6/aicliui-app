export type SlashCommandKind = 'template' | 'builtin';
export type SlashCommandSource = 'acp' | 'builtin' | 'skill';
export type SlashCommandSelectionBehavior = 'execute' | 'insert';
export type SlashCommandCompletionBehavior = 'normal' | 'neutral_tip_on_empty';

export type SlashCommandItem = {
  name: string;
  description: string;
  kind: SlashCommandKind;
  source: SlashCommandSource;
  hint?: string;
  selectionBehavior?: SlashCommandSelectionBehavior;
  completionBehavior?: SlashCommandCompletionBehavior;
  emptyTurnTipCode?: string;
  emptyTurnTipParams?: Record<string, unknown>;
};

const SLASH_QUERY_RE = /^\/([a-zA-Z0-9_-]*)$/;

export function matchSlashQuery(input: string): string | null {
  const match = input.match(SLASH_QUERY_RE);
  return match ? match[1] : null;
}

export function filterSlashCommands(commands: SlashCommandItem[], query: string): SlashCommandItem[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) {
    return commands;
  }

  return commands.filter((command) => command.name.toLowerCase().includes(keyword));
}

type AvailableCommandPayload = {
  name?: unknown;
  command?: unknown;
  description?: unknown;
  hint?: unknown;
  input?: {
    hint?: unknown;
  };
  _meta?: {
    completion_behavior?: unknown;
    empty_turn_tip_code?: unknown;
    empty_turn_tip_params?: unknown;
  };
  completion_behavior?: unknown;
  completionBehavior?: unknown;
  empty_turn_tip_code?: unknown;
  emptyTurnTipCode?: unknown;
  empty_turn_tip_params?: unknown;
  emptyTurnTipParams?: unknown;
};

export function mapAvailableCommandsToSlashCommands(value: unknown): SlashCommandItem[] {
  const commands = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.commands) ? value.commands : [];

  return commands
    .filter(isRecord)
    .map(mapAvailableCommandToSlashCommand)
    .filter((command): command is SlashCommandItem => command !== undefined);
}

function mapAvailableCommandToSlashCommand(command: AvailableCommandPayload): SlashCommandItem | undefined {
  const name = stringValue(command.command) ?? stringValue(command.name);
  const description = stringValue(command.description);
  if (!name || !description) return undefined;

  const hint = stringValue(command.hint) ?? stringValue(command.input?.hint);
  const completionBehavior = normalizeCompletionBehavior(
    command.completion_behavior ?? command.completionBehavior ?? command._meta?.completion_behavior,
  );
  const emptyTurnTipCode =
    stringValue(command.empty_turn_tip_code) ??
    stringValue(command.emptyTurnTipCode) ??
    stringValue(command._meta?.empty_turn_tip_code);
  const emptyTurnTipParams = recordValue(
    command.empty_turn_tip_params ?? command.emptyTurnTipParams ?? command._meta?.empty_turn_tip_params,
  );

  return {
    name,
    description,
    kind: 'template',
    source: 'acp',
    selectionBehavior: 'insert',
    ...(hint ? { hint } : {}),
    ...(completionBehavior ? { completionBehavior } : {}),
    ...(emptyTurnTipCode ? { emptyTurnTipCode } : {}),
    ...(emptyTurnTipParams ? { emptyTurnTipParams } : {}),
  };
}

function normalizeCompletionBehavior(value: unknown): SlashCommandCompletionBehavior | undefined {
  return value === 'normal' || value === 'neutral_tip_on_empty' ? value : undefined;
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
