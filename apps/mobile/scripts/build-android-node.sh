#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:-}"
if [[ -z "$SOURCE_DIR" || ! -x "$SOURCE_DIR/android-configure" ]]; then
  echo "usage: $0 /path/to/node" >&2
  exit 2
fi

if [[ -z "${ANDROID_NDK_ROOT:-}" || ! -d "$ANDROID_NDK_ROOT" ]]; then
  echo "ANDROID_NDK_ROOT must point to an installed Android NDK" >&2
  exit 2
fi

ANDROID_API="${AICLIUI_ANDROID_API:-24}"
JOBS="${AICLIUI_NODE_BUILD_JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.logicalcpu)}"
MOBILE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DESTINATION="$MOBILE_DIR/modules/aicliui-runtime/android/src/main/jniLibs/arm64-v8a/libnode.so"
ASSET_ROOT="$MOBILE_DIR/modules/aicliui-runtime/android/src/main/assets/aicliui-runtime/node"
MANIFEST="$MOBILE_DIR/modules/aicliui-runtime/android/src/main/assets/aicliui-runtime.json"

pushd "$SOURCE_DIR" >/dev/null
./android-configure "$ANDROID_NDK_ROOT" "$ANDROID_API" arm64
make -j"$JOBS" node
popd >/dev/null

BINARY="$SOURCE_DIR/out/Release/node"
if [[ ! -f "$BINARY" ]]; then
  echo "Expected Android Node binary was not produced: $BINARY" >&2
  exit 1
fi

case "$(uname -s)" in
  Linux) TOOLCHAIN_HOST="linux-x86_64" ;;
  Darwin) TOOLCHAIN_HOST="darwin-x86_64" ;;
  *) echo "Unsupported NDK host: $(uname -s)" >&2; exit 1 ;;
esac
READELF="$ANDROID_NDK_ROOT/toolchains/llvm/prebuilt/$TOOLCHAIN_HOST/bin/llvm-readelf"
if ! "$READELF" -h "$BINARY" | grep -q 'Machine:.*AArch64'; then
  echo "Node output is not an AArch64 ELF binary" >&2
  exit 1
fi
if ! "$READELF" -l "$BINARY" | grep -q '/system/bin/linker64'; then
  echo "Node output does not target the Android Bionic linker" >&2
  exit 1
fi
if "$READELF" -d "$BINARY" | grep -qE 'libc\.so\.6|libgcc_s\.so|ld-linux|ld-musl'; then
  echo "Node output still depends on a non-Android Linux runtime" >&2
  exit 1
fi

mkdir -p "$(dirname "$DESTINATION")"
install -m 0755 "$BINARY" "$DESTINATION"
rm -rf "$ASSET_ROOT"
mkdir -p "$ASSET_ROOT/lib/node_modules"
cp -R "$SOURCE_DIR/deps/npm" "$ASSET_ROOT/lib/node_modules/npm"
if command -v sha256sum >/dev/null 2>&1; then
  NODE_SHA256="$(sha256sum "$DESTINATION" | awk '{print $1}')"
else
  NODE_SHA256="$(shasum -a 256 "$DESTINATION" | awk '{print $1}')"
fi
node - "$MANIFEST" "${NODE_VERSION:-unknown}" "$NODE_SHA256" <<'NODE'
const fs = require('node:fs');
const [path, version, sha256] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path, 'utf8'));
manifest.node = {
  version,
  target: 'aarch64-linux-android',
  sha256,
  executable: 'lib/arm64-v8a/libnode.so',
  npmCli: 'assets/aicliui-runtime/node/lib/node_modules/npm/bin/npm-cli.js',
  npxCli: 'assets/aicliui-runtime/node/lib/node_modules/npm/bin/npx-cli.js',
};
fs.writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
echo "Embedded Android Node installed at $DESTINATION"
echo "Embedded npm runtime installed at $ASSET_ROOT"
