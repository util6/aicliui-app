import { bridge } from './bridge';

export type AgentSource = 'internal' | 'builtin' | 'extension' | 'custom';
export type AgentManagementStatus = 'online' | 'offline' | 'missing' | 'unchecked';

export type AgentEnvironmentEntry = {
  name: string;
  value: string;
  description?: string;
};

export type ManagedAgent = {
  id: string;
  icon?: string;
  name: string;
  description?: string;
  backend?: string;
  agent_type: string;
  agent_source: AgentSource;
  enabled: boolean;
  installed: boolean;
  command?: string;
  args: string[];
  env: AgentEnvironmentEntry[];
  native_skills_dirs?: string[];
  yolo_id?: string;
  status: AgentManagementStatus;
  last_check_error_message?: string;
  last_check_guidance?: string;
  last_check_latency_ms?: number;
};

export type CustomAgentDraft = {
  name: string;
  command: string;
  icon?: string;
  args: string[];
  env: AgentEnvironmentEntry[];
  description?: string;
};

export type CustomAgentProbeResult =
  | { step: 'success' }
  | { step: 'fail_cli' | 'fail_acp' | 'fail_auth'; error: string };

export function listManagedAgents(): Promise<ManagedAgent[]> {
  return bridge.request<ManagedAgent[]>('agents.management.list');
}

export function healthCheckAgent(id: string): Promise<ManagedAgent> {
  return bridge.request<ManagedAgent>('agents.health-check', { id });
}

export function setAgentEnabled(id: string, enabled: boolean): Promise<void> {
  return bridge.request('agents.set-enabled', { id, enabled });
}

export function createCustomAgent(draft: CustomAgentDraft): Promise<void> {
  return bridge.request('agents.custom.create', customAgentPayload(draft));
}

export function updateCustomAgent(id: string, draft: CustomAgentDraft): Promise<void> {
  return bridge.request('agents.custom.update', { id, ...customAgentPayload(draft) });
}

export function deleteCustomAgent(id: string): Promise<void> {
  return bridge.request('agents.custom.delete', { id });
}

export function testCustomAgent(draft: CustomAgentDraft): Promise<CustomAgentProbeResult> {
  return bridge.request<CustomAgentProbeResult>('agents.custom.test', {
    command: draft.command,
    acp_args: draft.args,
    env: Object.fromEntries(draft.env.map((entry) => [entry.name, entry.value])),
  });
}

function customAgentPayload(draft: CustomAgentDraft) {
  return {
    name: draft.name,
    command: draft.command,
    ...(draft.icon ? { icon: draft.icon } : {}),
    args: draft.args,
    env: draft.env,
    ...(draft.description ? { advanced: { description: draft.description } } : {}),
  };
}

// Mirrors AionUi's custom-agent argument parser so quoted ACP arguments remain intact.
export function parseAgentArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (const char of input.trim()) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) args.push(current);
  return args;
}

export function parseEnvironmentText(input: string): AgentEnvironmentEntry[] {
  return input.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return [];
    const separator = trimmed.indexOf('=');
    if (separator <= 0) return [];
    const name = trimmed.slice(0, separator).trim();
    if (!name) return [];
    return [{ name, value: trimmed.slice(separator + 1) }];
  });
}

export function serializeEnvironmentEntries(entries: AgentEnvironmentEntry[]): string {
  return entries.map((entry) => `${entry.name}=${entry.value}`).join('\n');
}
