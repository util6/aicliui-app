import { spawn } from 'node:child_process';
import { buildOpenCodeServeCommand } from './opencode-adapter.js';
import { createOpenCodeClient, type OpenCodeSessionClient } from './opencode-client.js';

export type OpenCodeServeProcess = {
  onStdout(callback: (chunk: string) => void): void;
  onStderr?(callback: (chunk: string) => void): void;
  onExit?(callback: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  kill(): void;
};

export type OpenCodeServerManager = {
  ensureClient(): Promise<OpenCodeSessionClient>;
  stop(): void;
};

export type OpenCodeServerManagerOptions = {
  port?: number;
  startProcess?: (command: string, args: string[]) => OpenCodeServeProcess;
  createClient?: (baseUrl: string) => OpenCodeSessionClient;
  startupTimeoutMs?: number;
};

export function parseOpenCodeServeUrl(line: string): string | null {
  const match = line.match(/server listening on\s+(\S+)/i);
  if (!match) return null;
  const value = match[1];
  if (/^https?:\/\//i.test(value)) return value;
  if (/^\[.+\]:\d+$/.test(value)) return `http://${value}`;
  if (/^[\w.-]+:\d+$/.test(value)) return `http://${value}`;
  return null;
}

export function createOpenCodeServerManager(options?: OpenCodeServerManagerOptions): OpenCodeServerManager {
  const port = options?.port ?? 4096;
  const startProcess = options?.startProcess ?? startLocalProcess;
  const createClient = options?.createClient ?? ((baseUrl) => createOpenCodeClient({ baseUrl }));
  const startupTimeoutMs = options?.startupTimeoutMs ?? 30_000;
  let processRef: OpenCodeServeProcess | null = null;
  let clientPromise: Promise<OpenCodeSessionClient> | null = null;

  return {
    ensureClient() {
      clientPromise ??= new Promise<OpenCodeSessionClient>((resolve, reject) => {
        const spec = buildOpenCodeServeCommand({ port });
        const proc = startProcess(spec.command, spec.args);
        processRef = proc;
        const timer = setTimeout(() => {
          reject(new Error(`OpenCode server did not report a listening URL within ${startupTimeoutMs}ms`));
        }, startupTimeoutMs);

        proc.onStdout((chunk) => {
          const url = parseOpenCodeServeUrl(chunk);
          if (!url) return;
          clearTimeout(timer);
          resolve(createClient(url));
        });

        proc.onStderr?.((chunk) => {
          const url = parseOpenCodeServeUrl(chunk);
          if (!url) return;
          clearTimeout(timer);
          resolve(createClient(url));
        });

        proc.onExit?.((code, signal) => {
          clearTimeout(timer);
          clientPromise = null;
          processRef = null;
          reject(new Error(`OpenCode server exited before startup: code=${code ?? 'null'} signal=${signal ?? 'null'}`));
        });
      });
      return clientPromise;
    },

    stop() {
      processRef?.kill();
      processRef = null;
      clientPromise = null;
    },
  };
}

function startLocalProcess(command: string, args: string[]): OpenCodeServeProcess {
  const proc = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    onStdout(callback) {
      proc.stdout?.on('data', (chunk: Buffer) => callback(chunk.toString('utf8')));
    },
    onStderr(callback) {
      proc.stderr?.on('data', (chunk: Buffer) => callback(chunk.toString('utf8')));
    },
    onExit(callback) {
      proc.on('exit', callback);
      proc.on('error', (error) => {
        proc.emit('exit', 1, null);
        console.error('[opencode] failed to start server:', error);
      });
    },
    kill() {
      proc.kill();
    },
  };
}
