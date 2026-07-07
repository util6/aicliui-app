import { createFallbackAdapter } from './fallback-adapter.js';
import { createGeminiAdapter } from './gemini-adapter.js';
import { localCommandRunner } from './local-command-runner.js';
import { createOpenCodeAdapter } from './opencode-adapter.js';
import { createOpenCodeServerManager } from './opencode-server.js';
import { createAgentAdapterRegistry, type AgentAdapterRegistry } from './registry.js';

export function createDefaultAgentAdapterRegistry(): AgentAdapterRegistry {
  return createAgentAdapterRegistry([
    createOpenCodeAdapter(localCommandRunner, { serverManager: createOpenCodeServerManager() }),
    createGeminiAdapter(localCommandRunner),
  ]);
}

export function createFallbackAgentAdapterRegistry(): AgentAdapterRegistry {
  return createAgentAdapterRegistry([
    createFallbackAdapter('opencode', 'OpenCode'),
    createFallbackAdapter('gemini', 'Gemini CLI'),
  ]);
}
