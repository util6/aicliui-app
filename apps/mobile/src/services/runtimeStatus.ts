import { bridge } from './bridge';

export type RuntimeInstallState = 'missing' | 'installing' | 'ready' | 'error';

export type RuntimeAgentHealth = {
  backend: string;
  state: RuntimeInstallState;
  version?: string;
  detail?: string;
};

export type RuntimeStatus = {
  daemon: {
    version: string;
    startedAt: number;
  };
  termux: {
    runCommandPermission: 'unknown' | 'granted' | 'denied';
    allowExternalApps: 'unknown' | 'enabled' | 'disabled';
  };
  agents: RuntimeAgentHealth[];
};

export function getRuntimeStatus(timeoutMs = 5000): Promise<RuntimeStatus> {
  return bridge.request<RuntimeStatus>('runtime.get-status', undefined, timeoutMs);
}

export function getAgentDisplayName(backend: string): string {
  if (backend === 'opencode') return 'OpenCode';
  if (backend === 'gemini') return 'Gemini CLI';
  return backend;
}

export function getAgentStateLabelKey(state: RuntimeInstallState): string {
  if (state === 'ready') return 'connect.statusReady';
  if (state === 'installing') return 'connect.statusInstalling';
  if (state === 'error') return 'connect.statusError';
  return 'connect.statusMissing';
}
