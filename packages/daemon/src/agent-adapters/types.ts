import type { AgentHealth } from '@aicliui/shared';

export type CliAgentEvent =
  | {
      type: 'content';
      content: string;
    }
  | {
      type: 'thought';
      subject: string;
      description: string;
    };

export type SendMessageInput = {
  conversationId: string;
  input: string;
  msgId?: string;
  workspace?: string;
  model?: string;
  sessionMode?: string;
  files?: string[];
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

export type CommandRunner = {
  commandExists(command: string): Promise<boolean>;
  readVersion?(command: string, args?: string[]): Promise<string | undefined>;
};

export type CliAgentAdapter = {
  backend: string;
  name: string;
  label?: string;
  probe(): Promise<AgentHealth>;
  sendMessage(input: SendMessageInput): AsyncIterable<CliAgentEvent>;
  getSlashCommands?(input: GetSlashCommandsInput): Promise<SlashCommandInfo[]>;
};
