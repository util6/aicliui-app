import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AppearanceProvider,
  resolveAppearance,
  useAppearance,
} from '@/src/context/AppearanceContext';

const mockAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

function Probe() {
  const { preference, resolvedAppearance, setPreference } = useAppearance();

  return (
    <>
      <Text testID='appearance-value'>{`${preference}:${resolvedAppearance}`}</Text>
      <Text testID='set-dark' onPress={() => setPreference('dark')}>
        set dark
      </Text>
    </>
  );
}

describe('AppearanceContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAsyncStorage.getItem.mockResolvedValue(null);
    mockAsyncStorage.setItem.mockResolvedValue(undefined);
  });

  it('resolves system and explicit appearance preferences', () => {
    expect(resolveAppearance('system', 'dark')).toBe('dark');
    expect(resolveAppearance('system', 'unspecified')).toBe('light');
    expect(resolveAppearance('light', 'dark')).toBe('light');
    expect(resolveAppearance('dark', 'light')).toBe('dark');
  });

  it('loads and persists the selected appearance', async () => {
    mockAsyncStorage.getItem.mockResolvedValueOnce('light');
    const screen = render(
      <AppearanceProvider>
        <Probe />
      </AppearanceProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('appearance-value').props.children).toBe('light:light'));
    expect(mockAsyncStorage.getItem).toHaveBeenCalledWith('aionui_appearance');

    await act(async () => {
      fireEvent.press(screen.getByTestId('set-dark'));
    });

    expect(screen.getByTestId('appearance-value').props.children).toBe('dark:dark');
    expect(mockAsyncStorage.setItem).toHaveBeenCalledWith('aionui_appearance', 'dark');
  });

  it('keeps the selected appearance when persistence is unavailable', async () => {
    mockAsyncStorage.setItem.mockRejectedValueOnce(new Error('storage unavailable'));
    const screen = render(
      <AppearanceProvider>
        <Probe />
      </AppearanceProvider>,
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('set-dark'));
    });

    expect(screen.getByTestId('appearance-value').props.children).toBe('dark:dark');
  });
});
