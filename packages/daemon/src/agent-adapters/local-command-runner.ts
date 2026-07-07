import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { CommandRunner } from './types.js';

const execFileAsync = promisify(execFile);

export const localCommandRunner: CommandRunner = {
  async commandExists(command) {
    try {
      await execFileAsync('sh', ['-lc', 'command -v "$1" >/dev/null 2>&1', 'sh', command]);
      return true;
    } catch {
      return false;
    }
  },

  async readVersion(command, args = ['--version']) {
    try {
      const result = await execFileAsync(command, args, { timeout: 10_000 });
      return (result.stdout || result.stderr).trim() || undefined;
    } catch {
      return undefined;
    }
  },

  runCommand(spec, options = {}) {
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(options.signal.reason ?? new Error('Process aborted'));
        return;
      }

      const child = spawn(spec.command, spec.args, {
        cwd: options.cwd ?? process.env.HOME ?? process.cwd(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';

      const appendStdout = (chunk: Buffer) => {
        stdout += chunk.toString();
        options.onStdout?.(chunk);
      };
      const appendStderr = (chunk: Buffer) => {
        stderr += chunk.toString();
        if (stderr.length > 8000) stderr = stderr.slice(-8000);
        options.onStderr?.(chunk);
      };
      const abort = () => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 1500).unref();
      };

      options.signal?.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', appendStdout);
      child.stderr.on('data', appendStderr);
      child.on('error', (error) => {
        options.signal?.removeEventListener('abort', abort);
        reject(error);
      });
      child.on('exit', (code) => {
        options.signal?.removeEventListener('abort', abort);
        if (options.signal?.aborted) {
          reject(options.signal.reason ?? new Error('Process aborted'));
          return;
        }
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(new Error(`${spec.command} exited with code ${code ?? 'null'}: ${(stderr || stdout).slice(-1000)}`));
      });
    });
  },
};
