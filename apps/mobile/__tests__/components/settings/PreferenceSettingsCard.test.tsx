import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { PreferenceSettingsCard } from '@/src/components/settings/PreferenceSettingsCard';

const mockSetPreference = jest.fn();
const mockChangeLanguage = jest.fn();
const mockGetLanguagePreference = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('@/src/context/AppearanceContext', () => ({
  useAppearance: () => ({
    preference: 'system',
    resolvedAppearance: 'light',
    setPreference: mockSetPreference,
  }),
}));

jest.mock('@/src/i18n', () => ({
  LANGUAGE_PREFERENCES: ['system', 'en-US', 'zh-CN', 'de-DE', 'ru-RU', 'uk-UA'],
  changeLanguage: (...args: unknown[]) => mockChangeLanguage(...args),
  getLanguagePreference: (...args: unknown[]) => mockGetLanguagePreference(...args),
}));

describe('PreferenceSettingsCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetPreference.mockResolvedValue(undefined);
    mockChangeLanguage.mockResolvedValue(undefined);
    mockGetLanguagePreference.mockResolvedValue('system');
  });

  it('changes the appearance preference from its selection sheet', async () => {
    const screen = render(<PreferenceSettingsCard />);

    fireEvent.press(screen.getByTestId('appearance-setting'));
    fireEvent.press(screen.getByTestId('preference-appearance-dark'));

    await waitFor(() => expect(mockSetPreference).toHaveBeenCalledWith('dark'));
  });

  it('loads and changes the language preference from its selection sheet', async () => {
    const screen = render(<PreferenceSettingsCard />);

    await waitFor(() => expect(mockGetLanguagePreference).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId('language-setting'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('preference-language-zh-CN'));
    });

    expect(mockChangeLanguage).toHaveBeenCalledWith('zh-CN');
  });
});
