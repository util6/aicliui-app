import { describe, expect, it } from 'vitest';
import {
  createOpenCodeClient,
  extractOpenCodeAssistantText,
  extractOpenCodeCommands,
  extractOpenCodeModels,
} from './opencode-client.js';

describe('OpenCode local API client', () => {
  it('creates a session, prompts it, waits, and returns assistant text from context', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createOpenCodeClient({
      baseUrl: 'http://127.0.0.1:4096',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith('/api/session')) {
          return jsonResponse({ data: { id: 'ses_123' } });
        }
        if (String(url).endsWith('/api/session/ses_123/prompt')) {
          return jsonResponse({ data: { id: 'input_1' } });
        }
        if (String(url).endsWith('/api/session/ses_123/wait')) {
          return emptyResponse();
        }
        if (String(url).endsWith('/api/session/ses_123/context')) {
          return jsonResponse({
            data: [
              {
                id: 'msg_user',
                role: 'user',
                parts: [{ type: 'text', text: 'hello' }],
              },
              {
                id: 'msg_assistant',
                role: 'assistant',
                parts: [{ type: 'text', text: 'world' }],
              },
            ],
          });
        }
        return new Response('not found', { status: 404 });
      },
    });

    await expect(client.sendPrompt({ prompt: 'hello', directory: '/tmp/project' })).resolves.toEqual({
      sessionId: 'ses_123',
      text: 'world',
    });

    expect(calls.map((call) => [call.url, call.init?.method])).toEqual([
      ['http://127.0.0.1:4096/api/session', 'POST'],
      ['http://127.0.0.1:4096/api/session/ses_123/prompt', 'POST'],
      ['http://127.0.0.1:4096/api/session/ses_123/wait', 'POST'],
      ['http://127.0.0.1:4096/api/session/ses_123/context', 'GET'],
    ]);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      location: { directory: '/tmp/project' },
    });
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      prompt: { text: 'hello', files: [], agents: [] },
    });
  });

  it('creates prompt sessions with selected OpenCode model and agent', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createOpenCodeClient({
      baseUrl: 'http://127.0.0.1:4096',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith('/api/session')) {
          return jsonResponse({ data: { id: 'ses_model' } });
        }
        if (String(url).endsWith('/api/session/ses_model/prompt')) {
          return jsonResponse({ data: { id: 'input_1' } });
        }
        if (String(url).endsWith('/api/session/ses_model/wait')) {
          return emptyResponse();
        }
        if (String(url).endsWith('/api/session/ses_model/context')) {
          return jsonResponse({
            data: [{ role: 'assistant', parts: [{ type: 'text', text: 'model response' }] }],
          });
        }
        return new Response('not found', { status: 404 });
      },
    });

    await expect(
      client.sendPrompt({
        prompt: 'hello',
        directory: '/tmp/project',
        model: 'anthropic/claude-sonnet-4',
        agent: 'plan',
      }),
    ).resolves.toEqual({
      sessionId: 'ses_model',
      text: 'model response',
    });

    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      location: { directory: '/tmp/project' },
      model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
      agent: 'plan',
    });
  });

  it('sends selected files with prompt requests', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createOpenCodeClient({
      baseUrl: 'http://127.0.0.1:4096',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith('/api/session')) {
          return jsonResponse({ data: { id: 'ses_files' } });
        }
        if (String(url).endsWith('/api/session/ses_files/prompt')) {
          return jsonResponse({ data: { id: 'input_1' } });
        }
        if (String(url).endsWith('/api/session/ses_files/wait')) {
          return emptyResponse();
        }
        if (String(url).endsWith('/api/session/ses_files/context')) {
          return jsonResponse({
            data: [{ role: 'assistant', parts: [{ type: 'text', text: 'file response' }] }],
          });
        }
        return new Response('not found', { status: 404 });
      },
    });

    await expect(
      client.sendPrompt({
        prompt: 'review',
        files: [
          {
            uri: 'file:///tmp/project/README.md',
            mime: 'text/markdown',
            name: 'README.md',
            description: 'README.md',
          },
        ],
      }),
    ).resolves.toEqual({
      sessionId: 'ses_files',
      text: 'file response',
    });

    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      prompt: {
        text: 'review',
        files: [
          {
            uri: 'file:///tmp/project/README.md',
            mime: 'text/markdown',
            name: 'README.md',
            description: 'README.md',
          },
        ],
        agents: [],
      },
    });
  });

  it('sends slash commands through the OpenCode command endpoint', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createOpenCodeClient({
      baseUrl: 'http://127.0.0.1:4096',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith('/api/session')) {
          return jsonResponse({ data: { id: 'ses_cmd' } });
        }
        if (String(url).includes('/session/ses_cmd/command')) {
          return jsonResponse({ info: { id: 'msg_cmd' }, parts: [] });
        }
        if (String(url).endsWith('/api/session/ses_cmd/wait')) {
          return emptyResponse();
        }
        if (String(url).endsWith('/api/session/ses_cmd/context')) {
          return jsonResponse({
            data: [{ role: 'assistant', parts: [{ type: 'text', text: 'command result' }] }],
          });
        }
        return new Response('not found', { status: 404 });
      },
    });

    await expect(
      client.sendCommand({
        command: 'review',
        arguments: 'now',
        directory: '/tmp/project',
        model: 'anthropic/claude-sonnet-4',
        agent: 'build',
        parts: [
          {
            type: 'file',
            mime: 'text/plain',
            filename: 'README.md',
            url: 'file:///tmp/project/README.md',
          },
        ],
      }),
    ).resolves.toEqual({
      sessionId: 'ses_cmd',
      text: 'command result',
    });

    expect(calls.map((call) => [call.url, call.init?.method])).toEqual([
      ['http://127.0.0.1:4096/api/session', 'POST'],
      ['http://127.0.0.1:4096/session/ses_cmd/command?directory=%2Ftmp%2Fproject', 'POST'],
      ['http://127.0.0.1:4096/api/session/ses_cmd/wait', 'POST'],
      ['http://127.0.0.1:4096/api/session/ses_cmd/context', 'GET'],
    ]);
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      command: 'review',
      arguments: 'now',
      model: 'anthropic/claude-sonnet-4',
      agent: 'build',
      parts: [
        {
          type: 'file',
          mime: 'text/plain',
          filename: 'README.md',
          url: 'file:///tmp/project/README.md',
        },
      ],
    });
  });

  it('streams OpenCode SSE text, tool, and permission events while prompting', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createOpenCodeClient({
      baseUrl: 'http://127.0.0.1:4096',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith('/api/session')) {
          return jsonResponse({ data: { id: 'ses_stream' } });
        }
        if (String(url).startsWith('http://127.0.0.1:4096/api/event')) {
          return sseResponse([
            {
              type: 'session.next.text.delta',
              data: { sessionID: 'ses_stream', delta: 'hello ' },
            },
            {
              type: 'message.part.updated',
              data: {
                sessionID: 'ses_stream',
                part: {
                  type: 'tool',
                  id: 'tool_1',
                  tool: 'read',
                  state: { status: 'completed', title: 'Read README.md', output: 'done' },
                },
              },
            },
            {
              type: 'permission.v2.asked',
              data: {
                sessionID: 'ses_stream',
                id: 'perm_1',
                action: 'execute',
                resources: ['npm test'],
                source: { callID: 'tool_2' },
              },
            },
            {
              type: 'permission.v2.replied',
              data: { sessionID: 'ses_stream', requestID: 'perm_1' },
            },
          ]);
        }
        if (String(url).endsWith('/api/session/ses_stream/prompt')) {
          return jsonResponse({ data: { id: 'input_1' } });
        }
        if (String(url).endsWith('/api/session/ses_stream/wait')) {
          return emptyResponse();
        }
        if (String(url).endsWith('/api/session/ses_stream/context')) {
          return jsonResponse({
            data: [{ role: 'assistant', parts: [{ type: 'text', text: 'hello final' }] }],
          });
        }
        return new Response('not found', { status: 404 });
      },
    });

    const events = [];
    for await (const event of client.streamPrompt!({ prompt: 'hello', directory: '/tmp/project' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'session', sessionId: 'ses_stream' },
      { type: 'content', content: 'hello ' },
      {
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
      },
      {
        type: 'permission',
        request: expect.objectContaining({
          id: 'perm_1',
          sessionID: 'ses_stream',
          action: 'execute',
        }),
      },
      { type: 'permission_resolved', requestId: 'perm_1' },
    ]);
    expect(calls.map((call) => [call.url, call.init?.method])).toEqual([
      ['http://127.0.0.1:4096/api/session', 'POST'],
      ['http://127.0.0.1:4096/api/event?location%5Bdirectory%5D=%2Ftmp%2Fproject', 'GET'],
      ['http://127.0.0.1:4096/api/session/ses_stream/prompt', 'POST'],
      ['http://127.0.0.1:4096/api/session/ses_stream/wait', 'POST'],
      ['http://127.0.0.1:4096/api/session/ses_stream/context', 'GET'],
    ]);
  });

  it('falls back to context text when the OpenCode SSE stream is unavailable', async () => {
    const client = createOpenCodeClient({
      baseUrl: 'http://127.0.0.1:4096',
      fetch: async (url) => {
        if (String(url).endsWith('/api/session')) {
          return jsonResponse({ data: { id: 'ses_fallback' } });
        }
        if (String(url).startsWith('http://127.0.0.1:4096/api/event')) {
          return new Response('events unavailable', { status: 503 });
        }
        if (String(url).endsWith('/api/session/ses_fallback/prompt')) {
          return jsonResponse({ data: { id: 'input_1' } });
        }
        if (String(url).endsWith('/api/session/ses_fallback/wait')) {
          return emptyResponse();
        }
        if (String(url).endsWith('/api/session/ses_fallback/context')) {
          return jsonResponse({
            data: [{ role: 'assistant', parts: [{ type: 'text', text: 'from context' }] }],
          });
        }
        return new Response('not found', { status: 404 });
      },
    });

    const events = [];
    for await (const event of client.streamPrompt!({ prompt: 'hello', directory: '/tmp/project' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'session', sessionId: 'ses_fallback' },
      { type: 'content', content: 'from context' },
    ]);
  });

  it('replies to OpenCode permission requests with legacy fallback', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createOpenCodeClient({
      baseUrl: 'http://127.0.0.1:4096',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith('/api/session/ses_1/permission/perm_1/reply')) {
          return new Response('missing', { status: 404 });
        }
        if (String(url).endsWith('/api/session/ses_1/permissions/perm_1')) {
          return emptyResponse();
        }
        return new Response('not found', { status: 404 });
      },
    });

    await expect(
      client.confirmPermission!({ sessionId: 'ses_1', requestId: 'perm_1', reply: 'once' }),
    ).resolves.toEqual({ success: true });

    expect(calls.map((call) => [call.url, call.init?.method, JSON.parse(String(call.init?.body))])).toEqual([
      [
        'http://127.0.0.1:4096/api/session/ses_1/permission/perm_1/reply',
        'POST',
        { reply: 'once' },
      ],
      [
        'http://127.0.0.1:4096/api/session/ses_1/permissions/perm_1',
        'POST',
        { response: 'once' },
      ],
    ]);
  });

  it('extracts assistant text from common context message shapes', () => {
    expect(
      extractOpenCodeAssistantText([
        { role: 'assistant', parts: [{ type: 'text', text: 'from parts' }] },
      ]),
    ).toBe('from parts');

    expect(
      extractOpenCodeAssistantText([
        { type: 'assistant', content: [{ type: 'text', text: 'from content' }] },
      ]),
    ).toBe('from content');
  });

  it('lists commands from the OpenCode v2 command endpoint', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createOpenCodeClient({
      baseUrl: 'http://127.0.0.1:4096',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return jsonResponse({
          data: [
            {
              name: 'review',
              description: 'Review current changes',
              template: 'Review the diff',
            },
          ],
        });
      },
    });

    await expect(client.listCommands({ directory: '/tmp/project' })).resolves.toEqual([
      {
        command: 'review',
        description: 'Review current changes',
        hint: 'Review the diff',
      },
    ]);

    expect(calls.map((call) => call.url)).toEqual([
      'http://127.0.0.1:4096/api/command?location=%7B%22directory%22%3A%22%2Ftmp%2Fproject%22%7D',
    ]);
  });

  it('lists enabled OpenCode models from the local API', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createOpenCodeClient({
      baseUrl: 'http://127.0.0.1:4096',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return jsonResponse({
          data: [
            { id: 'claude-sonnet-4', providerID: 'anthropic', name: 'Claude Sonnet 4' },
            { id: 'disabled-model', providerID: 'test', enabled: false },
          ],
        });
      },
    });

    await expect(client.listModels!()).resolves.toEqual([
      {
        id: 'anthropic/claude-sonnet-4',
        label: 'Claude Sonnet 4 (anthropic)',
      },
    ]);

    expect(calls.map((call) => [call.url, call.init?.method])).toEqual([
      ['http://127.0.0.1:4096/api/model', 'GET'],
    ]);
  });

  it('extracts commands from legacy and v2 OpenCode response shapes', () => {
    expect(
      extractOpenCodeCommands([
        { name: 'init', description: 'Create project instructions', template: 'Initialize this repo' },
      ]),
    ).toEqual([
      {
        command: 'init',
        description: 'Create project instructions',
        hint: 'Initialize this repo',
      },
    ]);

    expect(
      extractOpenCodeCommands({
        data: [{ name: 'plan', template: 'Make a plan' }],
      }),
    ).toEqual([
      {
        command: 'plan',
        description: 'Make a plan',
        hint: 'Make a plan',
      },
    ]);
  });

  it('extracts enabled OpenCode models from API response shapes', () => {
    expect(
      extractOpenCodeModels({
        data: [
          { id: 'gpt-5', providerID: 'openai', name: 'GPT-5' },
          { id: 'disabled', providerID: 'openai', enabled: false },
          { id: 'missing-provider' },
        ],
      }),
    ).toEqual([
      {
        id: 'openai/gpt-5',
        label: 'GPT-5 (openai)',
      },
    ]);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function emptyResponse(): Response {
  return new Response(null, { status: 204 });
}

function sseResponse(events: unknown[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    },
  );
}
