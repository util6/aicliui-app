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

  it('redacts local runtime failure messages before streaming them to chat', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain(
      "runtimeDisplayName(backend) + ' runtime failed: ' + formatRuntimeErrorMessage(error);",
    );
    expect(TERMUX_DAEMON_SOURCE).toContain('function formatRuntimeErrorMessage(error)');
    expect(TERMUX_DAEMON_SOURCE).toContain('function redactRuntimeErrorText(text)');
    expect(TERMUX_DAEMON_SOURCE).toContain('[redacted]');
  });

  it('authorizes WebSocket protocol headers with the same helper as the package daemon', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain(
      "if (token && !isAuthorized(request.headers['sec-websocket-protocol'], token)) {",
    );
    expect(TERMUX_DAEMON_SOURCE).toContain('function isAuthorized(protocolHeader, expected)');
    expect(TERMUX_DAEMON_SOURCE).toContain('Array.isArray(protocolHeader)');
    expect(TERMUX_DAEMON_SOURCE).toContain('protocolHeader.includes(expected)');
  });
});
