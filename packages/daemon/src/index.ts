import { WebSocketServer } from 'ws';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createDefaultRouter } from './default-router.js';
import { JsonConversationStore } from './conversation-store.js';
import type { BridgeMessage } from '@aicliui/shared';

const port = Number.parseInt(process.env.AICLIUI_DAEMON_PORT ?? '43117', 10);
const token = process.env.AICLIUI_DAEMON_TOKEN;
const dataRoot = process.env.AICLIUI_HOME ?? join(homedir(), '.aicliui');
const storePath = process.env.AICLIUI_STORE_PATH ?? join(dataRoot, 'daemon', 'store.json');
const router = createDefaultRouter({ store: new JsonConversationStore(storePath) });

const server = new WebSocketServer({
  host: '127.0.0.1',
  port,
});

server.on('connection', (socket, request) => {
  if (token && !isAuthorized(request.headers['sec-websocket-protocol'], token)) {
    socket.close(1008, 'auth_failed');
    return;
  }

  socket.on('message', (raw) => {
    void (async () => {
      const incoming = parseMessage(raw.toString());
      if (!incoming) {
        return;
      }

      if (incoming.name === 'pong') {
        return;
      }

      const responses = await router.handleIncoming(incoming, {
        emit(response) {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify(response));
          }
        },
      });
      for (const response of responses) {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(response));
        }
      }
    })();
  });

  const heartbeat = setInterval(() => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ name: 'ping', data: { timestamp: Date.now() } }));
    }
  }, 15_000);

  socket.on('close', () => clearInterval(heartbeat));
});

server.on('listening', () => {
  const address = server.address();
  const resolvedPort = typeof address === 'object' && address ? address.port : port;
  console.log(`aicliui daemon listening on ws://127.0.0.1:${resolvedPort}`);
});

function parseMessage(raw: string): BridgeMessage | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string') {
      return value as BridgeMessage;
    }
  } catch {
    return null;
  }
  return null;
}

function isAuthorized(protocolHeader: string | string[] | undefined, expected: string): boolean {
  if (Array.isArray(protocolHeader)) {
    return protocolHeader.includes(expected);
  }
  return protocolHeader === expected;
}
