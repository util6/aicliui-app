export type OpenCodeClientOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
};

export type OpenCodePromptInput = {
  prompt: string;
  sessionId?: string;
  directory?: string;
  workspace?: string;
  model?: string;
  agent?: string;
  files?: OpenCodePromptFile[];
  signal?: AbortSignal;
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
  parts?: OpenCodeCommandPart[];
  signal?: AbortSignal;
};

export type OpenCodeCommandPart = {
  type: 'file';
  mime: string;
  filename?: string;
  url: string;
};

export type OpenCodePromptFile = {
  uri: string;
  mime: string;
  name?: string;
  description?: string;
};

export type OpenCodeCommandListInput = {
  directory?: string;
  workspace?: string;
};

export type OpenCodeModelInfo = {
  id: string;
  label: string;
};

export type OpenCodePromptResult = {
  sessionId: string;
  text: string;
};

export type OpenCodeToolUpdate = {
  callId: string;
  call_id: string;
  name: string;
  description: string;
  status: 'Executing' | 'Success' | 'Error' | 'Canceled' | 'Pending' | 'Confirming';
  resultDisplay: string;
  result_display: string;
};

export type OpenCodePermissionRequest = Record<string, unknown> & {
  id: string;
  sessionID: string;
};

export type OpenCodePermissionReply = 'once' | 'always' | 'reject';

export type OpenCodeQuestionRequest = Record<string, unknown> & {
  id: string;
  sessionID: string;
  questions?: unknown[];
};

export type OpenCodeThinkingUpdate = {
  subject?: string;
  content: string;
  status: 'thinking' | 'done';
};

export type OpenCodeContextUsageUpdate = {
  used: number;
  size: number;
};

export type OpenCodeAgentStatusUpdate = {
  data: Record<string, unknown>;
};

export type OpenCodeStreamEvent =
  | {
      type: 'session';
      sessionId: string;
    }
  | {
      type: 'content';
      content: string;
    }
  | {
      type: 'tool';
      tool: OpenCodeToolUpdate;
    }
  | {
      type: 'thinking';
      subject?: string;
      content: string;
      status: 'thinking' | 'done';
    }
  | {
      type: 'context_usage';
      used: number;
      size: number;
    }
  | {
      type: 'agent_status';
      data: Record<string, unknown>;
    }
  | {
      type: 'permission';
      request: OpenCodePermissionRequest;
    }
  | {
      type: 'permission_resolved';
      requestId: string;
    }
  | {
      type: 'question';
      request: OpenCodeQuestionRequest;
    }
  | {
      type: 'question_resolved';
      requestId: string;
    };

export type OpenCodeConfirmPermissionInput = {
  sessionId: string;
  requestId: string;
  reply: OpenCodePermissionReply;
};

export type OpenCodeReplyQuestionInput = {
  sessionId: string;
  requestId: string;
  answers: string[][];
};

export type OpenCodeRejectQuestionInput = {
  sessionId: string;
  requestId: string;
};

export type OpenCodeSessionClient = {
  sendPrompt(input: OpenCodePromptInput): Promise<OpenCodePromptResult>;
  sendCommand(input: OpenCodeCommandInput): Promise<OpenCodePromptResult>;
  streamPrompt?(input: OpenCodePromptInput): AsyncIterable<OpenCodeStreamEvent>;
  streamCommand?(input: OpenCodeCommandInput): AsyncIterable<OpenCodeStreamEvent>;
  confirmPermission?(input: OpenCodeConfirmPermissionInput): Promise<{ success: true }>;
  replyQuestion?(input: OpenCodeReplyQuestionInput): Promise<{ success: true }>;
  rejectQuestion?(input: OpenCodeRejectQuestionInput): Promise<{ success: true }>;
  listCommands(input?: OpenCodeCommandListInput): Promise<Array<{ command: string; description: string; hint?: string }>>;
  listModels?(): Promise<OpenCodeModelInfo[]>;
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

  async function createSession(input: {
    directory?: string;
    workspace?: string;
    model?: string;
    agent?: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const location = {
      ...(input.directory ? { directory: input.directory } : {}),
      ...(input.workspace ? { workspace: input.workspace } : {}),
    };
    const model = parseOpenCodeModelRef(input.model);
    const response = await requestJson<{ data?: { id?: unknown } }>('/api/session', {
      method: 'POST',
      signal: input.signal,
      body: JSON.stringify({
        ...(Object.keys(location).length ? { location } : {}),
        ...(model ? { model } : {}),
        ...(input.agent ? { agent: input.agent } : {}),
      }),
    });
    const id = response.data?.id;
    if (typeof id !== 'string') {
      throw new Error('OpenCode session.create returned no session id');
    }
    return id;
  }

  async function* streamTurn(
    input: {
      sessionId?: string;
      directory?: string;
      workspace?: string;
      model?: string;
      agent?: string;
      signal?: AbortSignal;
    },
    submitTurn: (sessionId: string) => Promise<void>,
  ): AsyncIterable<OpenCodeStreamEvent> {
    const sessionId = input.sessionId ?? (await createSession(input));
    yield { type: 'session', sessionId };

    const queue = createAsyncQueue<OpenCodeStreamEvent>();
    let streamedContent = false;
    const eventStream = subscribeOpenCodeSessionEvents({
      baseUrl,
      fetchImpl,
      sessionId,
      directory: input.directory,
      workspace: input.workspace,
      signal: input.signal,
      handlers: {
        onContent(content) {
          streamedContent = true;
          queue.push({ type: 'content', content });
        },
        onTool(tool) {
          queue.push({ type: 'tool', tool });
        },
        onThinking(update) {
          queue.push({ type: 'thinking', ...update });
        },
        onContextUsage(update) {
          queue.push({ type: 'context_usage', ...update });
        },
        onAgentStatus(update) {
          queue.push({ type: 'agent_status', data: update.data });
        },
        onPermission(request) {
          queue.push({ type: 'permission', request });
        },
        onPermissionResolved(requestId) {
          queue.push({ type: 'permission_resolved', requestId });
        },
        onQuestion(request) {
          queue.push({ type: 'question', request });
        },
        onQuestionResolved(requestId) {
          queue.push({ type: 'question_resolved', requestId });
        },
      },
    });

    let requestTask: Promise<void> | undefined;
    try {
      await eventStream.ready;
      requestTask = (async () => {
        await submitTurn(sessionId);
        await requestJson(`/api/session/${encodeURIComponent(sessionId)}/wait`, {
          method: 'POST',
          signal: input.signal,
        });
      })();

      requestTask.then(
        async () => {
          eventStream.close();
          await eventStream.done;
          queue.close();
        },
        (error) => {
          eventStream.close();
          queue.fail(error);
        },
      );

      for await (const event of queue) {
        yield event;
      }

      await requestTask;
    } finally {
      eventStream.close();
      await eventStream.done.catch(() => {});
    }

    const context = await requestJson<{ data?: unknown[] }>(`/api/session/${encodeURIComponent(sessionId)}/context`, {
      method: 'GET',
      signal: input.signal,
    });
    const text = extractOpenCodeAssistantText(context.data ?? []);
    if (!streamedContent && text) {
      yield { type: 'content', content: text };
    }
  }

  return {
    async sendPrompt(input) {
      const sessionId = input.sessionId ?? (await createSession(input));
      await requestJson(`/api/session/${encodeURIComponent(sessionId)}/prompt`, {
        method: 'POST',
        signal: input.signal,
        body: JSON.stringify({
          prompt: {
            text: input.prompt,
            files: input.files ?? [],
            agents: [],
          },
        }),
      });
      await requestJson(`/api/session/${encodeURIComponent(sessionId)}/wait`, { method: 'POST', signal: input.signal });
      const context = await requestJson<{ data?: unknown[] }>(
        `/api/session/${encodeURIComponent(sessionId)}/context`,
        { method: 'GET', signal: input.signal },
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
        signal: input.signal,
        body: JSON.stringify({
          command: input.command,
          arguments: input.arguments ?? '',
          ...(input.messageId ? { messageID: input.messageId } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(input.agent ? { agent: input.agent } : {}),
          ...(input.parts?.length ? { parts: input.parts } : {}),
        }),
      });
      await requestJson(`/api/session/${encodeURIComponent(sessionId)}/wait`, { method: 'POST', signal: input.signal });
      const context = await requestJson<{ data?: unknown[] }>(
        `/api/session/${encodeURIComponent(sessionId)}/context`,
        { method: 'GET', signal: input.signal },
      );
      return {
        sessionId,
        text: extractOpenCodeAssistantText(context.data ?? []),
      };
    },
    streamPrompt(input) {
      return streamTurn(input, async (sessionId) => {
        await requestJson(`/api/session/${encodeURIComponent(sessionId)}/prompt`, {
          method: 'POST',
          signal: input.signal,
          body: JSON.stringify({
            prompt: {
              text: input.prompt,
              files: input.files ?? [],
              agents: [],
            },
          }),
        });
      });
    },
    streamCommand(input) {
      return streamTurn(input, async (sessionId) => {
        await requestJson(commandSendPath(sessionId, input), {
          method: 'POST',
          signal: input.signal,
          body: JSON.stringify({
            command: input.command,
            arguments: input.arguments ?? '',
            ...(input.messageId ? { messageID: input.messageId } : {}),
            ...(input.model ? { model: input.model } : {}),
            ...(input.agent ? { agent: input.agent } : {}),
            ...(input.parts?.length ? { parts: input.parts } : {}),
          }),
        });
      });
    },
    async confirmPermission(input) {
      try {
        await requestJson(`/api/session/${encodeURIComponent(input.sessionId)}/permission/${encodeURIComponent(input.requestId)}/reply`, {
          method: 'POST',
          body: JSON.stringify({ reply: input.reply }),
        });
      } catch {
        await requestJson(`/api/session/${encodeURIComponent(input.sessionId)}/permissions/${encodeURIComponent(input.requestId)}`, {
          method: 'POST',
          body: JSON.stringify({ response: input.reply }),
        });
      }
      return { success: true };
    },
    async replyQuestion(input) {
      await requestJson(`/api/session/${encodeURIComponent(input.sessionId)}/question/${encodeURIComponent(input.requestId)}/reply`, {
        method: 'POST',
        body: JSON.stringify({ answers: input.answers }),
      });
      return { success: true };
    },
    async rejectQuestion(input) {
      await requestJson(`/api/session/${encodeURIComponent(input.sessionId)}/question/${encodeURIComponent(input.requestId)}/reject`, {
        method: 'POST',
      });
      return { success: true };
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
    async listModels() {
      const response = await requestJson<unknown>('/api/model', { method: 'GET' });
      return extractOpenCodeModels(response);
    },
  };
}

type OpenCodeEventStreamHandlers = {
  onContent(content: string): void;
  onTool(tool: OpenCodeToolUpdate): void;
  onThinking(update: OpenCodeThinkingUpdate): void;
  onContextUsage(update: OpenCodeContextUsageUpdate): void;
  onAgentStatus(update: OpenCodeAgentStatusUpdate): void;
  onPermission(request: OpenCodePermissionRequest): void;
  onPermissionResolved(requestId: string): void;
  onQuestion(request: OpenCodeQuestionRequest): void;
  onQuestionResolved(requestId: string): void;
};

function createAsyncQueue<T>(): {
  push: (value: T) => void;
  close: () => void;
  fail: (error: unknown) => void;
  [Symbol.asyncIterator]: () => AsyncIterator<T>;
} {
  const values: T[] = [];
  const waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: unknown) => void;
  }> = [];
  let closed = false;
  let failure: unknown;

  const next = (): Promise<IteratorResult<T>> => {
    if (values.length > 0) {
      return Promise.resolve({ value: values.shift() as T, done: false });
    }
    if (failure !== undefined) {
      return Promise.reject(failure);
    }
    if (closed) {
      return Promise.resolve({ value: undefined, done: true });
    }
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      waiters.push({ resolve, reject });
    });
  };

  return {
    push(value) {
      if (closed || failure !== undefined) return;
      const waiter = waiters.shift();
      if (waiter) {
        waiter.resolve({ value, done: false });
        return;
      }
      values.push(value);
    },
    close() {
      if (closed) return;
      closed = true;
      for (const waiter of waiters.splice(0)) {
        waiter.resolve({ value: undefined, done: true });
      }
    },
    fail(error) {
      if (closed || failure !== undefined) return;
      failure = error;
      for (const waiter of waiters.splice(0)) {
        waiter.reject(error);
      }
    },
    [Symbol.asyncIterator]() {
      return { next };
    },
  };
}

function subscribeOpenCodeSessionEvents(input: {
  baseUrl: string;
  fetchImpl: typeof fetch;
  sessionId: string;
  directory?: string;
  workspace?: string;
  signal?: AbortSignal;
  handlers: OpenCodeEventStreamHandlers;
}): { ready: Promise<void>; done: Promise<void>; close: () => void } {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(input.signal?.reason ?? new Error('OpenCode event stream aborted'));
  if (input.signal?.aborted) abortFromParent();
  else input.signal?.addEventListener('abort', abortFromParent, { once: true });

  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const done = (async () => {
    try {
      const response = await input.fetchImpl(`${input.baseUrl}${eventStreamPath(input)}`, {
        method: 'GET',
        signal: controller.signal,
      });
      resolveReady();
      if (!response.ok || !response.body) return;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const extractTextDelta = createOpenCodeTextDeltaExtractor(input.sessionId);
      const extractReasoningEvent = createOpenCodeReasoningEventExtractor(input.sessionId);
      const extractCompactionEvent = createOpenCodeCompactionEventExtractor(input.sessionId);
      const extractToolUpdate = createOpenCodeToolUpdateExtractor(input.sessionId);
      const extractContextUsage = createOpenCodeContextUsageExtractor(input.sessionId);
      const extractAgentStatus = createOpenCodeAgentStatusExtractor(input.sessionId);
      const extractPermissionEvent = createOpenCodePermissionEventExtractor(input.sessionId);
      const extractQuestionEvent = createOpenCodeQuestionEventExtractor(input.sessionId);
      const parse = createSseParser((event) => {
        const text = extractTextDelta(event);
        if (text) input.handlers.onContent(text);

        const reasoning = extractReasoningEvent(event);
        if (reasoning) input.handlers.onThinking(reasoning);

        const compaction = extractCompactionEvent(event);
        if (compaction) input.handlers.onThinking(compaction);

        const tool = extractToolUpdate(event);
        if (tool) input.handlers.onTool(tool);

        const contextUsage = extractContextUsage(event);
        if (contextUsage) input.handlers.onContextUsage(contextUsage);

        const agentStatus = extractAgentStatus(event);
        if (agentStatus) input.handlers.onAgentStatus(agentStatus);

        const permissionEvent = extractPermissionEvent(event);
        if (permissionEvent?.type === 'asked') input.handlers.onPermission(permissionEvent.request);
        if (permissionEvent?.type === 'resolved') input.handlers.onPermissionResolved(permissionEvent.requestId);

        const questionEvent = extractQuestionEvent(event);
        if (questionEvent?.type === 'asked') input.handlers.onQuestion(questionEvent.request);
        if (questionEvent?.type === 'resolved') input.handlers.onQuestionResolved(questionEvent.requestId);
      });

      while (true) {
        const next = await reader.read();
        if (next.done) break;
        parse(decoder.decode(next.value, { stream: true }));
      }
      parse(decoder.decode());
    } catch {
      resolveReady();
    } finally {
      resolveReady();
      input.signal?.removeEventListener('abort', abortFromParent);
    }
  })();

  return {
    ready,
    done,
    close() {
      controller.abort(new Error('OpenCode event stream closed'));
    },
  };
}

function eventStreamPath(input: { directory?: string; workspace?: string }): string {
  if (input.directory) return `/api/event?location%5Bdirectory%5D=${encodeURIComponent(input.directory)}`;
  if (input.workspace) return `/api/event?location%5Bworkspace%5D=${encodeURIComponent(input.workspace)}`;
  return '/api/event';
}

function createSseParser(onEvent: (event: unknown) => void): (chunk: string) => void {
  let buffer = '';
  return (chunk) => {
    buffer += chunk;
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';
    for (const block of blocks) parseSseEventBlock(block, onEvent);
  };
}

function parseSseEventBlock(block: string, onEvent: (event: unknown) => void): void {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trimStart())
    .join('\n');
  if (!data) return;
  try {
    onEvent(JSON.parse(data));
  } catch {
    // Ignore malformed event frames.
  }
}

function createOpenCodeTextDeltaExtractor(sessionId: string): (event: unknown) => string {
  const textByPartId = new Map<string, string>();
  return (event) => extractOpenCodeEventTextDelta(event, sessionId, textByPartId);
}

function extractOpenCodeEventTextDelta(
  event: unknown,
  sessionId: string,
  textByPartId: Map<string, string>,
): string {
  if (!isRecord(event)) return '';
  const payload = isRecord(event.payload) ? event.payload : event;
  const type = typeof payload.type === 'string' ? payload.type : '';
  const data = isRecord(payload.data) ? payload.data : isRecord(payload.properties) ? payload.properties : {};
  if (type === 'session.next.text.delta' && data.sessionID === sessionId && typeof data.delta === 'string') {
    const textId = stringValue(data.textID);
    if (textId) {
      textByPartId.set(textId, (textByPartId.get(textId) || '') + data.delta);
    }
    return data.delta;
  }
  if (type === 'session.next.text.ended' && data.sessionID === sessionId && typeof data.text === 'string') {
    const textId = stringValue(data.textID);
    if (!textId) return data.text;
    const previous = textByPartId.get(textId) || '';
    textByPartId.set(textId, data.text);
    return data.text.startsWith(previous) ? data.text.slice(previous.length) : data.text;
  }
  if (type !== 'message.part.updated') return '';
  const part = isRecord(data.part) ? data.part : {};
  const partSessionId = typeof data.sessionID === 'string' ? data.sessionID : part.sessionID;
  if (partSessionId !== sessionId || part.type !== 'text') return '';
  if (typeof data.delta === 'string') return data.delta;

  const partId = typeof part.id === 'string' ? part.id : '';
  if (!partId || typeof part.text !== 'string') return '';
  const previous = textByPartId.get(partId) || '';
  textByPartId.set(partId, part.text);
  return part.text.startsWith(previous) ? part.text.slice(previous.length) : '';
}

function createOpenCodeReasoningEventExtractor(sessionId: string): (event: unknown) => OpenCodeThinkingUpdate | null {
  return (event) => extractOpenCodeReasoningEvent(event, sessionId);
}

function extractOpenCodeReasoningEvent(event: unknown, sessionId: string): OpenCodeThinkingUpdate | null {
  if (!isRecord(event)) return null;
  const payload = isRecord(event.payload) ? event.payload : event;
  const type = typeof payload.type === 'string' ? payload.type : '';
  const data = isRecord(payload.data) ? payload.data : isRecord(payload.properties) ? payload.properties : {};
  if (data.sessionID !== sessionId) return null;
  if (type === 'session.next.reasoning.delta' && typeof data.delta === 'string') {
    return { content: data.delta, status: 'thinking' };
  }
  if (type === 'session.next.reasoning.ended') {
    return { content: '', status: 'done' };
  }
  return null;
}

function createOpenCodeCompactionEventExtractor(sessionId: string): (event: unknown) => OpenCodeThinkingUpdate | null {
  return (event) => extractOpenCodeCompactionEvent(event, sessionId);
}

function extractOpenCodeCompactionEvent(event: unknown, sessionId: string): OpenCodeThinkingUpdate | null {
  if (!isRecord(event)) return null;
  const payload = isRecord(event.payload) ? event.payload : event;
  const type = typeof payload.type === 'string' ? payload.type : '';
  const data = isRecord(payload.data) ? payload.data : isRecord(payload.properties) ? payload.properties : {};
  if (data.sessionID !== sessionId) return null;
  if (type === 'session.next.compaction.started') {
    return { subject: 'OpenCode compaction', content: 'Compacting context', status: 'thinking' };
  }
  if (type === 'session.next.compaction.delta' && typeof data.text === 'string') {
    return { subject: 'OpenCode compaction', content: data.text, status: 'thinking' };
  }
  if (type === 'session.next.compaction.ended') {
    return { subject: 'OpenCode compaction', content: '', status: 'done' };
  }
  return null;
}

function createOpenCodeContextUsageExtractor(sessionId: string): (event: unknown) => OpenCodeContextUsageUpdate | null {
  return (event) => extractOpenCodeContextUsage(event, sessionId);
}

function extractOpenCodeContextUsage(event: unknown, sessionId: string): OpenCodeContextUsageUpdate | null {
  if (!isRecord(event)) return null;
  const payload = isRecord(event.payload) ? event.payload : event;
  const type = typeof payload.type === 'string' ? payload.type : '';
  const data = isRecord(payload.data) ? payload.data : isRecord(payload.properties) ? payload.properties : {};
  if (type !== 'session.next.step.ended') return null;
  if (data.sessionID !== sessionId) return null;
  const tokens = isRecord(data.tokens) ? data.tokens : null;
  return tokens ? openCodeContextUsageFromTokens(tokens) : null;
}

function openCodeContextUsageFromTokens(tokens: Record<string, unknown>): OpenCodeContextUsageUpdate | null {
  const cache = isRecord(tokens.cache) ? tokens.cache : {};
  const used =
    numberValue(tokens.input) +
    numberValue(tokens.output) +
    numberValue(tokens.reasoning) +
    numberValue(cache.read) +
    numberValue(cache.write);
  return used > 0 ? { used, size: used } : null;
}

function createOpenCodeAgentStatusExtractor(sessionId: string): (event: unknown) => OpenCodeAgentStatusUpdate | null {
  return (event) => extractOpenCodeAgentStatus(event, sessionId);
}

function extractOpenCodeAgentStatus(event: unknown, sessionId: string): OpenCodeAgentStatusUpdate | null {
  if (!isRecord(event)) return null;
  const payload = isRecord(event.payload) ? event.payload : event;
  const type = typeof payload.type === 'string' ? payload.type : '';
  const data = isRecord(payload.data) ? payload.data : isRecord(payload.properties) ? payload.properties : {};
  if (data.sessionID !== sessionId) return null;
  if (type === 'session.next.agent.switched') return openCodeAgentSwitchedStatus(data, sessionId);
  if (type === 'session.next.model.switched') return openCodeModelSwitchedStatus(data, sessionId);
  if (type === 'session.next.moved') return openCodeMovedStatus(data, sessionId);
  if (type === 'session.next.context.updated') return openCodeContextUpdatedStatus(data, sessionId);
  if (type === 'session.next.step.started') return openCodeStepStartedStatus(data, sessionId);
  if (type === 'session.next.step.failed') return openCodeStepFailedStatus(data, sessionId);
  if (type === 'session.next.retried') return openCodeRetriedStatus(data, sessionId);
  if (type === 'session.next.prompted') return openCodePromptedStatus(data, sessionId);
  if (type === 'session.next.prompt.admitted') return openCodePromptAdmittedStatus(data, sessionId);
  if (type === 'session.next.prompt.promoted') return openCodePromptPromotedStatus(data, sessionId);
  if (type === 'session.next.interrupt.requested') return openCodeInterruptRequestedStatus(sessionId);
  return null;
}

function openCodeAgentSwitchedStatus(data: Record<string, unknown>, sessionId: string): OpenCodeAgentStatusUpdate {
  const messageId = stringValue(data.messageID);
  const agent = stringValue(data.agent);
  const message = agent ? `Agent switched to ${agent}` : 'Agent switched';
  return {
    data: {
      ...openCodeAgentStatusBase('agent_switched', sessionId),
      ...(messageId ? { messageId } : {}),
      ...(agent ? { agent } : {}),
      message,
      detail: message,
    },
  };
}

function openCodeModelSwitchedStatus(data: Record<string, unknown>, sessionId: string): OpenCodeAgentStatusUpdate {
  const messageId = stringValue(data.messageID);
  const model = openCodeModelRef(data.model);
  const message = model ? `Model switched to ${model}` : 'Model switched';
  return {
    data: {
      ...openCodeAgentStatusBase('model_switched', sessionId),
      ...(messageId ? { messageId } : {}),
      ...(model ? { model } : {}),
      message,
      detail: message,
    },
  };
}

function openCodeMovedStatus(data: Record<string, unknown>, sessionId: string): OpenCodeAgentStatusUpdate {
  const location = isRecord(data.location) ? data.location : undefined;
  const directory = location ? stringValue(location.directory) : undefined;
  const subdirectory = stringValue(data.subdirectory);
  const target = openCodeMovedTarget(directory, subdirectory);
  const message = target ? `Workspace moved to ${target}` : 'Workspace moved';
  return {
    data: {
      ...openCodeAgentStatusBase('workspace_moved', sessionId),
      ...(location ? { location } : {}),
      ...(directory ? { directory } : {}),
      ...(subdirectory ? { subdirectory } : {}),
      message,
      detail: message,
    },
  };
}

function openCodeContextUpdatedStatus(data: Record<string, unknown>, sessionId: string): OpenCodeAgentStatusUpdate {
  const messageId = stringValue(data.messageID);
  const message = stringValue(data.text) ?? 'Context updated';
  return {
    data: {
      ...openCodeAgentStatusBase('context_updated', sessionId),
      ...(messageId ? { messageId } : {}),
      message,
      detail: message,
    },
  };
}

function openCodeStepStartedStatus(data: Record<string, unknown>, sessionId: string): OpenCodeAgentStatusUpdate {
  const messageId = stringValue(data.assistantMessageID);
  const agent = stringValue(data.agent);
  const model = openCodeModelRef(data.model);
  return {
    data: {
      ...openCodeAgentStatusBase('session_active', sessionId),
      ...(messageId ? { messageId } : {}),
      ...(agent ? { agent } : {}),
      ...(model ? { model } : {}),
    },
  };
}

function openCodeStepFailedStatus(data: Record<string, unknown>, sessionId: string): OpenCodeAgentStatusUpdate {
  const messageId = stringValue(data.assistantMessageID);
  const error = isRecord(data.error) ? data.error : {};
  const message = stringValue(error.message) ?? 'OpenCode step failed';
  return {
    data: {
      ...openCodeAgentStatusBase('error', sessionId),
      ...(messageId ? { messageId } : {}),
      message,
      detail: message,
    },
  };
}

function openCodeRetriedStatus(data: Record<string, unknown>, sessionId: string): OpenCodeAgentStatusUpdate {
  const attempt = typeof data.attempt === 'number' && Number.isFinite(data.attempt) ? data.attempt : undefined;
  const error = isRecord(data.error) ? data.error : {};
  const errorMessage = stringValue(error.message);
  const message = `Retrying OpenCode request${attempt ? ` (attempt ${attempt})` : ''}${
    errorMessage ? `: ${errorMessage}` : ''
  }`;
  const statusCode =
    typeof error.statusCode === 'number' && Number.isFinite(error.statusCode) ? error.statusCode : undefined;
  const retryable = typeof error.isRetryable === 'boolean' ? error.isRetryable : undefined;
  return {
    data: {
      ...openCodeAgentStatusBase('retrying', sessionId),
      ...(attempt !== undefined ? { attempt } : {}),
      message,
      detail: message,
      ...(retryable !== undefined ? { retryable } : {}),
      ...(statusCode !== undefined ? { statusCode } : {}),
    },
  };
}

function openCodePromptedStatus(data: Record<string, unknown>, sessionId: string): OpenCodeAgentStatusUpdate {
  const messageId = stringValue(data.messageID);
  const delivery = stringValue(data.delivery);
  const status = delivery === 'queue' ? 'prompt_queued' : 'prompt_requested';
  const message = delivery === 'queue' ? 'Prompt queued' : 'Prompt requested';
  return {
    data: {
      ...openCodeAgentStatusBase(status, sessionId),
      ...(messageId ? { messageId } : {}),
      ...(delivery ? { delivery } : {}),
      message,
      detail: message,
    },
  };
}

function openCodePromptAdmittedStatus(data: Record<string, unknown>, sessionId: string): OpenCodeAgentStatusUpdate {
  const messageId = stringValue(data.messageID);
  const delivery = stringValue(data.delivery);
  const message = 'Prompt admitted';
  return {
    data: {
      ...openCodeAgentStatusBase('prompt_admitted', sessionId),
      ...(messageId ? { messageId } : {}),
      ...(delivery ? { delivery } : {}),
      message,
      detail: message,
    },
  };
}

function openCodePromptPromotedStatus(data: Record<string, unknown>, sessionId: string): OpenCodeAgentStatusUpdate {
  const messageId = stringValue(data.messageID);
  const timeCreated = stringValue(data.timeCreated);
  const message = 'Queued prompt promoted';
  return {
    data: {
      ...openCodeAgentStatusBase('prompt_promoted', sessionId),
      ...(messageId ? { messageId } : {}),
      ...(timeCreated ? { timeCreated } : {}),
      message,
      detail: message,
    },
  };
}

function openCodeInterruptRequestedStatus(sessionId: string): OpenCodeAgentStatusUpdate {
  const message = 'Interrupt requested';
  return {
    data: {
      ...openCodeAgentStatusBase('interrupt_requested', sessionId),
      message,
      detail: message,
    },
  };
}

function openCodeAgentStatusBase(status: string, sessionId: string): Record<string, unknown> {
  return {
    backend: 'opencode',
    agentName: 'OpenCode',
    agent_name: 'OpenCode',
    status,
    sessionId,
  };
}

function openCodeMovedTarget(directory?: string, subdirectory?: string): string {
  if (!directory) return subdirectory ?? '';
  if (!subdirectory) return directory;
  return `${directory.replace(/\/+$/, '')}/${subdirectory.replace(/^\/+/, '')}`;
}

function openCodeModelRef(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (!isRecord(value)) return undefined;
  const providerId = stringValue(value.providerID) ?? stringValue(value.providerId) ?? stringValue(value.provider);
  const id = stringValue(value.id);
  return providerId && id ? `${providerId}/${id}` : id;
}

function createOpenCodeToolUpdateExtractor(sessionId: string): (event: unknown) => OpenCodeToolUpdate | null {
  const toolByCallId = new Map<string, { name: string; description: string; inputText?: string }>();
  return (event) => extractOpenCodeToolUpdate(event, sessionId, toolByCallId);
}

function extractOpenCodeToolUpdate(
  event: unknown,
  sessionId: string,
  toolByCallId: Map<string, { name: string; description: string; inputText?: string }>,
): OpenCodeToolUpdate | null {
  const shellTool = extractOpenCodeShellToolUpdate(event, sessionId, toolByCallId);
  if (shellTool) return shellTool;

  const nextTool = extractOpenCodeNextToolUpdate(event, sessionId, toolByCallId);
  if (nextTool) return nextTool;

  if (!isRecord(event)) return null;
  const payload = isRecord(event.payload) ? event.payload : event;
  const type = typeof payload.type === 'string' ? payload.type : '';
  const data = isRecord(payload.data) ? payload.data : isRecord(payload.properties) ? payload.properties : {};
  if (type !== 'message.part.updated') return null;
  const part = isRecord(data.part) ? data.part : {};
  const partSessionId = typeof data.sessionID === 'string' ? data.sessionID : part.sessionID;
  if (partSessionId !== sessionId || part.type !== 'tool') return null;

  const state = isRecord(part.state) ? part.state : {};
  const callId = typeof part.callID === 'string' ? part.callID : typeof part.id === 'string' ? part.id : '';
  if (!callId) return null;

  const resultDisplay = openCodeToolResultDisplay(state);
  const name = typeof part.tool === 'string' && part.tool ? part.tool : 'tool';
  const description = openCodeToolTitle(part, state);
  toolByCallId.set(callId, { name, description });
  return openCodeToolUpdate(callId, name, description, openCodeToolStatus(state.status), resultDisplay);
}

function extractOpenCodeShellToolUpdate(
  event: unknown,
  sessionId: string,
  toolByCallId: Map<string, { name: string; description: string; inputText?: string }>,
): OpenCodeToolUpdate | null {
  if (!isRecord(event)) return null;
  const payload = isRecord(event.payload) ? event.payload : event;
  const type = typeof payload.type === 'string' ? payload.type : '';
  const data = isRecord(payload.data) ? payload.data : isRecord(payload.properties) ? payload.properties : {};
  if (data.sessionID !== sessionId) return null;
  const callId = stringValue(data.callID);
  if (!callId) return null;

  if (type === 'session.next.shell.started') {
    const command = stringValue(data.command) ?? 'shell';
    toolByCallId.set(callId, { name: 'shell', description: command });
    return openCodeToolUpdate(callId, 'shell', command, 'Executing', '');
  }

  if (type === 'session.next.shell.ended') {
    const cached = toolByCallId.get(callId) ?? { name: 'shell', description: callId };
    const output = typeof data.output === 'string' ? data.output : '';
    return openCodeToolUpdate(callId, cached.name, cached.description, 'Success', output);
  }

  return null;
}

function extractOpenCodeNextToolUpdate(
  event: unknown,
  sessionId: string,
  toolByCallId: Map<string, { name: string; description: string; inputText?: string }>,
): OpenCodeToolUpdate | null {
  if (!isRecord(event)) return null;
  const payload = isRecord(event.payload) ? event.payload : event;
  const type = typeof payload.type === 'string' ? payload.type : '';
  const data = isRecord(payload.data) ? payload.data : isRecord(payload.properties) ? payload.properties : {};
  if (data.sessionID !== sessionId) return null;
  const callId = stringValue(data.callID);
  if (!callId) return null;
  const cached = toolByCallId.get(callId) ?? { name: 'tool', description: callId };

  if (type === 'session.next.tool.input.started') {
    const name = stringValue(data.name) ?? cached.name;
    const description = name;
    toolByCallId.set(callId, { name, description, inputText: '' });
    return openCodeToolUpdate(callId, name, description, 'Pending', '');
  }

  if (type === 'session.next.tool.input.delta') {
    const delta = stringValue(data.delta) ?? '';
    const nextInputText = (cached.inputText ?? '') + delta;
    toolByCallId.set(callId, { ...cached, inputText: nextInputText });
    return openCodeToolUpdate(callId, cached.name, cached.description, 'Pending', nextInputText);
  }

  if (type === 'session.next.tool.input.ended') {
    const nextInputText = stringValue(data.text) ?? cached.inputText ?? '';
    const description = nextInputText || cached.description;
    toolByCallId.set(callId, { ...cached, description, inputText: nextInputText });
    return openCodeToolUpdate(callId, cached.name, description, 'Pending', nextInputText);
  }

  if (type === 'session.next.tool.called') {
    const name = stringValue(data.tool) ?? cached.name;
    const description = openCodeToolTitle({ tool: name }, { input: data.input });
    toolByCallId.set(callId, { name, description });
    return openCodeToolUpdate(callId, name, description, 'Executing', '');
  }

  if (type === 'session.next.tool.progress') {
    return openCodeToolUpdate(callId, cached.name, cached.description, 'Executing', openCodeNextToolDisplay(data));
  }
  if (type === 'session.next.tool.success') {
    return openCodeToolUpdate(callId, cached.name, cached.description, 'Success', openCodeNextToolDisplay(data));
  }
  if (type === 'session.next.tool.failed') {
    return openCodeToolUpdate(callId, cached.name, cached.description, 'Error', openCodeNextToolErrorDisplay(data));
  }
  return null;
}

function openCodeToolUpdate(
  callId: string,
  name: string,
  description: string,
  status: OpenCodeToolUpdate['status'],
  resultDisplay: string,
): OpenCodeToolUpdate {
  return {
    callId,
    call_id: callId,
    name,
    description,
    status,
    resultDisplay,
    result_display: resultDisplay,
  };
}

function createOpenCodePermissionEventExtractor(
  sessionId: string,
): (event: unknown) => { type: 'asked'; request: OpenCodePermissionRequest } | { type: 'resolved'; requestId: string } | null {
  return (event) => {
    const request = extractOpenCodePermissionAsked(event, sessionId);
    if (request) return { type: 'asked', request };
    const requestId = extractOpenCodePermissionResolved(event, sessionId);
    if (requestId) return { type: 'resolved', requestId };
    return null;
  };
}

function extractOpenCodePermissionAsked(event: unknown, sessionId: string): OpenCodePermissionRequest | null {
  if (!isRecord(event)) return null;
  const payload = isRecord(event.payload) ? event.payload : event;
  const type = typeof payload.type === 'string' ? payload.type : '';
  const data = isRecord(payload.data) ? payload.data : isRecord(payload.properties) ? payload.properties : {};
  if (type !== 'permission.v2.asked' && type !== 'permission.asked') return null;
  return data.sessionID === sessionId && typeof data.id === 'string' ? (data as OpenCodePermissionRequest) : null;
}

function extractOpenCodePermissionResolved(event: unknown, sessionId: string): string {
  if (!isRecord(event)) return '';
  const payload = isRecord(event.payload) ? event.payload : event;
  const type = typeof payload.type === 'string' ? payload.type : '';
  const data = isRecord(payload.data) ? payload.data : isRecord(payload.properties) ? payload.properties : {};
  if (type !== 'permission.v2.replied' && type !== 'permission.replied') return '';
  if (data.sessionID !== sessionId) return '';
  return typeof data.requestID === 'string' ? data.requestID : typeof data.id === 'string' ? data.id : '';
}

function createOpenCodeQuestionEventExtractor(
  sessionId: string,
): (event: unknown) => { type: 'asked'; request: OpenCodeQuestionRequest } | { type: 'resolved'; requestId: string } | null {
  return (event) => {
    const request = extractOpenCodeQuestionAsked(event, sessionId);
    if (request) return { type: 'asked', request };
    const requestId = extractOpenCodeQuestionResolved(event, sessionId);
    if (requestId) return { type: 'resolved', requestId };
    return null;
  };
}

function extractOpenCodeQuestionAsked(event: unknown, sessionId: string): OpenCodeQuestionRequest | null {
  if (!isRecord(event)) return null;
  const payload = isRecord(event.payload) ? event.payload : event;
  const type = typeof payload.type === 'string' ? payload.type : '';
  const data = isRecord(payload.data) ? payload.data : isRecord(payload.properties) ? payload.properties : {};
  if (type !== 'question.v2.asked' && type !== 'question.asked') return null;
  return data.sessionID === sessionId && typeof data.id === 'string' ? (data as OpenCodeQuestionRequest) : null;
}

function extractOpenCodeQuestionResolved(event: unknown, sessionId: string): string {
  if (!isRecord(event)) return '';
  const payload = isRecord(event.payload) ? event.payload : event;
  const type = typeof payload.type === 'string' ? payload.type : '';
  const data = isRecord(payload.data) ? payload.data : isRecord(payload.properties) ? payload.properties : {};
  if (
    type !== 'question.v2.replied' &&
    type !== 'question.replied' &&
    type !== 'question.v2.rejected' &&
    type !== 'question.rejected'
  ) {
    return '';
  }
  if (data.sessionID !== sessionId) return '';
  return typeof data.requestID === 'string' ? data.requestID : typeof data.id === 'string' ? data.id : '';
}

function openCodeToolTitle(part: Record<string, unknown>, state: Record<string, unknown>): string {
  if (typeof state.title === 'string' && state.title) return state.title;
  if (isRecord(state.input)) {
    const values = Object.values(state.input)
      .filter((value) => typeof value === 'string' && value.trim())
      .slice(0, 2);
    if (values.length) return values.join(' ');
  }
  return typeof part.tool === 'string' && part.tool ? part.tool : 'tool';
}

function openCodeToolStatus(status: unknown): OpenCodeToolUpdate['status'] {
  if (status === 'completed') return 'Success';
  if (status === 'error') return 'Error';
  if (status === 'canceled' || status === 'cancelled') return 'Canceled';
  if (status === 'pending') return 'Pending';
  if (status === 'confirming') return 'Confirming';
  return 'Executing';
}

function openCodeToolResultDisplay(state: Record<string, unknown>): string {
  if (typeof state.output === 'string' && state.output) return state.output;
  if (typeof state.error === 'string' && state.error) return state.error;
  if (Array.isArray(state.content) && state.content.length) return JSON.stringify(state.content);
  return '';
}

function openCodeNextToolDisplay(data: Record<string, unknown>): string {
  if (Array.isArray(data.content)) {
    const content = data.content.map(openCodeToolContentDisplay).filter(Boolean).join('\n');
    if (content) return content;
  }
  if (typeof data.result === 'string' && data.result) return data.result;
  if (data.result !== undefined) return jsonDisplay(data.result);
  if (isRecord(data.structured) && Object.keys(data.structured).length) return jsonDisplay(data.structured);
  if (Array.isArray(data.outputPaths) && data.outputPaths.length) {
    return data.outputPaths.filter((item): item is string => typeof item === 'string' && item.length > 0).join('\n');
  }
  return '';
}

function openCodeToolContentDisplay(item: unknown): string {
  if (typeof item === 'string') return item;
  if (!isRecord(item)) return '';
  if (typeof item.text === 'string') return item.text;
  if (typeof item.content === 'string') return item.content;
  if (typeof item.data === 'string') return item.data;
  if (typeof item.name === 'string') return item.name;
  return '';
}

function openCodeNextToolErrorDisplay(data: Record<string, unknown>): string {
  const error = data.error;
  if (typeof error === 'string') return error;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  if (error !== undefined) return jsonDisplay(error);
  if (data.result !== undefined) return jsonDisplay(data.result);
  return '';
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

function parseOpenCodeModelRef(model: string | undefined): { providerID: string; id: string } | null {
  if (typeof model !== 'string' || !model.includes('/')) return null;
  const index = model.indexOf('/');
  const providerID = model.slice(0, index).trim();
  const id = model.slice(index + 1).trim();
  return providerID && id ? { providerID, id } : null;
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

export function extractOpenCodeModels(value: unknown): OpenCodeModelInfo[] {
  const rawModels = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.data) ? value.data : [];

  return rawModels
    .filter(isRecord)
    .map((model) => {
      if (model.enabled === false) return null;
      const id = stringValue(model.id);
      const providerId = stringValue(model.providerID) ?? stringValue(model.providerId) ?? stringValue(model.provider);
      if (!id || !providerId) return null;

      const name = stringValue(model.name) ?? id;
      return {
        id: `${providerId}/${id}`,
        label: `${name} (${providerId})`,
      };
    })
    .filter((model): model is OpenCodeModelInfo => model !== null);
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

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function jsonDisplay(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
