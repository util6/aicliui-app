import { execFile } from 'node:child_process';
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
};
