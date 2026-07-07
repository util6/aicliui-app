export type OpenCodeClientOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
};

export type OpenCodePromptInput = {
  prompt: string;
  sessionId?: string;
  directory?: string;
};

export type OpenCodePromptResult = {
  sessionId: string;
  text: string;
};

export type OpenCodeSessionClient = {
  sendPrompt(input: OpenCodePromptInput): Promise<OpenCodePromptResult>;
};

export function createOpenCodeClient(options: OpenCodeClientOptions): OpenCodeSessionClient {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OpenCode ${init?.method ?? 'GET'} ${path} failed (${response.status}): ${body}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  async function createSession(input: OpenCodePromptInput): Promise<string> {
    const response = await requestJson<{ data?: { id?: unknown } }>('/api/session', {
      method: 'POST',
      body: JSON.stringify({
        ...(input.directory ? { location: { directory: input.directory } } : {}),
      }),
    });
    const id = response.data?.id;
    if (typeof id !== 'string') {
      throw new Error('OpenCode session.create returned no session id');
    }
    return id;
  }

  return {
    async sendPrompt(input) {
      const sessionId = input.sessionId ?? (await createSession(input));
      await requestJson(`/api/session/${encodeURIComponent(sessionId)}/prompt`, {
        method: 'POST',
        body: JSON.stringify({
          prompt: {
            text: input.prompt,
            files: [],
            agents: [],
          },
        }),
      });
      await requestJson(`/api/session/${encodeURIComponent(sessionId)}/wait`, { method: 'POST' });
      const context = await requestJson<{ data?: unknown[] }>(
        `/api/session/${encodeURIComponent(sessionId)}/context`,
        { method: 'GET' },
      );
      return {
        sessionId,
        text: extractOpenCodeAssistantText(context.data ?? []),
      };
    },
  };
}

export function extractOpenCodeAssistantText(messages: unknown[]): string {
  for (const message of [...messages].reverse()) {
    if (!isAssistantMessage(message)) continue;
    const text = extractTextParts(message);
    if (text) return text;
  }
  return '';
}

function isAssistantMessage(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return value.role === 'assistant' || value.type === 'assistant';
}

function extractTextParts(value: Record<string, unknown>): string {
  const candidates = [value.parts, value.content];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const text = candidate
      .map((part) => (isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
      .join('');
    if (text) return text;
  }
  return typeof value.text === 'string' ? value.text : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
