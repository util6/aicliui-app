import { spawnSync } from 'node:child_process';
import { TERMUX_DAEMON_SOURCE } from '@/src/services/termuxDaemonSource';

const MOBILE_BRIDGE_ROUTES = [
  'runtime.get-status',
  'acp.get-available-agents',
  'acp.probe-model-info',
  'conversation.ensure-runtime',
  'conversation.set-config-option',
  'database.get-user-conversations',
  'database.get-conversation-messages',
  'conversation.get',
  'conversation.list-artifacts',
  'conversation.update-artifact',
  'conversation.get-slash-commands',
  'create-conversation',
  'remove-conversation',
  'update-conversation',
  'chat.send.message',
  'chat.stop.stream',
  'confirmation.list',
  'confirmation.confirm',
  'conversation.get-workspace',
  'workspace.removeEntry',
  'workspace.renameEntry',
  'fileSnapshot.compare',
  'fileSnapshot.diff',
  'fileSnapshot.stageFile',
  'fileSnapshot.stageAll',
  'fileSnapshot.unstageFile',
  'fileSnapshot.unstageAll',
  'fileSnapshot.discardFile',
  'get-file-by-dir',
  'read-file',
  'get-image-base64',
];

describe('generated Termux daemon bundle', () => {
  it('is a syntactically valid self-contained Node ESM program', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '--check', '-'], {
      input: TERMUX_DAEMON_SOURCE,
      encoding: 'utf8',
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(TERMUX_DAEMON_SOURCE).not.toContain('@aicliui/shared');
  });

  it.each(MOBILE_BRIDGE_ROUTES)('includes the %s bridge route', (route) => {
    expect(TERMUX_DAEMON_SOURCE).toContain(route);
  });

  it('bundles the three local CLI adapters and durable store', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain('opencode');
    expect(TERMUX_DAEMON_SOURCE).toContain('gemini');
    expect(TERMUX_DAEMON_SOURCE).toContain('codex');
    expect(TERMUX_DAEMON_SOURCE).toContain('JsonConversationStore');
    expect(TERMUX_DAEMON_SOURCE).toContain('upsertToolGroupMessage');
    expect(TERMUX_DAEMON_SOURCE).toContain('upsertStructuredMessage');
  });

  it('binds the app bridge to loopback only', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain('host: "127.0.0.1"');
  });
});
