import type { ApiTransport } from './api';

export type LocalDaemonConfig = {
  host: string;
  port: string;
  token: string;
  transport: ApiTransport;
};

export const LOCAL_DAEMON_HOST = '127.0.0.1';
export const LOCAL_DAEMON_PORT = '43117';

export async function getOrCreateLocalDaemonConfig(): Promise<LocalDaemonConfig> {
  return {
    host: LOCAL_DAEMON_HOST,
    port: LOCAL_DAEMON_PORT,
    token: '',
    transport: 'aioncore',
  };
}
