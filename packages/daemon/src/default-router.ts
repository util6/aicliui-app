import type { AgentInfo, Conversation, RuntimeStatus } from '@aicliui/shared';
import { BridgeRouter } from './bridge-router.js';

const startedAt = Date.now();

export function createDefaultRouter(): BridgeRouter {
  const router = new BridgeRouter();

  router.register('runtime.get-status', () => getRuntimeStatus());
  router.register('acp.get-available-agents', () => ({
    success: true,
    data: getAvailableAgents(),
  }));
  router.register('database.get-user-conversations', () => [] satisfies Conversation[]);
  router.register('database.get-conversation-messages', () => []);
  router.register('confirmation.list', () => []);

  return router;
}

export function getAvailableAgents(): AgentInfo[] {
  return [
    { backend: 'opencode', name: 'opencode', label: 'OpenCode' },
    { backend: 'gemini', name: 'gemini', label: 'Gemini CLI' },
  ];
}

export function getRuntimeStatus(): RuntimeStatus {
  return {
    daemon: {
      version: '0.1.0',
      startedAt,
    },
    termux: {
      runCommandPermission: 'unknown',
      allowExternalApps: 'unknown',
    },
    agents: [
      { backend: 'opencode', state: 'missing' },
      { backend: 'gemini', state: 'missing' },
    ],
  };
}
