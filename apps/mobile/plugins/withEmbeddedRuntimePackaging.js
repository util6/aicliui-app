const { withAndroidManifest, withGradleProperties } = require('@expo/config-plugins');

const REQUIRED_GRADLE_PROPERTIES = {
  'expo.useLegacyPackaging': 'true',
  'android.packagingOptions.doNotStrip': '**/libaioncore.so',
};

function withEmbeddedRuntimePackaging(config) {
  config = withGradleProperties(config, (gradleConfig) => {
    for (const [key, value] of Object.entries(REQUIRED_GRADLE_PROPERTIES)) {
      const existing = gradleConfig.modResults.find(
        (item) => item.type === 'property' && item.key === key,
      );
      if (existing) {
        existing.value = value;
      } else {
        gradleConfig.modResults.push({ type: 'property', key, value });
      }
    }
    return gradleConfig;
  });

  return withAndroidManifest(config, (manifestConfig) => {
    const application = manifestConfig.modResults.manifest.application?.[0];
    if (!application) throw new Error('Android application manifest node is missing');
    application.$ ??= {};
    application.$['android:extractNativeLibs'] = 'true';
    return manifestConfig;
  });
}

module.exports = withEmbeddedRuntimePackaging;
