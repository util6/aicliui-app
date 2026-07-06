const { withAndroidManifest } = require('expo/config-plugins');

const TERMUX_PACKAGE = 'com.termux';
const RUN_COMMAND_ACTION = 'com.termux.RUN_COMMAND';
const RUN_COMMAND_PERMISSION = 'com.termux.permission.RUN_COMMAND';

function withTermuxRunCommand(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    manifest['uses-permission'] = ensureAndroidNameEntry(
      manifest['uses-permission'],
      RUN_COMMAND_PERMISSION,
    );

    const queries = manifest.queries?.[0] ?? {};
    queries.package = ensureAndroidNameEntry(queries.package, TERMUX_PACKAGE);
    queries.intent = ensureIntentActionEntry(queries.intent, RUN_COMMAND_ACTION);
    manifest.queries = [queries];

    return config;
  });
}

function ensureAndroidNameEntry(entries, name) {
  const list = Array.isArray(entries) ? entries : [];
  if (list.some((entry) => entry?.$?.['android:name'] === name)) {
    return list;
  }
  return [...list, { $: { 'android:name': name } }];
}

function ensureIntentActionEntry(entries, actionName) {
  const list = Array.isArray(entries) ? entries : [];
  if (
    list.some((entry) =>
      entry?.action?.some((action) => action?.$?.['android:name'] === actionName),
    )
  ) {
    return list;
  }
  return [...list, { action: [{ $: { 'android:name': actionName } }] }];
}

module.exports = withTermuxRunCommand;
