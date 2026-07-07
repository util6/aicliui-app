import {
  hasRunCommandPermissionAsync,
  isTermuxInstalledAsync,
  openTermuxAppAsync,
  runCommandAsync,
} from '@aicliui/termux';
import { spawnSync } from 'node:child_process';
import { TERMUX_DAEMON_SOURCE } from '@/src/services/termuxDaemonSource';
import * as localRuntime from '@/src/services/localRuntime';
import {
  buildTermuxBootstrapScript,
  installOrStartLocalRuntime,
  openTermuxIfAvailable,
  probeTermuxRuntime,
} from '@/src/services/termuxRuntime';

jest.mock('@aicliui/termux', () => ({
  hasRunCommandPermissionAsync: jest.fn(),
  isTermuxInstalledAsync: jest.fn(),
  openTermuxAppAsync: jest.fn(),
  runCommandAsync: jest.fn(),
}));

const mockIsTermuxInstalled = isTermuxInstalledAsync as jest.Mock;
const mockHasRunCommandPermission = hasRunCommandPermissionAsync as jest.Mock;
const mockOpenTermux = openTermuxAppAsync as jest.Mock;
const mockRunCommand = runCommandAsync as jest.Mock;

describe('termuxRuntime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports installed Termux and granted RUN_COMMAND permission', async () => {
    mockIsTermuxInstalled.mockResolvedValueOnce(true);
    mockHasRunCommandPermission.mockResolvedValueOnce(true);

    await expect(probeTermuxRuntime()).resolves.toEqual({
      nativeModule: 'available',
      termuxInstalled: 'yes',
      runCommandPermission: 'yes',
    });
  });

  it('does not request permission state when Termux is missing', async () => {
    mockIsTermuxInstalled.mockResolvedValueOnce(false);

    await expect(probeTermuxRuntime()).resolves.toEqual({
      nativeModule: 'available',
      termuxInstalled: 'no',
      runCommandPermission: 'no',
    });
    expect(mockHasRunCommandPermission).not.toHaveBeenCalled();
  });

  it('falls back to unknown when native module calls fail', async () => {
    mockIsTermuxInstalled.mockRejectedValueOnce(new Error('native module unavailable'));

    await expect(probeTermuxRuntime()).resolves.toEqual({
      nativeModule: 'unavailable',
      termuxInstalled: 'unknown',
      runCommandPermission: 'unknown',
    });
  });

  it('opens Termux when the native call succeeds', async () => {
    mockOpenTermux.mockResolvedValueOnce(true);
    await expect(openTermuxIfAvailable()).resolves.toBe(true);
  });

  it('builds a bootstrap script that prepares daemon directories and start command', () => {
    const script = buildTermuxBootstrapScript({
      host: '127.0.0.1',
      port: '43117',
      token: "tok'en",
    });

    expect(script).toContain('mkdir -p "$AICLIUI_HOME/bin" "$AICLIUI_HOME/daemon"');
    expect(script).toContain('export AICLIUI_BOOTSTRAP_LOG="$AICLIUI_HOME/logs/bootstrap.log"');
    expect(script).toContain('export AICLIUI_BOOTSTRAP_STATUS="$AICLIUI_HOME/daemon/bootstrap.status"');
    expect(script).toContain('write_bootstrap_status preparing "Preparing AICLIUI Termux runtime"');
    expect(script).toContain('write_bootstrap_status installing_daemon_deps "Installing daemon npm dependencies"');
    expect(script).toContain('write_bootstrap_status daemon_start_requested "Starting local daemon"');
    expect(script).toContain("printf %s 'tok'\\''en' > \"$AICLIUI_HOME/daemon/token\"");
    expect(script).toContain('pkg install -y nodejs');
    expect(script).toContain('npm install --omit=dev --prefix "$AICLIUI_HOME/daemon"');
    expect(script).toContain('npm install -g opencode-ai@latest');
    expect(script).toContain('npm install -g @google/gemini-cli@latest');
    expect(script).toContain('npm install -g @openai/codex@latest');
    expect(script).toContain("import { WebSocketServer } from 'ws';");
    expect(script).toContain("import { spawn } from 'node:child_process';");
    expect(script).toContain("import { pathToFileURL } from 'node:url';");
    expect(script).toContain("import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';");
    expect(script).toContain("const storePath = process.env.AICLIUI_STORE_PATH || dataRoot + '/daemon/store.json';");
    expect(script).toContain("const bootstrapStatusPath = process.env.AICLIUI_BOOTSTRAP_STATUS || dataRoot + '/daemon/bootstrap.status';");
    expect(script).toContain('const storeReady = loadStore();');
    expect(script).toContain('const activeRuns = new Map();');
    expect(script).toContain('const pendingConfirmations = new Map();');
    expect(script).toContain('const geminiModels = parseModelOptions(');
    expect(script).toContain('process.env.AICLIUI_GEMINI_MODELS');
    expect(script).toContain("{ id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' }");
    expect(script).toContain("{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }");
    expect(script).toContain('const codexModels = parseModelOptions(');
    expect(script).toContain('process.env.AICLIUI_CODEX_MODELS');
    expect(script).toContain("{ id: 'gpt-5-codex', label: 'GPT-5 Codex' }");
    expect(script).toContain('bootstrap: await readBootstrapStatus()');
    expect(script).toContain('await storeReady;');
    expect(script).toContain('await rename(tmpPath, storePath);');
    expect(script).toContain("if (key === 'acp.probe-model-info') return { success: true, data: { modelInfo: await getModelInfo(params.backend) } };");
    expect(script).toContain("if (backend === 'opencode') return await getOpenCodeModelInfo();");
    expect(script).toContain("if (backend === 'codex') return getCodexModelInfo();");
    expect(script).toContain("if (backend !== 'gemini') return null;");
    expect(script).toContain("currentModelLabel: 'Default Gemini model'");
    expect(script).toContain('availableModels: geminiModels');
    expect(script).toContain("currentModelLabel: 'Default OpenCode model'");
    expect(script).toContain("const response = await requestOpenCodeJson(baseUrl, '/api/model', { method: 'GET' });");
    expect(script).toContain('function normalizeOpenCodeModels(models)');
    expect(script).toContain("id: model.providerID + '/' + model.id");
    expect(script).toContain('function normalizeConversationModel(model, extra)');
    expect(script).toContain('if (isRecord(model) && (model.id || model.useModel))');
    expect(script).toContain('useModel: modelLabel(currentModelId, extra.backend)');
    expect(script).toContain('function parseModelOptions(raw, fallback)');
    expect(script).toContain("if (key === 'conversation.get-workspace') return await getWorkspaceTree(params);");
    expect(script).toContain("if (key === 'get-file-by-dir') return await getFileTreeByDir(params);");
    expect(script).toContain("if (key === 'read-file') return await readTextFile(requiredString(params.path));");
    expect(script).toContain("if (key === 'get-image-base64') return await readImageBase64(requiredString(params.path));");
    expect(script).toContain("if (key === 'confirmation.list') return listConfirmations(requiredString(params.conversation_id));");
    expect(script).toContain("if (key === 'confirmation.confirm') return await confirmPendingPermission(params, emit);");
    expect(script).toContain("throw new Error('Path is outside the workspace: ' + path);");
    expect(script).toContain("return 'data:' + imageMimeType(filePath) + ';base64,' + buffer.toString('base64');");
    expect(script).toContain("opencode', ['serve', '--hostname', '127.0.0.1', '--port'");
    expect(script).toContain("await sendGeminiPrompt({");
    expect(script).toContain("await sendCodexPrompt({");
    expect(script).toContain("onContent: emitAssistantContent");
    expect(script).toContain("const prompt = appendSelectedFilesToPrompt(input, files, workspace);");
    expect(script).toContain("const args = buildGeminiArgs({ input: prompt, model, approvalMode }).slice(1);");
    expect(script).toContain("let lineBuffer = '';");
    expect(script).toContain("const handleStdout = (chunk) => {");
    expect(script).toContain("emitContent(text);");
    expect(script).toContain("onStdout: handleStdout");
    expect(script).toContain("'--output-format'");
    expect(script).toContain("'stream-json'");
    expect(script).toContain('parseGeminiStreamJsonLine');
    expect(script).toContain('parseCodexJsonLine');
    expect(script).toContain('extractCodexEventText');
    expect(script).toContain('extractCodexToolUpdate');
    expect(script).toContain("type === 'item.started' || type === 'item.completed'");
    expect(script).toContain("item.type === 'agent_message'");
    expect(script).toContain("item.type === 'command_execution'");
    expect(script).toContain("item.type === 'web_search'");
    expect(script).toContain("item.type === 'file_change'");
    expect(script).toContain('function codexWebSearchTool(type, item)');
    expect(script).toContain("subtype: type === 'item.started' ? 'web_search_begin' : 'web_search_end'");
    expect(script).toContain('data: { query }');
    expect(script).toContain('function codexFileChangeTool(type, item)');
    expect(script).toContain("kind: 'file_change'");
    expect(script).toContain('description: codexFileChangeDescription(item)');
    expect(script).toContain("type: 'codex_tool_call'");
    expect(script).toContain('data: tool');
    expect(script).toContain('upsertCodexToolCallMessage(conversationId, assistantMsgId, tool);');
    expect(script).toContain('function upsertCodexToolCallMessage(conversationId, msgId, tool)');
    expect(script).toContain("message.type !== 'codex_tool_call'");
    expect(script).toContain('message.content.toolCallId === tool.toolCallId');
    expect(script).toContain('buildCodexArgs({ input: prompt, model, approvalMode })');
    expect(script).toContain("'--json'");
    expect(script).toContain("'--skip-git-repo-check'");
    expect(script).toContain("if (approvalMode === 'yolo')");
    expect(script).toContain("'--dangerously-bypass-approvals-and-sandbox'");
    expect(script).toContain("approvalMode === 'autoEdit' ? 'workspace-write' : 'read-only'");
    expect(script).toContain('server listening on');
    expect(script).toContain("'/api/session'");
    expect(script).toContain('const modelRef = parseOpenCodeModelRef(model);');
    expect(script).toContain('const agentId = parseOpenCodeAgent(agent);');
    expect(script).toContain('...(modelRef ? { model: modelRef } : {})');
    expect(script).toContain('...(agentId ? { agent: agentId } : {})');
    expect(script).toContain('function parseOpenCodeModelRef(model)');
    expect(script).toContain('function parseOpenCodeAgent(agent)');
    expect(script).toContain("return agent === 'build' || agent === 'plan' ? agent : null;");
    expect(script).toContain("'/api/session/' + encodeURIComponent(sessionId) + '/prompt'");
    expect(script).toContain('const selectedFiles = normalizeSelectedFiles(params.files, conversation.extra.defaultFiles, workspace);');
    expect(script).toContain("const rawPath = value.startsWith('/') || value.startsWith('~') ? value : join(root, value);");
    expect(script).toContain('const attachments = await buildOpenCodeFileAttachments(files, workspace);');
    expect(script).toContain('const emitAssistantTool = (tool) => {');
    expect(script).toContain('upsertToolGroupMessage(conversationId, assistantMsgId, tool);');
    expect(script).toContain("type: 'tool_group'");
    expect(script).toContain('data: [tool]');
    expect(script).toContain('function upsertToolGroupMessage(conversationId, msgId, tool)');
    expect(script).toContain('message.content.findIndex((item) => isRecord(item) && item.callId === tool.callId)');
    expect(script).toContain('onTool: emitAssistantTool');
    expect(script).toContain('const emitAssistantPermission = (confirmation) => {');
    expect(script).toContain("emit('confirmation.add', confirmation);");
    expect(script).toContain('const emitAssistantPermissionResolved = (confirmationId) => {');
    expect(script).toContain("emit('confirmation.remove', { conversation_id: conversationId, id: confirmationId });");
    expect(script).toContain('onPermission: emitAssistantPermission');
    expect(script).toContain('onPermissionResolved: emitAssistantPermissionResolved');
    expect(script).toContain('const eventStream = subscribeOpenCodeSessionEvents(baseUrl, workspace, sessionId, signal, {');
    expect(script).toContain('await eventStream.ready;');
    expect(script).toContain('eventStream.close();');
    expect(script).toContain("'/api/event?location%5Bdirectory%5D=' + encodeURIComponent(workspace)");
    expect(script).toContain('parseSseEventBlock');
    expect(script).toContain('extractOpenCodeEventTextDelta');
    expect(script).toContain('createOpenCodeTextDeltaExtractor');
    expect(script).toContain('createOpenCodeToolUpdateExtractor');
    expect(script).toContain('extractOpenCodeToolUpdate');
    expect(script).toContain('createOpenCodePermissionEventExtractor');
    expect(script).toContain('extractOpenCodePermissionAsked');
    expect(script).toContain('extractOpenCodePermissionResolved');
    expect(script).toContain("type !== 'permission.v2.asked' && type !== 'permission.asked'");
    expect(script).toContain("type !== 'permission.v2.replied' && type !== 'permission.replied'");
    expect(script).toContain('function toOpenCodeConfirmation(request, conversationId, msgId, baseUrl)');
    expect(script).toContain("value: 'once'");
    expect(script).toContain("value: 'always'");
    expect(script).toContain("value: 'reject'");
    expect(script).toContain('async function confirmPendingPermission(params, emit)');
    expect(script).toContain("'/api/session/' + encodeURIComponent(record.sessionId) + '/permission/' + encodeURIComponent(record.requestId) + '/reply'");
    expect(script).toContain("body: JSON.stringify({ reply })");
    expect(script).toContain('async function replyOpenCodePermission(record, reply)');
    expect(script).toContain("'/api/session/' + encodeURIComponent(record.sessionId) + '/permissions/' + encodeURIComponent(record.requestId)");
    expect(script).toContain("body: JSON.stringify({ response: reply })");
    expect(script).toContain('function listConfirmations(conversationId)');
    expect(script).toContain('function clearConfirmationsForConversation(conversationId, emit)');
    expect(script).toContain("part.type !== 'tool'");
    expect(script).toContain('openCodeToolStatus');
    expect(script).toContain("type !== 'message.part.updated'");
    expect(script).toContain("part.type !== 'text'");
    expect(script).toContain("type === 'session.next.text.delta'");
    expect(script).toContain('uri: pathToFileURL(filePath).toString()');
    expect(script).toContain('files: attachments');
    expect(script).toContain('appendSelectedFilesToPrompt(input, files, workspace)');
    expect(script).toContain("'\\n\\nSelected files:\\n'");
    expect(script).toContain("'/api/session/' + encodeURIComponent(sessionId) + '/wait'");
    expect(script).toContain("'/api/session/' + encodeURIComponent(sessionId) + '/context'");
    expect(script).toContain("if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(push));");
    expect(script).toContain("if (key === 'chat.send.message') return await sendMessage(params, emit);");
    expect(script).toContain("if (key === 'chat.stop.stream') return stopStream(params);");
    expect(script).toContain('const run = createActiveRun(conversationId);');
    expect(script).toContain('activeRuns.set(conversationId, run);');
    expect(script).toContain('activeRuns.delete(conversationId);');
    expect(script).toContain("return { success: true, stopped: true };");
    expect(script).toContain("runProcess('gemini', args, {");
    expect(script).toContain("runProcess('codex', args, {");
    expect(script).toContain('onTool: emitAssistantCodexTool');
    expect(script).toContain("signal.addEventListener('abort', abort);");
    expect(script).toContain('exec node ./aicliui-daemon.mjs');
    expect(script).toContain('export AICLIUI_DAEMON_PID_FILE="$AICLIUI_HOME/daemon/daemon.pid"');
    expect(script).toContain('if [ -s "$AICLIUI_DAEMON_PID_FILE" ]; then');
    expect(script).toContain('kill "$OLD_PID" >/dev/null 2>&1 || true');
    expect(script).toContain('printf %s "$$" > "$AICLIUI_DAEMON_PID_FILE"');
    expect(script).toContain('nohup "$AICLIUI_HOME/bin/start-daemon.sh"');
  });

  it('generates a syntactically valid ESM daemon script', () => {
    const script = buildTermuxBootstrapScript({
      host: '127.0.0.1',
      port: '43117',
      token: 'runtime-token',
    });
    const match = script.match(/AICLIUI_DAEMON_SOURCE'\n([\s\S]*?)\nAICLIUI_DAEMON_SOURCE/);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe(TERMUX_DAEMON_SOURCE);

    const result = spawnSync(process.execPath, ['--input-type=module', '--check', '-'], {
      input: match?.[1] ?? '',
      encoding: 'utf8',
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('starts the local runtime through Termux RUN_COMMAND when prerequisites are ready', async () => {
    jest.spyOn(localRuntime, 'getOrCreateLocalDaemonConfig').mockResolvedValueOnce({
      host: '127.0.0.1',
      port: '43117',
      token: 'runtime-token',
    });
    mockIsTermuxInstalled.mockResolvedValueOnce(true);
    mockHasRunCommandPermission.mockResolvedValueOnce(true);
    mockRunCommand.mockResolvedValueOnce(true);

    await expect(installOrStartLocalRuntime()).resolves.toEqual({
      status: 'started',
      config: { host: '127.0.0.1', port: '43117', token: 'runtime-token' },
    });
    expect(mockRunCommand).toHaveBeenCalledWith({
      commandPath: '$PREFIX/bin/bash',
      args: ['-s'],
      stdin: expect.stringContaining('AICLIUI_HOME'),
      workdir: '~',
      background: true,
      label: 'AICLIUI runtime bootstrap',
    });
  });

  it('does not start Termux command when permission is missing', async () => {
    mockIsTermuxInstalled.mockResolvedValueOnce(true);
    mockHasRunCommandPermission.mockResolvedValueOnce(false);

    await expect(installOrStartLocalRuntime()).resolves.toEqual({ status: 'permission_missing' });
    expect(mockRunCommand).not.toHaveBeenCalled();
  });
});
