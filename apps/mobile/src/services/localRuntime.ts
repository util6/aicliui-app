import * as SecureStore from 'expo-secure-store';
import { uuid } from '../utils/uuid';

const LOCAL_RUNTIME_TOKEN_KEY = 'aicliui_local_daemon_token';

export type LocalDaemonConfig = {
  host: string;
  port: string;
  token: string;
};

export const LOCAL_DAEMON_HOST = '127.0.0.1';
export const LOCAL_DAEMON_PORT = '43117';

export async function getOrCreateLocalDaemonConfig(): Promise<LocalDaemonConfig> {
  let token = await SecureStore.getItemAsync(LOCAL_RUNTIME_TOKEN_KEY);
  if (!token) {
    token = uuid();
    await SecureStore.setItemAsync(LOCAL_RUNTIME_TOKEN_KEY, token);
  }

  return {
    host: LOCAL_DAEMON_HOST,
    port: LOCAL_DAEMON_PORT,
    token,
  };
}
