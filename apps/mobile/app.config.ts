import { ExpoConfig, ConfigContext } from 'expo/config';

import VERSION from './versions/version.json';

export default ({ config }: ConfigContext): ExpoConfig => {
  return {
    ...config,
    name: 'AICLIUI',
    slug: 'aicliui',
    version: VERSION.version,
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'aicliui',
    userInterfaceStyle: 'automatic',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'app.aicliui.mobile',
      buildNumber: String(VERSION.buildNumber),
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/images/icon.png',
        backgroundColor: '#000000',
      },
      package: 'app.aicliui.mobile',
      versionCode: VERSION.buildNumber,
    },
    web: {
      output: 'static',
      favicon: './assets/images/icon.png',
    },
    plugins: ['./plugins/withEmbeddedRuntimePackaging', 'expo-router', 'expo-secure-store', 'expo-dev-client'],
    experiments: {
      typedRoutes: true,
    },
    extra: {},
  };
};
