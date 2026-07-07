import { describe, expect, it } from 'vitest';
import {
  createOpenCodeServerManager,
  parseOpenCodeServeUrl,
  type OpenCodeServeProcess,
} from './opencode-server.js';

describe('OpenCode server manager', () => {
  it('parses OpenCode serve listening URLs from stdout', () => {
    expect(parseOpenCodeServeUrl('server listening on http://127.0.0.1:4096')).toBe('http://127.0.0.1:4096');
    expect(parseOpenCodeServeUrl('server listening on [::1]:4096')).toBe('http://[::1]:4096');
    expect(parseOpenCodeServeUrl('waiting')).toBeNull();
  });

  it('starts opencode serve once and returns a reusable client', async () => {
    const starts: Array<{ command: string; args: string[] }> = [];
    let stdout: ((chunk: string) => void) | undefined;
    const manager = createOpenCodeServerManager({
      startProcess(command, args) {
        starts.push({ command, args });
        return {
          onStdout(callback) {
            stdout = callback;
          },
          kill() {},
        } satisfies OpenCodeServeProcess;
      },
      createClient(baseUrl) {
        return {
          sendPrompt: async () => ({ sessionId: 'ses_123', text: baseUrl }),
        };
      },
    });

    const clientPromise = manager.ensureClient();
    stdout?.('server listening on http://127.0.0.1:4096\n');
    const first = await clientPromise;
    const second = await manager.ensureClient();

    await expect(first.sendPrompt({ prompt: 'hello' })).resolves.toEqual({
      sessionId: 'ses_123',
      text: 'http://127.0.0.1:4096',
    });
    expect(second).toBe(first);
    expect(starts).toEqual([
      { command: 'opencode', args: ['serve', '--hostname', '127.0.0.1', '--port', '4096'] },
    ]);
  });
});
