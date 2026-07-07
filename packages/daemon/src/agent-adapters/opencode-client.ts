export type OpenCodeClientOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
};

export type OpenCodePromptInput = {
  prompt: string;
  sessionId?: string;
  directory?: string;
};

export type OpenCodeCommandInput = {
  command: string;
  arguments?: string;
  sessionId?: string;
  directory?: string;
  workspace?: string;
  model?: string;
  agent?: string;
  messageId?: string;
};

export type OpenCodeCommandListInput = {
  directory?: string;
  workspace?: string;
};

export type OpenCodePromptResult = {
  sessionId: string;
  text: string;
};

export type OpenCodeSessionClient = {
  sendPrompt(input: OpenCodePromptInput): Promise<OpenCodePromptResult>;
  sendCommand(input: OpenCodeCommandInput): Promise<OpenCodePromptResult>;
  listCommands(input?: OpenCodeCommandListInput): Promise<Array<{ command: string; description: string; hint?: string }>>;
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

  async function createSession(input: { directory?: string; workspace?: string }): Promise<string> {
    const location = {
      ...(input.directory ? { directory: input.directory } : {}),
      ...(input.workspace ? { workspace: input.workspace } : {}),
    };
    const response = await requestJson<{ data?: { id?: unknown } }>('/api/session', {
      method: 'POST',
      body: JSON.stringify({
        ...(Object.keys(location).length ? { location } : {}),
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
    async sendCommand(input) {
      const sessionId = input.sessionId ?? (await createSession(input));
      await requestJson(commandSendPath(sessionId, input), {
        method: 'POST',
        body: JSON.stringify({
          command: input.command,
          arguments: input.arguments ?? '',
          ...(input.messageId ? { messageID: input.messageId } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(input.agent ? { agent: input.agent } : {}),
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
    async listCommands(input = {}) {
      const v2Path = commandListV2Path(input);
      try {
        const response = await requestJson<unknown>(v2Path, { method: 'GET' });
        return extractOpenCodeCommands(response);
      } catch {
        const legacyPath = commandListLegacyPath(input);
        const response = await requestJson<unknown>(legacyPath, { method: 'GET' });
        return extractOpenCodeCommands(response);
      }
    },
  };
}

function commandSendPath(sessionId: string, input: OpenCodeCommandInput): string {
  const params = new URLSearchParams();
  if (input.directory) params.set('directory', input.directory);
  if (input.workspace) params.set('workspace', input.workspace);
  const query = params.toString();
  return `/session/${encodeURIComponent(sessionId)}/command${query ? `?${query}` : ''}`;
}

function commandListV2Path(input: OpenCodeCommandListInput): string {
  const location: Record<string, string> = {};
  if (input.directory) location.directory = input.directory;
  if (input.workspace) location.workspace = input.workspace;
  if (Object.keys(location).length === 0) return '/api/command';
  return `/api/command?location=${encodeURIComponent(JSON.stringify(location))}`;
}

function commandListLegacyPath(input: OpenCodeCommandListInput): string {
  const params = new URLSearchParams();
  if (input.directory) params.set('directory', input.directory);
  if (input.workspace) params.set('workspace', input.workspace);
  const query = params.toString();
  return query ? `/command?${query}` : '/command';
}

export function extractOpenCodeAssistantText(messages: unknown[]): string {
  for (const message of [...messages].reverse()) {
    if (!isAssistantMessage(message)) continue;
    const text = extractTextParts(message);
    if (text) return text;
  }
  return '';
}

export function extractOpenCodeCommands(value: unknown): Array<{ command: string; description: string; hint?: string }> {
  const rawCommands = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.data) ? value.data : [];

  return rawCommands
    .filter(isRecord)
    .map((command) => {
      const name = stringValue(command.name) ?? stringValue(command.command);
      const template = stringValue(command.template);
      const description = stringValue(command.description) ?? template;
      if (!name || !description) return null;

      return {
        command: name,
        description,
        ...(template ? { hint: template } : {}),
      };
    })
    .filter((command): command is { command: string; description: string; hint?: string } => command !== null);
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

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
