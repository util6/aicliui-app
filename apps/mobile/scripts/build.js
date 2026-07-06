#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const platformIndex = args.indexOf('--platform');
const platform = platformIndex === -1 ? 'android' : args[platformIndex + 1];

if (platform !== 'android') {
  console.error('AICLIUI mobile build script currently supports Android only.');
  process.exit(1);
}

const profileIndex = args.indexOf('--profile');
if (profileIndex === -1 || !args[profileIndex + 1]) {
  console.error('Error: --profile is required.');
  process.exit(1);
}

const versionPath = path.join(__dirname, '..', 'versions', 'version.json');
const versionData = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
const previousBuildNumber = versionData.buildNumber;
versionData.buildNumber = previousBuildNumber + 1;
fs.writeFileSync(versionPath, `${JSON.stringify(versionData, null, 2)}\n`);

try {
  execFileSync('eas', ['build', ...args], {
    stdio: 'inherit',
    env: process.env,
  });
} catch (error) {
  versionData.buildNumber = previousBuildNumber;
  fs.writeFileSync(versionPath, `${JSON.stringify(versionData, null, 2)}\n`);
  process.exit(typeof error.status === 'number' ? error.status : 1);
}
