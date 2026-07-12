const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Block platform-specific packages that should never resolve in RN
config.resolver.blockList = [
  /@office-ai\/platform/,
];

config.resolver.extraNodeModules = {
  '@aicliui/shared': path.resolve(workspaceRoot, 'packages/shared/src'),
};

module.exports = config;
