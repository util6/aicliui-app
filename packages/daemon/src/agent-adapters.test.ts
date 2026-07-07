import { describe, expect, it } from 'vitest';
import { buildGeminiCommand, parseGeminiStreamJsonLine } from './agent-adapters/gemini-adapter.js';
import { buildOpenCodeServeCommand, createOpenCodeAdapter } from './agent-adapters/opencode-adapter.js';
import { createAgentAdapterRegistry } from './agent-adapters/registry.js';
import type { CliAgentAdapter } from './agent-adapters/types.js';

describe('agent adapters', () => {
  it('reports adapter health through the registry', async () => {
    const registry = createAgentAdapterRegistry([
      fakeAdapter({ backend: 'opencode', state: 'ready', version: '1.2.3' }),
      fakeAdapter({ backend: 'gemini', state: 'missing', detail: 'command not found' }),
    ]);

    await expect(registry.probeAll()).resolves.toEqual([
      { backend: 'opencode', state: 'ready', version: '1.2.3' },
      { backend: 'gemini', state: 'missing', detail: 'command not found' },
    ]);
  });

  it('builds Gemini CLI prompt commands for stream-json output', () => {
    expect(buildGeminiCommand({ prompt: 'hello', model: 'gemini-2.5-pro', approvalMode: 'yolo' })).toEqual({
      command: 'gemini',
      args: ['-p', 'hello', '--output-format', 'stream-json', '--model', 'gemini-2.5-pro', '--approval-mode', 'yolo'],
    });
  });

  it('extracts text deltas from common Gemini stream-json shapes', () => {
    expect(parseGeminiStreamJsonLine(JSON.stringify({ type: 'content', value: 'hello' }))).toEqual({
      type: 'content',
      content: 'hello',
    });
    expect(parseGeminiStreamJsonLine(JSON.stringify({ delta: ' world' }))).toEqual({
      type: 'content',
      content: ' world',
    });
    expect(parseGeminiStreamJsonLine('not json')).toBeNull();
  });

  it('builds the OpenCode local API server command shape', () => {
    expect(buildOpenCodeServeCommand({ port: 4096 })).toEqual({
      command: 'opencode',
      args: ['serve', '--hostname', '127.0.0.1', '--port', '4096'],
    });
  });

  it('streams OpenCode client responses when a local API client is available', async () => {
    const adapter = createOpenCodeAdapter(
      {
        commandExists: async () => true,
      },
      {
        client: {
          sendPrompt: async () => ({ sessionId: 'ses_123', text: 'from opencode' }),
        },
      },
    );

    const events = [];
    for await (const event of adapter.sendMessage({ conversationId: 'conv-1', input: 'hello' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'thought', subject: 'OpenCode', description: 'session ses_123' },
      { type: 'content', content: 'from opencode' },
    ]);
  });

  it('uses an OpenCode server manager when a direct client was not injected', async () => {
    const adapter = createOpenCodeAdapter(
      {
        commandExists: async () => true,
      },
      {
        serverManager: {
          ensureClient: async () => ({
            sendPrompt: async () => ({ sessionId: 'ses_456', text: 'from managed opencode' }),
          }),
        },
      },
    );

    const events = [];
    for await (const event of adapter.sendMessage({ conversationId: 'conv-1', input: 'hello' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'thought', subject: 'OpenCode', description: 'session ses_456' },
      { type: 'content', content: 'from managed opencode' },
    ]);
  });
});

function fakeAdapter(health: Awaited<ReturnType<CliAgentAdapter['probe']>>): CliAgentAdapter {
  return {
    backend: health.backend,
    name: health.backend,
    label: health.backend,
    probe: async () => health,
    sendMessage: async function* () {
      yield { type: 'content', content: 'ok' };
    },
  };
}
