import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme, type ColorSchemeName } from 'react-native';

const APPEARANCE_KEY = 'aionui_appearance';

export type AppearancePreference = 'system' | 'light' | 'dark';
export type ResolvedAppearance = 'light' | 'dark';

type AppearanceContextValue = {
  preference: AppearancePreference;
  resolvedAppearance: ResolvedAppearance;
  setPreference: (preference: AppearancePreference) => Promise<void>;
};

const AppearanceContext = createContext<AppearanceContextValue>({
  preference: 'system',
  resolvedAppearance: 'light',
  setPreference: async () => {},
});

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<AppearancePreference>('system');

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(APPEARANCE_KEY)
      .then((stored) => {
        if (active && isAppearancePreference(stored)) {
          setPreferenceState(stored);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const setPreference = useCallback(async (nextPreference: AppearancePreference) => {
    setPreferenceState(nextPreference);
    await AsyncStorage.setItem(APPEARANCE_KEY, nextPreference).catch(() => {});
  }, []);

  const resolvedAppearance = resolveAppearance(preference, systemColorScheme);
  const value = useMemo(
    () => ({ preference, resolvedAppearance, setPreference }),
    [preference, resolvedAppearance, setPreference],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  return useContext(AppearanceContext);
}

export function resolveAppearance(
  preference: AppearancePreference,
  systemColorScheme: ColorSchemeName,
): ResolvedAppearance {
  if (preference !== 'system') return preference;
  return systemColorScheme === 'dark' ? 'dark' : 'light';
}

function isAppearancePreference(value: unknown): value is AppearancePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}
