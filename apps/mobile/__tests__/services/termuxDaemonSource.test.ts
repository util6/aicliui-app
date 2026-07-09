import { TERMUX_DAEMON_SOURCE } from '@/src/services/termuxDaemonSource';

function extractEmbeddedFunctionSource(name: string): string {
  const marker = `function ${name}`;
  const start = TERMUX_DAEMON_SOURCE.indexOf(marker);
  if (start === -1) throw new Error(`Embedded function ${name} was not found`);

  const bodyStart = TERMUX_DAEMON_SOURCE.indexOf('{', start);
  if (bodyStart === -1) throw new Error(`Embedded function ${name} has no body`);

  let depth = 0;
  for (let index = bodyStart; index < TERMUX_DAEMON_SOURCE.length; index += 1) {
    const char = TERMUX_DAEMON_SOURCE[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) {
      return TERMUX_DAEMON_SOURCE.slice(start, index + 1);
    }
  }

  throw new Error(`Embedded function ${name} body was not closed`);
}

function loadEmbeddedFunction<T extends (...args: any[]) => any>(name: string, dependencies: string[] = []): T {
  const source = [...dependencies, name].map(extractEmbeddedFunctionSource).join('\n');
  return new Function(`${source}; return ${name};`)() as T;
}

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

  it('routes OpenCode reasoning events through the local thinking stream', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain('onThinking: emitAssistantThinking');
    expect(TERMUX_DAEMON_SOURCE).toContain('createOpenCodeReasoningEventExtractor');
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.reasoning.delta'");
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.reasoning.ended'");
    expect(TERMUX_DAEMON_SOURCE).toContain("type: 'thinking',");
    expect(TERMUX_DAEMON_SOURCE).toContain(
      "subject: typeof update.subject === 'string' ? update.subject : 'OpenCode reasoning'",
    );
    expect(TERMUX_DAEMON_SOURCE).toContain("status: 'done'");
  });

  it('routes OpenCode text ended events through the local content stream', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.text.ended'");
    expect(TERMUX_DAEMON_SOURCE).toContain('const textId = stringValue(data.textID)');
    expect(TERMUX_DAEMON_SOURCE).toContain('textByPartId.set(textId, data.text)');
    expect(TERMUX_DAEMON_SOURCE).toContain('return data.text.startsWith(previous) ? data.text.slice(previous.length) : data.text;');
  });

  it('routes OpenCode synthetic text events through the local content stream', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.synthetic'");
    expect(TERMUX_DAEMON_SOURCE).toContain("return data.text;");
  });

  it('routes OpenCode compaction events through the local thinking stream', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain('createOpenCodeCompactionEventExtractor');
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.compaction.started'");
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.compaction.delta'");
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.compaction.ended'");
    expect(TERMUX_DAEMON_SOURCE).toContain("subject: 'OpenCode compaction'");
    expect(TERMUX_DAEMON_SOURCE).toContain(
      "subject: typeof update.subject === 'string' ? update.subject : 'OpenCode reasoning'",
    );
  });

  it('routes OpenCode v2 tool lifecycle events through the local tool stream', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain('createOpenCodeToolUpdateExtractor');
    expect(TERMUX_DAEMON_SOURCE).toContain('function extractOpenCodeNextToolUpdate(event, sessionId, toolByCallId)');
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.tool.called'");
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.tool.progress'");
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.tool.success'");
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.tool.failed'");
    expect(TERMUX_DAEMON_SOURCE).toContain('function openCodeNextToolDisplay(data)');
  });

  it('routes OpenCode v2 tool input lifecycle events through the local tool stream', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.tool.input.started'");
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.tool.input.delta'");
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.tool.input.ended'");
    expect(TERMUX_DAEMON_SOURCE).toContain('inputText: nextInputText');
    expect(TERMUX_DAEMON_SOURCE).toContain("openCodeToolUpdate(callId, cached.name, description, 'Pending', nextInputText)");
  });

  it('routes OpenCode v2 shell lifecycle events through the local tool stream', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain('function extractOpenCodeShellToolUpdate(event, sessionId, toolByCallId)');
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.shell.started'");
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.shell.ended'");
    expect(TERMUX_DAEMON_SOURCE).toContain("openCodeToolUpdate(callId, 'shell', command, 'Executing', '')");
    expect(TERMUX_DAEMON_SOURCE).toContain("openCodeToolUpdate(callId, cached.name, cached.description, 'Success', output)");
  });

  it('routes OpenCode v2 step usage events through the local context usage stream', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain('createOpenCodeContextUsageExtractor');
    expect(TERMUX_DAEMON_SOURCE).toContain('function extractOpenCodeContextUsage(event, sessionId)');
    expect(TERMUX_DAEMON_SOURCE).toContain("type !== 'session.next.step.ended'");
    expect(TERMUX_DAEMON_SOURCE).toContain('function openCodeContextUsageFromTokens(tokens)');
    expect(TERMUX_DAEMON_SOURCE).toContain("type: 'acp_context_usage'");
  });

  it('routes OpenCode v2 step lifecycle events through the local agent status stream', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain('onAgentStatus: emitAssistantAgentStatus');
    expect(TERMUX_DAEMON_SOURCE).toContain('createOpenCodeAgentStatusExtractor');
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.step.started'");
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.step.failed'");
    expect(TERMUX_DAEMON_SOURCE).toContain('function openCodeStepFailedStatus(data, sessionId)');
    expect(TERMUX_DAEMON_SOURCE).toContain("type: 'agent_status'");
  });

  it('routes OpenCode v2 session metadata events through the local agent status stream', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.agent.switched'");
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.model.switched'");
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.moved'");
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.context.updated'");
    expect(TERMUX_DAEMON_SOURCE).toContain('function openCodeAgentSwitchedStatus(data, sessionId)');
    expect(TERMUX_DAEMON_SOURCE).toContain('function openCodeModelSwitchedStatus(data, sessionId)');
    expect(TERMUX_DAEMON_SOURCE).toContain('function openCodeMovedStatus(data, sessionId)');
    expect(TERMUX_DAEMON_SOURCE).toContain('function openCodeContextUpdatedStatus(data, sessionId)');
    expect(TERMUX_DAEMON_SOURCE).toContain("openCodeAgentStatusBase('workspace_moved', sessionId)");
  });

  it('routes OpenCode retry events through the local agent status stream', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.retried'");
    expect(TERMUX_DAEMON_SOURCE).toContain('function openCodeRetriedStatus(data, sessionId)');
    expect(TERMUX_DAEMON_SOURCE).toContain("openCodeAgentStatusBase('retrying', sessionId)");
    expect(TERMUX_DAEMON_SOURCE).toContain('Retrying OpenCode request');
  });

  it('routes OpenCode prompt lifecycle and interrupt events through the local agent status stream', () => {
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.prompted'");
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.prompt.admitted'");
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.prompt.promoted'");
    expect(TERMUX_DAEMON_SOURCE).toContain("type === 'session.next.interrupt.requested'");
    expect(TERMUX_DAEMON_SOURCE).toContain('function openCodePromptedStatus(data, sessionId)');
    expect(TERMUX_DAEMON_SOURCE).toContain('function openCodePromptAdmittedStatus(data, sessionId)');
    expect(TERMUX_DAEMON_SOURCE).toContain('function openCodePromptPromotedStatus(data, sessionId)');
    expect(TERMUX_DAEMON_SOURCE).toContain('function openCodeInterruptRequestedStatus(sessionId)');
  });

  it('parses OpenCode serve listening URLs like the package daemon', () => {
    const parseOpenCodeServeUrl = loadEmbeddedFunction<(line: string) => string | null>('parseOpenCodeServeUrl');

    expect(parseOpenCodeServeUrl('server listening on http://127.0.0.1:4096')).toBe('http://127.0.0.1:4096');
    expect(parseOpenCodeServeUrl('server listening on 127.0.0.1:4096')).toBe('http://127.0.0.1:4096');
    expect(parseOpenCodeServeUrl('server listening on [::1]:4096')).toBe('http://[::1]:4096');
    expect(parseOpenCodeServeUrl('waiting for server')).toBeNull();
  });

  it('normalizes OpenCode model responses like the package daemon', () => {
    const normalizeOpenCodeModels = loadEmbeddedFunction<
      (value: unknown) => Array<{ id: string; label: string }>
    >('normalizeOpenCodeModels', ['isRecord', 'stringValue']);

    const models = [
      { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', providerID: 'anthropic' },
      { id: 'gpt-5', name: 'GPT-5', providerId: 'openai' },
      { id: 'qwen3-coder', provider: 'qwen' },
      { id: 'disabled-model', providerID: 'ignored', enabled: false },
      { id: 'missing-provider' },
    ];
    const expected = [
      { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (anthropic)' },
      { id: 'openai/gpt-5', label: 'GPT-5 (openai)' },
      { id: 'qwen/qwen3-coder', label: 'qwen3-coder (qwen)' },
    ];

    expect(normalizeOpenCodeModels(models)).toEqual(expected);
    expect(normalizeOpenCodeModels({ data: models })).toEqual(expected);
  });
});
