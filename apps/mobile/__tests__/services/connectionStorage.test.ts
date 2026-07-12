jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  clearStoredConnection,
  readStoredConnection,
  writeStoredConnection,
} from '@/src/services/connectionStorage';

describe('connectionStorage on web', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses AsyncStorage because SecureStore has no web implementation', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('{"host":"127.0.0.1"}');

    await expect(readStoredConnection()).resolves.toBe('{"host":"127.0.0.1"}');
    await writeStoredConnection('{"host":"localhost"}');
    await clearStoredConnection();

    expect(AsyncStorage.getItem).toHaveBeenCalledWith('aionui_connection');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('aionui_connection', '{"host":"localhost"}');
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('aionui_connection');
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });
});
