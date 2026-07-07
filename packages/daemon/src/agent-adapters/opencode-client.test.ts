import { describe, expect, it } from 'vitest';
import { createOpenCodeClient, extractOpenCodeAssistantText, extractOpenCodeCommands } from './opencode-client.js';

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
