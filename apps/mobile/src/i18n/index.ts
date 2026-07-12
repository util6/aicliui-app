import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

import enUS from './locales/en-US.json';
import zhCN from './locales/zh-CN.json';
import ruRU from './locales/ru-RU.json';
import deDE from './locales/de-DE.json';
import ukUA from './locales/uk-UA.json';

const LANGUAGE_KEY = 'aionui_language';

export const LANGUAGE_PREFERENCES = ['system', 'en-US', 'zh-CN', 'de-DE', 'ru-RU', 'uk-UA'] as const;
export type LanguagePreference = (typeof LANGUAGE_PREFERENCES)[number];
export type SupportedLanguage = Exclude<LanguagePreference, 'system'>;

const resources = {
  'en-US': { translation: enUS },
  'zh-CN': { translation: zhCN },
  'ru-RU': { translation: ruRU },
  'de-DE': { translation: deDE },
  'uk-UA': { translation: ukUA },
};

const detectDeviceLanguage = (): SupportedLanguage => {
  const deviceLocale = Localization.getLocales()[0]?.languageTag || 'en';
  if (deviceLocale.startsWith('zh')) return 'zh-CN';
  if (deviceLocale.startsWith('ru')) return 'ru-RU';
  if (deviceLocale.startsWith('de')) return 'de-DE';
  if (deviceLocale.startsWith('uk')) return 'uk-UA';
  return 'en-US';
};

const getInitialLanguage = async (): Promise<SupportedLanguage> => {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_KEY);
    if (stored === 'system') return detectDeviceLanguage();
    if (isSupportedLanguage(stored)) return stored;
  } catch {
    // Fall through
  }
  return detectDeviceLanguage();
};

i18n.use(initReactI18next).init({
  resources,
  lng: detectDeviceLanguage(),
  fallbackLng: 'en-US',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export const initI18n = async () => {
  const lng = await getInitialLanguage();
  if (i18n.language !== lng) {
    await i18n.changeLanguage(lng);
  }

  return i18n;
};

export const changeLanguage = async (lang: LanguagePreference) => {
  try {
    await AsyncStorage.setItem(LANGUAGE_KEY, lang);
    if (lang === 'system') {
      await i18n.changeLanguage(detectDeviceLanguage());
    } else {
      await i18n.changeLanguage(lang);
    }
  } catch (e) {
    console.error('[i18n] Failed to change language:', e);
  }
};

export const getLanguagePreference = async (): Promise<LanguagePreference> => {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_KEY);
    return isLanguagePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
};

function isLanguagePreference(value: unknown): value is LanguagePreference {
  return LANGUAGE_PREFERENCES.some((preference) => preference === value);
}

function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return isLanguagePreference(value) && value !== 'system';
}

export default i18n;
