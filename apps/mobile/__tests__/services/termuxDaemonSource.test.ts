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

  it('persists AionUi-style runtime summaries on local conversations', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain("runtime: idleRuntimeSummary('finished', 0)");
    expect(TERMUX_DAEMON_SOURCE).toContain('function runningRuntimeSummary(status, turnId, pendingConfirmationCount)');
    expect(TERMUX_DAEMON_SOURCE).toContain("const acceptedRuntime = runningRuntimeSummary('running', assistantMsgId");
    expect(TERMUX_DAEMON_SOURCE).toContain('conversation.runtime = acceptedRuntime;');
    expect(TERMUX_DAEMON_SOURCE).toContain("conversation.runtime = runningRuntimeSummary('waiting_confirmation', assistantMsgId, pendingConfirmationCount(conversationId));");
    expect(TERMUX_DAEMON_SOURCE).toContain("conversation.runtime = idleRuntimeSummary('finished', pendingConfirmationCount(conversationId));");
  });

  it('returns an AionUi-style send acknowledgement before detached local turn work completes', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain('void (async () => {');
    expect(TERMUX_DAEMON_SOURCE).toContain('msg_id: userMessage.msg_id');
    expect(TERMUX_DAEMON_SOURCE).toContain('turn_id: assistantMsgId');
    expect(TERMUX_DAEMON_SOURCE).toContain('runtime: acceptedRuntime');
  });

  it('returns an AionUi-style runtime acknowledgement when stopping local turns', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain("const runtime = idleRuntimeSummary('finished', pendingConfirmationCount(conversationId));");
    expect(TERMUX_DAEMON_SOURCE).toContain('return { success: true, stopped: true, runtime };');
  });

  it('emits AionUi-style turn.completed events after local turns finish', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain("emit('turn.completed', buildTurnCompletedEvent");
    expect(TERMUX_DAEMON_SOURCE).toContain('function buildTurnCompletedEvent');
    expect(TERMUX_DAEMON_SOURCE).toContain('state: turnStateFromRuntime(runtime)');
    expect(TERMUX_DAEMON_SOURCE).toContain("detail: ''");
    expect(TERMUX_DAEMON_SOURCE).toContain('last_message: {');
    expect(TERMUX_DAEMON_SOURCE).toContain('return message;');
  });

  it('emits AionUi-style message.userCreated events after persisting local user messages', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain("emit('message.userCreated', buildUserCreatedEvent(userMessage));");
    expect(TERMUX_DAEMON_SOURCE).toContain('function buildUserCreatedEvent(message)');
    expect(TERMUX_DAEMON_SOURCE).toContain("position: 'right'");
    expect(TERMUX_DAEMON_SOURCE).toContain("status: 'finish'");
    expect(TERMUX_DAEMON_SOURCE).toContain('created_at: message.createdAt');
  });

  it('emits AionUi-style conversation.listChanged events for local conversation mutations', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain("emitListChanged(emit, conversation.id, 'created');");
    expect(TERMUX_DAEMON_SOURCE).toContain("emitListChanged(emit, conversationId, 'updated');");
    expect(TERMUX_DAEMON_SOURCE).toContain("emitListChanged(emit, id, 'deleted');");
    expect(TERMUX_DAEMON_SOURCE).toContain('function emitListChanged(emit, conversationId, action)');
    expect(TERMUX_DAEMON_SOURCE).toContain("emit('conversation.listChanged', { conversation_id: conversationId, action, source: 'local' });");
  });

  it('mirrors the AionUi conversation artifact contract locally', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain('const artifacts = new Map();');
    expect(TERMUX_DAEMON_SOURCE).toContain("if (key === 'conversation.list-artifacts') return listArtifacts(requiredString(params.conversation_id));");
    expect(TERMUX_DAEMON_SOURCE).toContain("if (key === 'conversation.update-artifact') return await updateArtifactStatus(params, emit);");
    expect(TERMUX_DAEMON_SOURCE).toContain('artifacts: Object.fromEntries(artifacts.entries())');
    expect(TERMUX_DAEMON_SOURCE).toContain('function listArtifacts(conversationId)');
    expect(TERMUX_DAEMON_SOURCE).toContain('async function updateArtifactStatus(params, emit)');
    expect(TERMUX_DAEMON_SOURCE).toContain("emit('conversation.artifact', updated);");
    expect(TERMUX_DAEMON_SOURCE).toContain('function artifactStatusParam(value)');
  });

  it('routes OpenCode question events through the local confirmation channel', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain('const pendingQuestions = new Map();');
    expect(TERMUX_DAEMON_SOURCE).toContain('onQuestion: emitAssistantQuestion');
    expect(TERMUX_DAEMON_SOURCE).toContain('onQuestionResolved: emitAssistantQuestionResolved');
    expect(TERMUX_DAEMON_SOURCE).toContain('createOpenCodeQuestionEventExtractor');
    expect(TERMUX_DAEMON_SOURCE).toContain("type !== 'question.v2.asked' && type !== 'question.asked'");
    expect(TERMUX_DAEMON_SOURCE).toContain("type !== 'question.v2.replied' && type !== 'question.replied'");
    expect(TERMUX_DAEMON_SOURCE).toContain('function toOpenCodeQuestionConfirmation(request, conversationId, msgId, baseUrl)');
    expect(TERMUX_DAEMON_SOURCE).toContain("command_type: 'question'");
    expect(TERMUX_DAEMON_SOURCE).toContain('async function replyOpenCodeQuestion(record, answers)');
    expect(TERMUX_DAEMON_SOURCE).toContain('async function rejectOpenCodeQuestion(record)');
    expect(TERMUX_DAEMON_SOURCE).toContain("'/api/session/' + encodeURIComponent(record.sessionId) + '/question/'");
  });
});
