import type { AgentInfo, AgentHealth } from '@aicliui/shared';
import type { CliAgentAdapter } from './types.js';

export type AgentAdapterRegistry = {
  listAgents(): AgentInfo[];
  get(backend: string): CliAgentAdapter | undefined;
  probeAll(): Promise<AgentHealth[]>;
};

export function createAgentAdapterRegistry(adapters: CliAgentAdapter[]): AgentAdapterRegistry {
  const byBackend = new Map(adapters.map((adapter) => [adapter.backend, adapter]));

  return {
    listAgents() {
      return adapters.map(({ backend, name, label }) => ({ backend, name, label }));
    },

    get(backend: string) {
      return byBackend.get(backend);
    },

    probeAll() {
      return Promise.all(adapters.map((adapter) => adapter.probe()));
    },
  };
}
