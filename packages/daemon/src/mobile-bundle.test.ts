import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const daemonRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(daemonRoot, '../..');
const generatorPath = resolve(daemonRoot, 'scripts/build-mobile-bundle.mjs');
const generatedPath = resolve(repositoryRoot, 'apps/mobile/src/services/termuxDaemonSource.ts');

describe('Android daemon bundle', () => {
  it('is generated from the current daemon sources', () => {
    expect(() =>
      execFileSync(process.execPath, [generatorPath, '--check'], {
        cwd: repositoryRoot,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });

  it('contains a syntactically valid Node ESM program', async () => {
    const module = await import(generatedPath);
    const syntax = spawnSync(process.execPath, ['--input-type=module', '--check', '-'], {
      input: module.TERMUX_DAEMON_SOURCE,
      encoding: 'utf8',
    });

    expect(syntax.stderr).toBe('');
    expect(syntax.status).toBe(0);
    expect(module.TERMUX_DAEMON_SOURCE).toContain('new WebSocketServer');
    expect(module.TERMUX_DAEMON_SOURCE).not.toContain('@aicliui/shared');
    expect(module.TERMUX_DAEMON_SOURCE.split(/\r?\n/)).not.toContain('AICLIUI_DAEMON_SOURCE');
  });

  it('starts the generated WebSocket daemon on loopback', async () => {
    const module = await import(generatedPath);
    const directory = mkdtempSync(resolve(daemonRoot, '.mobile-bundle-smoke-'));
    const bundlePath = resolve(directory, 'aicliui-daemon.mjs');
    writeFileSync(bundlePath, module.TERMUX_DAEMON_SOURCE, 'utf8');
    const child = spawn(process.execPath, [bundlePath], {
      cwd: directory,
      env: {
        ...process.env,
        AICLIUI_HOME: resolve(directory, 'data'),
        AICLIUI_DAEMON_PORT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
      await waitForListening(child);
    } finally {
      await stopChild(child);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('marks the generated source as generated', () => {
    expect(readFileSync(generatedPath, 'utf8')).toContain('Do not edit');
  });
});

function waitForListening(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for generated daemon: ${stderr}`));
    }, 5000);
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout?.on('data', (chunk) => {
      if (!chunk.toString().includes('aicliui daemon listening on ws://127.0.0.1:')) return;
      clearTimeout(timeout);
      resolvePromise();
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Generated daemon exited before listening (${code}): ${stderr}`));
    });
  });
}

function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolvePromise) => {
    child.once('exit', () => resolvePromise());
    child.kill('SIGTERM');
  });
}
