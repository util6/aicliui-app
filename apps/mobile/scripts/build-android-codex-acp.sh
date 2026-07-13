#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:-}"
if [[ -z "$SOURCE_DIR" || ! -f "$SOURCE_DIR/Cargo.toml" ]]; then
  echo "usage: $0 /path/to/codex-acp" >&2
  exit 2
fi
if [[ -z "${ANDROID_NDK_ROOT:-}" || ! -d "$ANDROID_NDK_ROOT" ]]; then
  echo "ANDROID_NDK_ROOT must point to an installed Android NDK" >&2
  exit 2
fi

TARGET="aarch64-linux-android"
ANDROID_API="${AICLIUI_ANDROID_API:-24}"
case "$(uname -s)" in
  Linux) TOOLCHAIN_HOST="linux-x86_64" ;;
  Darwin) TOOLCHAIN_HOST="darwin-x86_64" ;;
  *) echo "Unsupported NDK host: $(uname -s)" >&2; exit 1 ;;
esac
TOOLCHAIN="$ANDROID_NDK_ROOT/toolchains/llvm/prebuilt/$TOOLCHAIN_HOST"
CLANG="$TOOLCHAIN/bin/aarch64-linux-android${ANDROID_API}-clang"

rustup target add "$TARGET"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$CLANG"
export CC_aarch64_linux_android="$CLANG"
export CXX_aarch64_linux_android="$TOOLCHAIN/bin/aarch64-linux-android${ANDROID_API}-clang++"
export AR_aarch64_linux_android="$TOOLCHAIN/bin/llvm-ar"

PATCH="$(cd "$(dirname "$0")/.." && pwd)/patches/codex-acp-android-openssl.patch"
if git -C "$SOURCE_DIR" apply --reverse --check "$PATCH" >/dev/null 2>&1; then
  echo "Codex ACP vendored OpenSSL patch is already applied"
else
  git -C "$SOURCE_DIR" apply --check "$PATCH"
  git -C "$SOURCE_DIR" apply "$PATCH"
fi
export OPENSSL_STATIC=1

cargo build \
  --manifest-path "$SOURCE_DIR/Cargo.toml" \
  --target "$TARGET" \
  --release \
  --locked

BINARY="$SOURCE_DIR/target/$TARGET/release/codex-acp"
DESTINATION="$(cd "$(dirname "$0")/.." && pwd)/modules/aicliui-runtime/android/src/main/jniLibs/arm64-v8a/libcodex_acp.so"
READELF="$TOOLCHAIN/bin/llvm-readelf"
if [[ ! -f "$BINARY" ]]; then
  echo "Expected Android Codex ACP binary was not produced: $BINARY" >&2
  exit 1
fi
if ! "$READELF" -h "$BINARY" | grep -q 'Machine:.*AArch64'; then
  echo "Codex ACP output is not an AArch64 ELF binary" >&2
  exit 1
fi
if ! "$READELF" -l "$BINARY" | grep -q '/system/bin/linker64'; then
  echo "Codex ACP output does not target Android Bionic" >&2
  exit 1
fi
if "$READELF" -d "$BINARY" | grep -qE 'libc\.so\.6|libgcc_s\.so|ld-linux|ld-musl'; then
  echo "Codex ACP output depends on a non-Android Linux runtime" >&2
  exit 1
fi

mkdir -p "$(dirname "$DESTINATION")"
install -m 0755 "$BINARY" "$DESTINATION"
echo "Embedded Android Codex ACP installed at $DESTINATION"
