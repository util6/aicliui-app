#!/usr/bin/env bash
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ASSET_ROOT="$MOBILE_DIR/modules/aicliui-runtime/android/src/main/assets/aicliui-runtime/agents"
MANIFEST="$MOBILE_DIR/modules/aicliui-runtime/android/src/main/assets/aicliui-runtime.json"
GEMINI_VERSION="${GEMINI_CLI_VERSION:-0.50.0}"
STAGING="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/aicliui-gemini-runtime"

rm -rf "$STAGING" "$ASSET_ROOT"
mkdir -p "$STAGING" "$ASSET_ROOT/gemini"
npm install \
  --prefix "$STAGING" \
  --ignore-scripts \
  --omit=optional \
  --package-lock=false \
  "@google/gemini-cli@$GEMINI_VERSION"
cp -R "$STAGING/node_modules" "$ASSET_ROOT/gemini/node_modules"

LAUNCHER="assets/aicliui-runtime/agents/gemini/node_modules/@google/gemini-cli/bundle/gemini.js"
if [[ ! -f "$MOBILE_DIR/modules/aicliui-runtime/android/src/main/$LAUNCHER" ]]; then
  echo "Gemini CLI launcher is missing after packaging" >&2
  exit 1
fi

node - "$MANIFEST" "$GEMINI_VERSION" "$LAUNCHER" <<'NODE'
const fs = require('node:fs');
const [path, version, launcher] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path, 'utf8'));
manifest.agents = (Array.isArray(manifest.agents) ? manifest.agents : [])
  .filter((agent) => agent?.backend !== 'gemini');
manifest.agents.push({ backend: 'gemini', version, launcher, files: [launcher] });
fs.writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

echo "Embedded Gemini CLI $GEMINI_VERSION installed at $ASSET_ROOT/gemini"
