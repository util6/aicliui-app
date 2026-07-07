import { TERMUX_DAEMON_SOURCE } from '@/src/services/termuxDaemonSource';

describe('Termux daemon OpenCode slash commands', () => {
  it('checks the OpenCode command list before dispatching a slash command', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain(
      'const slashCommand = await findOpenCodeSlashCommand(baseUrl, workspace, input, signal);',
    );
    expect(TERMUX_DAEMON_SOURCE).toContain('async function findOpenCodeSlashCommand');
    expect(TERMUX_DAEMON_SOURCE).toContain(
      'return commands.some((command) => command.command === slashCommand.command) ? slashCommand : null;',
    );
  });

  it('sends selected files as OpenCode command file parts', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain('const commandParts = await buildOpenCodeCommandParts(files, workspace);');
    expect(TERMUX_DAEMON_SOURCE).toContain('...(commandParts.length ? { parts: commandParts } : {}),');
    expect(TERMUX_DAEMON_SOURCE).toContain('async function buildOpenCodeCommandParts(files, workspace)');
    expect(TERMUX_DAEMON_SOURCE).toContain("type: 'file',");
    expect(TERMUX_DAEMON_SOURCE).toContain('url: pathToFileURL(filePath).toString(),');
    expect(TERMUX_DAEMON_SOURCE).toContain('filename: basename(filePath),');
  });
});
