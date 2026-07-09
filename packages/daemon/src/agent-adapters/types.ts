import type { AgentHealth, AgentModelInfo, ConversationArtifact } from '@aicliui/shared';

export type CliAgentEvent =
  | {
      type: 'content';
      content: string;
    }
  | {
      type: 'thought';
      subject: string;
      description: string;
    }
  | {
      type: 'thinking';
      content: string;
      subject?: string;
      duration?: number;
      status?: 'thinking' | 'done';
    }
  | {
      type: 'tool_call';
      data: unknown;
    }
  | {
      type: 'tool_group';
      tools: unknown[];
    }
  | {
      type: 'acp_tool_call';
      data: unknown;
    }
  | {
      type: 'codex_tool_call';
      data: unknown;
    }
  | {
      type: 'plan';
      data: unknown;
    }
  | {
      type: 'context_usage';
      used: number;
      size: number;
    }
  | {
      type: 'artifact';
      artifact: ConversationArtifact;
    }
  | {
      type: 'agent_status';
      data: unknown;
    }
  | {
      type: 'available_commands';
      commands: SlashCommandInfo[];
    }
  | {
      type: 'permission';
      confirmation: CliConfirmation;
    }
  | {
      type: 'permission_resolved';
      confirmationId: string;
    };

export type CliConfirmation = {
  id: string;
  msg_id?: string;
  conversation_id?: string;
  title?: string;
  action?: string;
  description: string;
  call_id?: string;
  callId?: string;
  options: Array<{
    label: string;
    value: unknown;
    params?: Record<string, string>;
  }>;
  command_type?: string;
  [key: string]: unknown;
};

export type ConfirmActionInput = {
  conversationId: string;
  confirmationId: string;
  callId?: string;
  data: unknown;
};

export type AbortActionInput = {
  conversationId: string;
};

export type SendMessageInput = {
  conversationId: string;
  input: string;
  msgId?: string;
  workspace?: string;
  model?: string;
  sessionMode?: string;
  files?: string[];
  signal?: AbortSignal;
};

export type SlashCommandInfo = {
  command: string;
  description: string;
  hint?: string;
};

export type GetSlashCommandsInput = {
  conversationId: string;
  workspace?: string;
};

export type CommandSpec = {
  command: string;
  args: string[];
};

export type CommandRunOptions = {
  cwd?: string;
  signal?: AbortSignal;
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
};

export type CommandRunResult = {
  stdout: string;
  stderr: string;
};

export type CommandRunner = {
  commandExists(command: string): Promise<boolean>;
  readVersion?(command: string, args?: string[]): Promise<string | undefined>;
  runCommand?(spec: CommandSpec, options?: CommandRunOptions): Promise<CommandRunResult>;
};

export type CliAgentAdapter = {
  backend: string;
  name: string;
  label?: string;
  probe(): Promise<AgentHealth>;
  getModelInfo?(): Promise<AgentModelInfo | null> | AgentModelInfo | null;
  sendMessage(input: SendMessageInput): AsyncIterable<CliAgentEvent>;
  getSlashCommands?(input: GetSlashCommandsInput): Promise<SlashCommandInfo[]>;
  confirm?(input: ConfirmActionInput): Promise<unknown> | unknown;
  abort?(input: AbortActionInput): Promise<unknown> | unknown;
};
