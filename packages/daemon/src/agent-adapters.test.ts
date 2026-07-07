import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCodexCommand,
  createCodexAdapter,
  extractCodexEventText,
  extractCodexPlanUpdate,
  extractCodexToolUpdate,
} from './agent-adapters/codex-adapter.js';
import { buildGeminiCommand, createGeminiAdapter, parseGeminiStreamJsonLine } from './agent-adapters/gemini-adapter.js';
import { buildOpenCodeServeCommand, createOpenCodeAdapter } from './agent-adapters/opencode-adapter.js';
import { createFallbackAgentAdapterRegistry } from './agent-adapters/default-registry.js';
import { createAgentAdapterRegistry } from './agent-adapters/registry.js';
import type { CliAgentAdapter } from './agent-adapters/types.js';

describe('agent adapters', () => {
  it('reports adapter health through the registry', async () => {
    const registry = createAgentAdapterRegistry([
      fakeAdapter({ backend: 'opencode', state: 'ready', version: '1.2.3' }),
      fakeAdapter({ backend: 'gemini', state: 'missing', detail: 'command not found' }),
    ]);

    await expect(registry.probeAll()).resolves.toEqual([
      { backend: 'opencode', state: 'ready', version: '1.2.3' },
      { backend: 'gemini', state: 'missing', detail: 'command not found' },
    ]);
  });

  it('exposes OpenCode, Gemini, and Codex adapters in fallback registry shape', () => {
    expect(createFallbackAgentAdapterRegistry().listAgents()).toEqual([
      { backend: 'opencode', name: 'opencode', label: 'OpenCode' },
      { backend: 'gemini', name: 'gemini', label: 'Gemini CLI' },
      { backend: 'codex', name: 'codex', label: 'Codex CLI' },
    ]);
  });

  it('builds Gemini CLI prompt commands for stream-json output', () => {
    expect(buildGeminiCommand({ prompt: 'hello', model: 'gemini-2.5-pro', approvalMode: 'yolo' })).toEqual({
      command: 'gemini',
      args: ['-p', 'hello', '--output-format', 'stream-json', '--model', 'gemini-2.5-pro', '--approval-mode', 'yolo'],
    });
  });

  it('exposes default Gemini CLI model info for mobile model selection', async () => {
    const adapter = createGeminiAdapter({
      commandExists: async () => true,
    });

    await expect(adapter.getModelInfo?.()).resolves.toEqual({
      currentModelId: null,
      currentModelLabel: 'Default Gemini model',
      availableModels: [
        { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
        { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      ],
      canSwitch: true,
      source: 'models',
    });
  });

  it('extracts text deltas from common Gemini stream-json shapes', () => {
    expect(parseGeminiStreamJsonLine(JSON.stringify({ type: 'content', value: 'hello' }))).toEqual({
      type: 'content',
      content: 'hello',
    });
    expect(parseGeminiStreamJsonLine(JSON.stringify({ delta: ' world' }))).toEqual({
      type: 'content',
      content: ' world',
    });
    expect(parseGeminiStreamJsonLine('not json')).toBeNull();
  });

  it('executes Gemini CLI and streams parsed content from stdout', async () => {
    const calls: unknown[] = [];
    const adapter = createGeminiAdapter({
      commandExists: async () => true,
      runCommand: async (spec, options) => {
        calls.push({ spec, cwd: options?.cwd });
        options?.onStdout?.(Buffer.from(JSON.stringify({ value: 'hello ' }) + '\n'));
        options?.onStdout?.(Buffer.from(JSON.stringify({ delta: 'world' }) + '\n'));
        return { stdout: '', stderr: '' };
      },
    });

    const events = [];
    for await (const event of adapter.sendMessage({
      conversationId: 'conv-1',
      input: 'hello',
      workspace: '/tmp/project',
      model: 'gemini-2.5-pro',
      sessionMode: 'yolo',
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: 'thought',
        subject: 'Gemini CLI',
        description: 'gemini -p hello --output-format stream-json --model gemini-2.5-pro --approval-mode yolo',
      },
      { type: 'content', content: 'hello ' },
      { type: 'content', content: 'world' },
    ]);
    expect(calls).toEqual([
      {
        spec: {
          command: 'gemini',
          args: ['-p', 'hello', '--output-format', 'stream-json', '--model', 'gemini-2.5-pro', '--approval-mode', 'yolo'],
        },
        cwd: '/tmp/project',
      },
    ]);
  });

  it('passes selected file context to Gemini prompts', async () => {
    const calls: unknown[] = [];
    const adapter = createGeminiAdapter({
      commandExists: async () => true,
      runCommand: async (spec, options) => {
        calls.push({ spec, cwd: options?.cwd });
        return { stdout: JSON.stringify({ value: 'done' }) + '\n', stderr: '' };
      },
    });

    const events = [];
    for await (const event of adapter.sendMessage({
      conversationId: 'conv-1',
      input: 'review',
      workspace: '/tmp/project',
      files: ['/tmp/project/README.md', '/tmp/project/src/app.ts'],
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toEqual({ type: 'content', content: 'done' });
    expect(calls).toEqual([
      {
        spec: {
          command: 'gemini',
          args: [
            '-p',
            'review\n\nSelected files:\n- README.md\n- src/app.ts',
            '--output-format',
            'stream-json',
          ],
        },
        cwd: '/tmp/project',
      },
    ]);
  });

  it('passes abort signals to Gemini CLI command runs', async () => {
    const controller = new AbortController();
    const signals: Array<AbortSignal | undefined> = [];
    const adapter = createGeminiAdapter({
      commandExists: async () => true,
      runCommand: async (_spec, options) => {
        signals.push(options?.signal);
        return { stdout: JSON.stringify({ value: 'done' }) + '\n', stderr: '' };
      },
    });

    for await (const _event of adapter.sendMessage({
      conversationId: 'conv-1',
      input: 'hello',
      signal: controller.signal,
    })) {
      // Drain the stream.
    }

    expect(signals).toEqual([controller.signal]);
  });

  it('builds Codex CLI exec commands for json output', () => {
    expect(buildCodexCommand({ prompt: 'hello', model: 'gpt-5', approvalMode: 'autoEdit' })).toEqual({
      command: 'codex',
      args: [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--model',
        'gpt-5',
        '--sandbox',
        'workspace-write',
        'hello',
      ],
    });
    expect(buildCodexCommand({ prompt: 'ship it', approvalMode: 'yolo' })).toEqual({
      command: 'codex',
      args: ['exec', '--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', 'ship it'],
    });
  });

  it('exposes default Codex CLI model info for mobile model selection', async () => {
    const adapter = createCodexAdapter({
      commandExists: async () => true,
    });

    await expect(adapter.getModelInfo?.()).resolves.toEqual({
      currentModelId: null,
      currentModelLabel: 'Default Codex model',
      availableModels: [
        { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
        { id: 'gpt-5', label: 'GPT-5' },
        { id: 'gpt-5-mini', label: 'GPT-5 Mini' },
      ],
      canSwitch: true,
      source: 'models',
    });
  });

  it('extracts Codex json content, tool updates, and plans', () => {
    expect(
      extractCodexEventText({
        type: 'item.completed',
        item: { type: 'agent_message', text: 'done' },
      }),
    ).toBe('done');

    expect(
      extractCodexToolUpdate({
        type: 'item.completed',
        item: {
          id: 'cmd-1',
          type: 'command_execution',
          command: 'npm test',
          aggregated_output: 'ok',
          exit_code: 0,
        },
      }),
    ).toEqual({
      toolCallId: 'cmd-1',
      kind: 'command_execution',
      title: 'npm test',
      description: 'npm test\n\nok',
      status: 'success',
    });

    expect(
      extractCodexPlanUpdate({
        type: 'item.updated',
        item: {
          id: 'todo-1',
          type: 'todo_list',
          items: [
            { text: 'Inspect repo', completed: true },
            { text: 'Implement adapter', completed: false },
          ],
        },
      }),
    ).toEqual({
      sessionId: 'todo-1',
      entries: [
        { title: 'Inspect repo', status: 'completed' },
        { title: 'Implement adapter', status: 'pending' },
      ],
    });
  });

  it('executes Codex CLI and streams content, tools, and plan events', async () => {
    const calls: unknown[] = [];
    const adapter = createCodexAdapter({
      commandExists: async () => true,
      runCommand: async (spec, options) => {
        calls.push({ spec, cwd: options?.cwd });
        options?.onStdout?.(
          Buffer.from(
            [
              JSON.stringify({
                type: 'item.started',
                item: { id: 'cmd-1', type: 'command_execution', command: 'npm test', status: 'in_progress' },
              }),
              JSON.stringify({
                type: 'item.updated',
                item: { id: 'todo-1', type: 'todo_list', items: [{ text: 'Run tests', completed: false }] },
              }),
              JSON.stringify({
                type: 'item.completed',
                item: { id: 'msg-1', type: 'agent_message', text: 'All done' },
              }),
            ].join('\n') + '\n',
          ),
        );
        return { stdout: '', stderr: '' };
      },
    });

    const events = [];
    for await (const event of adapter.sendMessage({
      conversationId: 'conv-1',
      input: 'test',
      workspace: '/tmp/project',
      model: 'gpt-5',
      sessionMode: 'autoEdit',
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: 'thought',
        subject: 'Codex CLI',
        description:
          'codex exec --json --skip-git-repo-check --model gpt-5 --sandbox workspace-write test',
      },
      {
        type: 'codex_tool_call',
        data: {
          toolCallId: 'cmd-1',
          kind: 'command_execution',
          title: 'npm test',
          description: 'npm test',
          status: 'executing',
        },
      },
      {
        type: 'plan',
        data: {
          sessionId: 'todo-1',
          entries: [{ title: 'Run tests', status: 'pending' }],
        },
      },
      { type: 'content', content: 'All done' },
    ]);
    expect(calls).toEqual([
      {
        spec: {
          command: 'codex',
          args: [
            'exec',
            '--json',
            '--skip-git-repo-check',
            '--model',
            'gpt-5',
            '--sandbox',
            'workspace-write',
            'test',
          ],
        },
        cwd: '/tmp/project',
      },
    ]);
  });

  it('passes selected file context to Codex prompts', async () => {
    const calls: unknown[] = [];
    const adapter = createCodexAdapter({
      commandExists: async () => true,
      runCommand: async (spec, options) => {
        calls.push({ spec, cwd: options?.cwd });
        return { stdout: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'done' } }), stderr: '' };
      },
    });

    const events = [];
    for await (const event of adapter.sendMessage({
      conversationId: 'conv-1',
      input: 'review',
      workspace: '/tmp/project',
      files: ['/tmp/project/README.md'],
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toEqual({ type: 'content', content: 'done' });
    expect(calls).toEqual([
      {
        spec: {
          command: 'codex',
          args: [
            'exec',
            '--json',
            '--skip-git-repo-check',
            '--sandbox',
            'read-only',
            'review\n\nSelected files:\n- README.md',
          ],
        },
        cwd: '/tmp/project',
      },
    ]);
  });

  it('passes abort signals to Codex CLI command runs', async () => {
    const controller = new AbortController();
    const signals: Array<AbortSignal | undefined> = [];
    const adapter = createCodexAdapter({
      commandExists: async () => true,
      runCommand: async (_spec, options) => {
        signals.push(options?.signal);
        return { stdout: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'done' } }), stderr: '' };
      },
    });

    for await (const _event of adapter.sendMessage({
      conversationId: 'conv-1',
      input: 'hello',
      signal: controller.signal,
    })) {
      // Drain the stream.
    }

    expect(signals).toEqual([controller.signal]);
  });

  it('builds the OpenCode local API server command shape', () => {
    expect(buildOpenCodeServeCommand({ port: 4096 })).toEqual({
      command: 'opencode',
      args: ['serve', '--hostname', '127.0.0.1', '--port', '4096'],
    });
  });

  it('streams OpenCode client responses when a local API client is available', async () => {
    const adapter = createOpenCodeAdapter(
      {
        commandExists: async () => true,
      },
      {
        client: {
          sendPrompt: async () => ({ sessionId: 'ses_123', text: 'from opencode' }),
          sendCommand: async () => ({ sessionId: 'ses_123', text: 'unused command' }),
          listCommands: async () => [],
        },
      },
    );

    const events = [];
    for await (const event of adapter.sendMessage({ conversationId: 'conv-1', input: 'hello' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'thought', subject: 'OpenCode', description: 'session ses_123' },
      { type: 'content', content: 'from opencode' },
    ]);
  });

  it('passes selected model and mode to OpenCode prompt sessions', async () => {
    const calls: unknown[] = [];
    const adapter = createOpenCodeAdapter(
      {
        commandExists: async () => true,
      },
      {
        client: {
          sendPrompt: async (input) => {
            calls.push(input);
            return { sessionId: 'ses_model', text: 'from selected model' };
          },
          sendCommand: async () => ({ sessionId: 'unused', text: 'unused command' }),
          listCommands: async () => [],
        },
      },
    );

    const events = [];
    for await (const event of adapter.sendMessage({
      conversationId: 'conv-1',
      input: 'hello',
      workspace: '/tmp/project',
      model: 'anthropic/claude-sonnet-4',
      sessionMode: 'plan',
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'thought', subject: 'OpenCode', description: 'session ses_model' },
      { type: 'content', content: 'from selected model' },
    ]);
    expect(calls).toEqual([
      {
        prompt: 'hello',
        directory: '/tmp/project',
        sessionId: undefined,
        model: 'anthropic/claude-sonnet-4',
        agent: 'plan',
      },
    ]);
  });

  it('passes abort signals to OpenCode prompt sessions', async () => {
    const controller = new AbortController();
    const calls: unknown[] = [];
    const adapter = createOpenCodeAdapter(
      {
        commandExists: async () => true,
      },
      {
        client: {
          sendPrompt: async (input) => {
            calls.push(input);
            return { sessionId: 'ses_signal', text: 'from signal prompt' };
          },
          sendCommand: async () => ({ sessionId: 'unused', text: 'unused command' }),
          listCommands: async () => [],
        },
      },
    );

    for await (const _event of adapter.sendMessage({
      conversationId: 'conv-1',
      input: 'hello',
      signal: controller.signal,
    })) {
      // Drain the stream.
    }

    expect(calls).toEqual([
      expect.objectContaining({
        prompt: 'hello',
        signal: controller.signal,
      }),
    ]);
  });

  it('passes selected files to OpenCode prompt sessions as attachments', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'aicliui-opencode-prompt-'));
    try {
      const filePath = join(tempDir, 'README.md');
      const missingPath = join(tempDir, 'missing.md');
      await writeFile(filePath, '# hello', 'utf8');
      const calls: unknown[] = [];
      const adapter = createOpenCodeAdapter(
        {
          commandExists: async () => true,
        },
        {
          client: {
            sendPrompt: async (input) => {
              calls.push(input);
              return { sessionId: 'ses_files', text: 'from selected files' };
            },
            sendCommand: async () => ({ sessionId: 'unused', text: 'unused command' }),
            listCommands: async () => [],
          },
        },
      );

      const events = [];
      for await (const event of adapter.sendMessage({
        conversationId: 'conv-1',
        input: 'review selected file',
        workspace: tempDir,
        files: [filePath, missingPath],
      })) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: 'thought', subject: 'OpenCode', description: 'session ses_files' },
        { type: 'content', content: 'from selected files' },
      ]);
      expect(calls).toEqual([
        expect.objectContaining({
          prompt: 'review selected file',
          directory: tempDir,
          files: [
            {
              uri: expect.stringMatching(/README\.md$/),
              mime: 'text/markdown',
              name: 'README.md',
              description: 'README.md',
            },
          ],
        }),
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('exposes OpenCode model info from the local API client', async () => {
    const adapter = createOpenCodeAdapter(
      {
        commandExists: async () => true,
      },
      {
        client: {
          sendPrompt: async () => ({ sessionId: 'unused', text: 'unused' }),
          sendCommand: async () => ({ sessionId: 'unused', text: 'unused command' }),
          listCommands: async () => [],
          listModels: async () => [{ id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (anthropic)' }],
        },
      },
    );

    await expect(adapter.getModelInfo?.()).resolves.toEqual({
      currentModelId: null,
      currentModelLabel: 'Default OpenCode model',
      availableModels: [{ id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (anthropic)' }],
      canSwitch: true,
      source: 'models',
    });
  });

  it('forwards OpenCode streaming tool and permission events from the local API client', async () => {
    const confirmCalls: unknown[] = [];
    const adapter = createOpenCodeAdapter(
      {
        commandExists: async () => true,
      },
      {
        client: {
          sendPrompt: async () => ({ sessionId: 'unused', text: 'unused fallback' }),
          sendCommand: async () => ({ sessionId: 'unused', text: 'unused command' }),
          listCommands: async () => [],
          streamPrompt: async function* () {
            yield { type: 'session', sessionId: 'ses_stream' };
            yield {
              type: 'tool',
              tool: {
                callId: 'tool_1',
                call_id: 'tool_1',
                name: 'read',
                description: 'Read README.md',
                status: 'Success',
                resultDisplay: 'done',
                result_display: 'done',
              },
            };
            yield {
              type: 'permission',
              request: {
                id: 'perm_1',
                sessionID: 'ses_stream',
                action: 'execute',
                resources: ['npm test'],
                source: { callID: 'tool_2' },
              },
            };
            yield { type: 'content', content: 'streamed response' };
          },
          confirmPermission: async (input) => {
            confirmCalls.push(input);
            return { success: true };
          },
        },
      },
    );

    const events = [];
    for await (const event of adapter.sendMessage({ conversationId: 'conv-1', input: 'hello' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'thought', subject: 'OpenCode', description: 'session ses_stream' },
      {
        type: 'tool_group',
        tools: [
          {
            callId: 'tool_1',
            call_id: 'tool_1',
            name: 'read',
            description: 'Read README.md',
            status: 'Success',
            resultDisplay: 'done',
            result_display: 'done',
          },
        ],
      },
      {
        type: 'permission',
        confirmation: {
          id: 'perm_1',
          title: 'OpenCode permission',
          action: 'execute',
          description: 'Action: execute\nResources:\n- npm test',
          call_id: 'tool_2',
          callId: 'tool_2',
          options: [
            { label: 'Allow once', value: 'once' },
            { label: 'Allow always', value: 'always' },
            { label: 'Reject', value: 'reject' },
          ],
        },
      },
      { type: 'content', content: 'streamed response' },
    ]);

    await expect(
      adapter.confirm?.({
        conversationId: 'conv-1',
        confirmationId: 'perm_1',
        callId: 'tool_2',
        data: 'approve',
      }),
    ).resolves.toEqual({ success: true });
    expect(confirmCalls).toEqual([{ sessionId: 'ses_stream', requestId: 'perm_1', reply: 'once' }]);
  });

  it('forwards OpenCode question events through the mobile confirmation channel', async () => {
    const questionReplies: unknown[] = [];
    const questionRejects: unknown[] = [];
    const adapter = createOpenCodeAdapter(
      {
        commandExists: async () => true,
      },
      {
        client: {
          sendPrompt: async () => ({ sessionId: 'unused', text: 'unused fallback' }),
          sendCommand: async () => ({ sessionId: 'unused', text: 'unused command' }),
          listCommands: async () => [],
          streamPrompt: async function* () {
            yield { type: 'session', sessionId: 'ses_question' };
            yield {
              type: 'question',
              request: {
                id: 'que_1',
                sessionID: 'ses_question',
                questions: [
                  {
                    header: 'Style',
                    question: 'Which output style?',
                    options: [
                      { label: 'Brief', description: 'Short answer' },
                      { label: 'Detailed', description: 'Long answer' },
                    ],
                  },
                ],
                tool: { callID: 'tool_question', messageID: 'msg_question' },
              },
            };
            yield { type: 'content', content: 'after question' };
          },
          replyQuestion: async (input) => {
            questionReplies.push(input);
            return { success: true };
          },
          rejectQuestion: async (input) => {
            questionRejects.push(input);
            return { success: true };
          },
        },
      },
    );

    const events = [];
    for await (const event of adapter.sendMessage({ conversationId: 'conv-1', input: 'hello' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'thought', subject: 'OpenCode', description: 'session ses_question' },
      {
        type: 'permission',
        confirmation: {
          id: 'que_1',
          title: 'OpenCode question',
          action: 'question',
          description: 'Style\nWhich output style?',
          call_id: 'tool_question',
          callId: 'tool_question',
          command_type: 'question',
          options: [
            { label: 'Brief', value: 'Brief' },
            { label: 'Detailed', value: 'Detailed' },
            { label: 'Reject', value: 'reject' },
          ],
        },
      },
      { type: 'content', content: 'after question' },
    ]);

    await expect(
      adapter.confirm?.({
        conversationId: 'conv-1',
        confirmationId: 'que_1',
        callId: 'tool_question',
        data: 'Detailed',
      }),
    ).resolves.toEqual({ success: true });
    expect(questionReplies).toEqual([{ sessionId: 'ses_question', requestId: 'que_1', answers: [['Detailed']] }]);

    const rejectAdapter = createOpenCodeAdapter(
      {
        commandExists: async () => true,
      },
      {
        client: {
          sendPrompt: async () => ({ sessionId: 'unused', text: 'unused fallback' }),
          sendCommand: async () => ({ sessionId: 'unused', text: 'unused command' }),
          listCommands: async () => [],
          streamPrompt: async function* () {
            yield { type: 'question', request: { id: 'que_2', sessionID: 'ses_question', questions: [] } };
          },
          rejectQuestion: async (input) => {
            questionRejects.push(input);
            return { success: true };
          },
        },
      },
    );
    for await (const _event of rejectAdapter.sendMessage({ conversationId: 'conv-1', input: 'hello' })) {
      // Exhaust the stream so the question is registered.
    }
    await expect(
      rejectAdapter.confirm?.({
        conversationId: 'conv-1',
        confirmationId: 'que_2',
        callId: 'que_2',
        data: 'reject',
      }),
    ).resolves.toEqual({ success: true });
    expect(questionRejects).toContainEqual({ sessionId: 'ses_question', requestId: 'que_2' });
  });

  it('forwards OpenCode reasoning events as mobile thinking messages', async () => {
    const adapter = createOpenCodeAdapter(
      {
        commandExists: async () => true,
      },
      {
        client: {
          sendPrompt: async () => ({ sessionId: 'unused', text: 'unused fallback' }),
          sendCommand: async () => ({ sessionId: 'unused', text: 'unused command' }),
          listCommands: async () => [],
          streamPrompt: async function* () {
            yield { type: 'session', sessionId: 'ses_reasoning' };
            yield { type: 'thinking', content: 'Inspecting ', status: 'thinking' };
            yield { type: 'thinking', content: 'workspace.', status: 'thinking' };
            yield { type: 'thinking', content: '', status: 'done' };
            yield { type: 'content', content: 'ready' };
          },
        },
      },
    );

    const events = [];
    for await (const event of adapter.sendMessage({ conversationId: 'conv-1', input: 'hello' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'thought', subject: 'OpenCode', description: 'session ses_reasoning' },
      { type: 'thinking', subject: 'OpenCode reasoning', content: 'Inspecting ', status: 'thinking' },
      { type: 'thinking', subject: 'OpenCode reasoning', content: 'workspace.', status: 'thinking' },
      { type: 'thinking', subject: 'OpenCode reasoning', content: '', status: 'done' },
      { type: 'content', content: 'ready' },
    ]);
  });

  it('forwards OpenCode context usage events to the shared adapter contract', async () => {
    const adapter = createOpenCodeAdapter(
      {
        commandExists: async () => true,
      },
      {
        client: {
          sendPrompt: async () => ({ sessionId: 'unused', text: 'unused fallback' }),
          sendCommand: async () => ({ sessionId: 'unused', text: 'unused command' }),
          listCommands: async () => [],
          streamPrompt: async function* () {
            yield { type: 'session', sessionId: 'ses_usage' };
            yield { type: 'context_usage', used: 135, size: 200 };
            yield { type: 'content', content: 'ready' };
          },
        },
      },
    );

    const events = [];
    for await (const event of adapter.sendMessage({ conversationId: 'conv-1', input: 'hello' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'thought', subject: 'OpenCode', description: 'session ses_usage' },
      { type: 'context_usage', used: 135, size: 200 },
      { type: 'content', content: 'ready' },
    ]);
  });

  it('forwards OpenCode agent status events to the shared adapter contract', async () => {
    const adapter = createOpenCodeAdapter(
      {
        commandExists: async () => true,
      },
      {
        client: {
          sendPrompt: async () => ({ sessionId: 'unused', text: 'unused fallback' }),
          sendCommand: async () => ({ sessionId: 'unused', text: 'unused command' }),
          listCommands: async () => [],
          streamPrompt: async function* () {
            yield { type: 'session', sessionId: 'ses_status' };
            yield {
              type: 'agent_status',
              data: {
                backend: 'opencode',
                agentName: 'OpenCode',
                status: 'error',
                message: 'provider rejected the request',
              },
            };
            yield { type: 'content', content: 'ready' };
          },
        },
      },
    );

    const events = [];
    for await (const event of adapter.sendMessage({ conversationId: 'conv-1', input: 'hello' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'thought', subject: 'OpenCode', description: 'session ses_status' },
      {
        type: 'agent_status',
        data: {
          backend: 'opencode',
          agentName: 'OpenCode',
          status: 'error',
          message: 'provider rejected the request',
        },
      },
      { type: 'content', content: 'ready' },
    ]);
  });

  it('sends OpenCode slash input through the command endpoint and reuses the conversation session', async () => {
    const calls: unknown[] = [];
    const adapter = createOpenCodeAdapter(
      {
        commandExists: async () => true,
      },
      {
        client: {
          sendPrompt: async (input) => {
            calls.push({ type: 'prompt', input });
            return { sessionId: 'ses_reuse', text: 'first response' };
          },
          sendCommand: async (input) => {
            calls.push({ type: 'command', input });
            return { sessionId: 'ses_reuse', text: 'command response' };
          },
          listCommands: async (input) => {
            calls.push({ type: 'listCommands', input });
            return [{ command: 'review', description: 'Review code' }];
          },
        },
      },
    );

    const firstEvents = [];
    for await (const event of adapter.sendMessage({ conversationId: 'conv-1', input: 'hello', workspace: '/tmp/project' })) {
      firstEvents.push(event);
    }
    const commandEvents = [];
    for await (const event of adapter.sendMessage({ conversationId: 'conv-1', input: '/review now', workspace: '/tmp/project' })) {
      commandEvents.push(event);
    }

    expect(firstEvents).toEqual([
      { type: 'thought', subject: 'OpenCode', description: 'session ses_reuse' },
      { type: 'content', content: 'first response' },
    ]);
    expect(commandEvents).toEqual([
      { type: 'thought', subject: 'OpenCode', description: 'session ses_reuse' },
      { type: 'content', content: 'command response' },
    ]);
    expect(calls).toEqual([
      {
        type: 'prompt',
        input: {
          prompt: 'hello',
          directory: '/tmp/project',
          sessionId: undefined,
        },
      },
      {
        type: 'listCommands',
        input: {
          directory: '/tmp/project',
        },
      },
      {
        type: 'command',
        input: {
          command: 'review',
          arguments: 'now',
          directory: '/tmp/project',
          sessionId: 'ses_reuse',
          model: undefined,
          agent: undefined,
        },
      },
    ]);
  });

  it('falls back to an OpenCode prompt when slash input is not a known command', async () => {
    const calls: unknown[] = [];
    const adapter = createOpenCodeAdapter(
      {
        commandExists: async () => true,
      },
      {
        client: {
          sendPrompt: async (input) => {
            calls.push({ type: 'prompt', input });
            return { sessionId: 'ses_reuse', text: 'prompt response' };
          },
          sendCommand: async (input) => {
            calls.push({ type: 'command', input });
            return { sessionId: 'ses_reuse', text: 'command response' };
          },
          listCommands: async (input) => {
            calls.push({ type: 'listCommands', input });
            return [{ command: 'review', description: 'Review code' }];
          },
        },
      },
    );

    const events = [];
    for await (const event of adapter.sendMessage({
      conversationId: 'conv-1',
      input: '/unknown do not execute',
      workspace: '/tmp/project',
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'thought', subject: 'OpenCode', description: 'session ses_reuse' },
      { type: 'content', content: 'prompt response' },
    ]);
    expect(calls).toEqual([
      {
        type: 'listCommands',
        input: {
          directory: '/tmp/project',
        },
      },
      {
        type: 'prompt',
        input: {
          prompt: '/unknown do not execute',
          directory: '/tmp/project',
          sessionId: undefined,
        },
      },
    ]);
  });

  it('passes selected files to OpenCode slash commands as command parts', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'aicliui-opencode-'));
    try {
      const filePath = join(tempDir, 'README.md');
      await writeFile(filePath, '# hello', 'utf8');
      const calls: unknown[] = [];
      const adapter = createOpenCodeAdapter(
        {
          commandExists: async () => true,
        },
        {
          client: {
            sendPrompt: async (input) => {
              calls.push({ type: 'prompt', input });
              return { sessionId: 'ses_reuse', text: 'prompt response' };
            },
            sendCommand: async (input) => {
              calls.push({ type: 'command', input });
              return { sessionId: 'ses_reuse', text: 'command response' };
            },
            listCommands: async () => [{ command: 'review', description: 'Review code' }],
          },
        },
      );

      const events = [];
      for await (const event of adapter.sendMessage({
        conversationId: 'conv-1',
        input: '/review selected files',
        workspace: tempDir,
        files: [filePath],
      })) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: 'thought', subject: 'OpenCode', description: 'session ses_reuse' },
        { type: 'content', content: 'command response' },
      ]);
      expect(calls).toEqual([
        {
          type: 'command',
          input: expect.objectContaining({
            command: 'review',
            parts: [
              {
                type: 'file',
                mime: 'text/markdown',
                filename: 'README.md',
                url: expect.stringMatching(/README\.md$/),
              },
            ],
          }),
        },
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('uses an OpenCode server manager when a direct client was not injected', async () => {
    const adapter = createOpenCodeAdapter(
      {
        commandExists: async () => true,
      },
      {
        serverManager: {
          ensureClient: async () => ({
            sendPrompt: async () => ({ sessionId: 'ses_456', text: 'from managed opencode' }),
            sendCommand: async () => ({ sessionId: 'ses_456', text: 'unused command' }),
            listCommands: async () => [],
          }),
        },
      },
    );

    const events = [];
    for await (const event of adapter.sendMessage({ conversationId: 'conv-1', input: 'hello' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'thought', subject: 'OpenCode', description: 'session ses_456' },
      { type: 'content', content: 'from managed opencode' },
    ]);
  });
});

function fakeAdapter(health: Awaited<ReturnType<CliAgentAdapter['probe']>>): CliAgentAdapter {
  return {
    backend: health.backend,
    name: health.backend,
    label: health.backend,
    probe: async () => health,
    sendMessage: async function* () {
      yield { type: 'content', content: 'ok' };
    },
  };
}
