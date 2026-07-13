#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:-}"
if [[ -z "$SOURCE_DIR" || ! -f "$SOURCE_DIR/Cargo.toml" ]]; then
  echo "usage: $0 /path/to/AionCore" >&2
  exit 2
fi

if [[ -z "${ANDROID_NDK_ROOT:-}" || ! -d "$ANDROID_NDK_ROOT" ]]; then
  echo "ANDROID_NDK_ROOT must point to an installed Android NDK" >&2
  exit 2
fi

TARGET="aarch64-linux-android"
ANDROID_API="${AICLIUI_ANDROID_API:-24}"
RUNTIME_VERSION="${AIONCORE_VERSION:-unknown}"
case "$(uname -s)" in
  Linux) TOOLCHAIN_HOST="linux-x86_64" ;;
  Darwin) TOOLCHAIN_HOST="darwin-x86_64" ;;
  *) echo "Unsupported NDK host: $(uname -s)" >&2; exit 1 ;;
esac
TOOLCHAIN="$ANDROID_NDK_ROOT/toolchains/llvm/prebuilt/$TOOLCHAIN_HOST"
CLANG="$TOOLCHAIN/bin/aarch64-linux-android${ANDROID_API}-clang"
AR="$TOOLCHAIN/bin/llvm-ar"

if [[ ! -x "$CLANG" || ! -x "$AR" ]]; then
  echo "Android NDK arm64 toolchain is incomplete: $TOOLCHAIN" >&2
  exit 1
fi

rustup target add "$TARGET"

export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$CLANG"
export CC_aarch64_linux_android="$CLANG"
export CXX_aarch64_linux_android="$TOOLCHAIN/bin/aarch64-linux-android${ANDROID_API}-clang++"
export AR_aarch64_linux_android="$AR"

cargo build \
  --manifest-path "$SOURCE_DIR/Cargo.toml" \
  --target "$TARGET" \
  --release \
  --locked

TARGET_DIR="$(cargo metadata --manifest-path "$SOURCE_DIR/Cargo.toml" --format-version 1 --no-deps | node -e '
let input = "";
process.stdin.on("data", (chunk) => input += chunk);
process.stdin.on("end", () => process.stdout.write(JSON.parse(input).target_directory));
')"

BINARY_NAME="${AIONCORE_BINARY_NAME:-aioncore}"
BINARY="$TARGET_DIR/$TARGET/release/$BINARY_NAME"
if [[ ! -f "$BINARY" ]]; then
  echo "Expected AionCore binary was not produced: $BINARY" >&2
  find "$TARGET_DIR/$TARGET/release" -maxdepth 1 -type f -print >&2 || true
  exit 1
fi

READELF="$TOOLCHAIN/bin/llvm-readelf"
if ! "$READELF" -h "$BINARY" | grep -q 'Machine:.*AArch64'; then
  echo "AionCore output is not an AArch64 ELF binary" >&2
  exit 1
fi
if ! "$READELF" -h "$BINARY" | grep -q 'Type:.*DYN'; then
  echo "AionCore output must be a position-independent Android executable" >&2
  exit 1
fi
if ! "$READELF" -l "$BINARY" | grep -q '/system/bin/linker64'; then
  echo "AionCore output does not target the Android Bionic linker" >&2
  "$READELF" -l "$BINARY" >&2
  exit 1
fi
if "$READELF" -d "$BINARY" | grep -qE 'libc\.so\.6|libgcc_s\.so|ld-linux|ld-musl'; then
  echo "AionCore output still depends on a non-Android Linux runtime" >&2
  "$READELF" -d "$BINARY" >&2
  exit 1
fi

DESTINATION="$(cd "$(dirname "$0")/.." && pwd)/modules/aicliui-runtime/android/src/main/jniLibs/arm64-v8a/libaioncore.so"
MANIFEST="$(cd "$(dirname "$0")/.." && pwd)/modules/aicliui-runtime/android/src/main/assets/aicliui-runtime.json"
mkdir -p "$(dirname "$DESTINATION")" "$(dirname "$MANIFEST")"
install -m 0755 "$BINARY" "$DESTINATION"
BINARY_SHA256="$(sha256sum "$DESTINATION" | awk '{print $1}')"
node - "$MANIFEST" "$RUNTIME_VERSION" "$TARGET" "$ANDROID_API" "$BINARY_SHA256" <<'NODE'
const fs = require('node:fs');
const [path, version, target, androidApi, sha256] = process.argv.slice(2);
fs.writeFileSync(path, `${JSON.stringify({
  version,
  target,
  androidApi: Number(androidApi),
  sha256,
  agents: [],
}, null, 2)}\n`);
NODE
echo "Embedded Android runtime installed at $DESTINATION"
echo "Embedded runtime manifest installed at $MANIFEST"
