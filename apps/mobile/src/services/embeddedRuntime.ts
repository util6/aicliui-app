import {
  getLogPathAsync,
  getStatusAsync,
  prepareAsync,
  startAsync,
  stopAsync,
  type NativeRuntimeState,
  type NativeRuntimeStatus,
} from '@aicliui/runtime';
import { LOCAL_DAEMON_PORT } from './localRuntime';

export type EmbeddedRuntimeStatus = NativeRuntimeStatus;

export type EmbeddedRuntimeNativeClient = {
  getStatusAsync(): Promise<NativeRuntimeStatus>;
  prepareAsync(): Promise<NativeRuntimeStatus>;
  startAsync(port: number): Promise<NativeRuntimeStatus>;
  stopAsync(): Promise<NativeRuntimeStatus>;
  getLogPathAsync(): Promise<string>;
};

const DEFAULT_PORT = Number(LOCAL_DAEMON_PORT);
const VALID_STATES = new Set<NativeRuntimeState>([
  'unavailable',
  'stopped',
  'preparing',
  'starting',
  'running',
  'error',
]);

export function createEmbeddedRuntimeAdapter(client: EmbeddedRuntimeNativeClient) {
  return {
    async probe(): Promise<EmbeddedRuntimeStatus> {
      try {
        return normalizeStatus(await client.getStatusAsync());
      } catch {
        return unavailableStatus();
      }
    },
    async prepare(): Promise<EmbeddedRuntimeStatus> {
      return normalizeStatus(await client.prepareAsync());
    },
    async start(): Promise<EmbeddedRuntimeStatus> {
      return normalizeStatus(await client.startAsync(DEFAULT_PORT));
    },
    async stop(): Promise<EmbeddedRuntimeStatus> {
      return normalizeStatus(await client.stopAsync());
    },
    getLogPath(): Promise<string> {
      return client.getLogPathAsync();
    },
  };
}

const embeddedRuntime = createEmbeddedRuntimeAdapter({
  getStatusAsync,
  prepareAsync,
  startAsync,
  stopAsync,
  getLogPathAsync,
});

export const probeEmbeddedRuntime = embeddedRuntime.probe;
export const prepareEmbeddedRuntime = embeddedRuntime.prepare;
export const startEmbeddedRuntime = embeddedRuntime.start;
export const stopEmbeddedRuntime = embeddedRuntime.stop;
export const getEmbeddedRuntimeLogPath = embeddedRuntime.getLogPath;

function normalizeStatus(value: NativeRuntimeStatus): EmbeddedRuntimeStatus {
  const state = VALID_STATES.has(value.state) ? value.state : 'error';
  const port = Number.isInteger(value.port) && value.port > 0 && value.port <= 65535
    ? value.port
    : DEFAULT_PORT;

  return {
    state,
    supported: value.supported === true,
    port,
    ...(Number.isInteger(value.pid) && Number(value.pid) > 0 ? { pid: Number(value.pid) } : {}),
    ...(typeof value.version === 'string' && value.version ? { version: value.version } : {}),
    ...(typeof value.detail === 'string' && value.detail ? { detail: value.detail } : {}),
  };
}

function unavailableStatus(): EmbeddedRuntimeStatus {
  return {
    state: 'unavailable',
    supported: false,
    port: DEFAULT_PORT,
    detail: 'Embedded runtime is unavailable',
  };
}
