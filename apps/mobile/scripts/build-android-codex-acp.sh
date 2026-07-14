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
if [[ ! -x "$CLANG" ]]; then
  echo "Android NDK compiler was not found: $CLANG" >&2
  exit 1
fi
CLANG_RESOURCE_DIR="$("$CLANG" --print-resource-dir)"
NDK_CLANG_VERSION="$(basename "$CLANG_RESOURCE_DIR")"
CLANG_BUILTINS_ARCHIVE="$CLANG_RESOURCE_DIR/lib/linux/libclang_rt.builtins-aarch64-android.a"
if [[ -z "$NDK_CLANG_VERSION" || ! -f "$CLANG_BUILTINS_ARCHIVE" ]]; then
  echo "Android NDK Clang builtins archive was not found: $CLANG_BUILTINS_ARCHIVE" >&2
  exit 1
fi
for required_ndk_header in stdlib.h stdio.h; do
  if [[ ! -f "$TOOLCHAIN/sysroot/usr/include/$required_ndk_header" ]]; then
    echo "Android NDK sysroot header is missing: $required_ndk_header" >&2
    exit 1
  fi
done
NDK_PROPERTIES="$ANDROID_NDK_ROOT/source.properties"
if [[ ! -f "$NDK_PROPERTIES" ]]; then
  echo "Android NDK properties were not found: $NDK_PROPERTIES" >&2
  exit 1
fi
NDK_REVISION="$(awk -F= '/^Pkg.Revision/ { gsub(/[[:space:]]/, "", $2); print $2 }' "$NDK_PROPERTIES")"
if [[ -z "$NDK_REVISION" ]]; then
  echo "Android NDK revision was not found in $NDK_PROPERTIES" >&2
  exit 1
fi
NDK_MAJOR="${NDK_REVISION%%.*}"

rustup target add "$TARGET"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$CLANG"
export CC_aarch64_linux_android="$CLANG"
export CXX_aarch64_linux_android="$TOOLCHAIN/bin/aarch64-linux-android${ANDROID_API}-clang++"
export AR_aarch64_linux_android="$TOOLCHAIN/bin/llvm-ar"
export RANLIB="$TOOLCHAIN/bin/llvm-ranlib"
export RANLIB_aarch64_linux_android="$RANLIB"
TOOL_SHIMS="$(mktemp -d)"
trap 'rm -rf "$TOOL_SHIMS"' EXIT
ln -s "$RANLIB" "$TOOL_SHIMS/aarch64-linux-android-ranlib"
export PATH="$TOOL_SHIMS:$TOOLCHAIN/bin:$PATH"

PATCH="$(cd "$(dirname "$0")/.." && pwd)/patches/codex-acp-android-openssl.patch"
if git -C "$SOURCE_DIR" apply --reverse --check "$PATCH" >/dev/null 2>&1; then
  echo "Codex ACP vendored OpenSSL patch is already applied"
else
  git -C "$SOURCE_DIR" apply --check "$PATCH"
  git -C "$SOURCE_DIR" apply "$PATCH"
fi
export OPENSSL_STATIC=1
export V8_FROM_SOURCE=1
export CLANG_BASE_PATH="$TOOLCHAIN"
export EXTRA_GN_ARGS="android_ndk_root=\"$ANDROID_NDK_ROOT\" android_ndk_version=\"r$NDK_MAJOR\" android_ndk_api_level=$ANDROID_API clang_version=\"$NDK_CLANG_VERSION\""
export PRINT_GN_ARGS=1

cargo fetch \
  --manifest-path "$SOURCE_DIR/Cargo.toml" \
  --target "$TARGET" \
  --locked

V8_SOURCE="$(find "${CARGO_HOME:-$HOME/.cargo}/registry/src" -maxdepth 2 -type d -name 'v8-147.4.0' | head -1)"
if [[ -z "$V8_SOURCE" ]]; then
  echo "rusty_v8 source was not downloaded by cargo fetch" >&2
  exit 1
fi

V8_RUST_VENDOR="$V8_SOURCE/third_party/rust/chromium_crates_io/vendor"
V8_RUST_VENDOR_SENTINEL="$V8_RUST_VENDOR/icu_calendar_data-v2/build.rs"
if [[ ! -f "$V8_RUST_VENDOR_SENTINEL" || \
      ! -f "$V8_RUST_VENDOR/icu_calendar_data-v2/src/lib.rs" || \
      ! -f "$V8_RUST_VENDOR/serde-v1/src/lib.rs" ]]; then
  # rusty_v8 147.4.0 packages the Chromium Rust GN files without their
  # corresponding vendored crate sources. Restore the exact submodule commit.
  V8_RUST_REVISION="ba6ceef355cf48cc50493296d4fc862d9745b742"
  V8_RUST_CHECKOUT="$TOOL_SHIMS/chromium-rust"
  mkdir -p "$V8_RUST_CHECKOUT"
  git -C "$V8_RUST_CHECKOUT" init -q
  git -C "$V8_RUST_CHECKOUT" remote add origin \
    https://chromium.googlesource.com/chromium/src/third_party/rust
  git -C "$V8_RUST_CHECKOUT" sparse-checkout init --cone
  git -C "$V8_RUST_CHECKOUT" sparse-checkout set chromium_crates_io/vendor
  git -C "$V8_RUST_CHECKOUT" fetch -q \
    --depth=1 \
    --filter=blob:none \
    origin \
    "$V8_RUST_REVISION"
  git -C "$V8_RUST_CHECKOUT" checkout -q --detach FETCH_HEAD
  if [[ "$(git -C "$V8_RUST_CHECKOUT" rev-parse HEAD)" != "$V8_RUST_REVISION" ]]; then
    echo "Chromium Rust vendor checkout did not match $V8_RUST_REVISION" >&2
    exit 1
  fi
  rm -rf "$V8_RUST_VENDOR"
  mkdir -p "$(dirname "$V8_RUST_VENDOR")"
  mv "$V8_RUST_CHECKOUT/chromium_crates_io/vendor" "$V8_RUST_VENDOR"
fi
for required_vendor_file in \
  icu_calendar_data-v2/build.rs \
  icu_calendar_data-v2/src/lib.rs \
  serde-v1/src/lib.rs
do
  if [[ ! -f "$V8_RUST_VENDOR/$required_vendor_file" ]]; then
    echo "rusty_v8 Chromium Rust vendor file is missing: $required_vendor_file" >&2
    exit 1
  fi
done

for pydeps in \
  build/android/pylib/results/presentation/test_results_presentation.pydeps \
  build/android/devil_chromium.pydeps \
  build/android/apk_operations.pydeps \
  build/android/test_runner.pydeps \
  build/android/test_wrapper/logdog_wrapper.pydeps \
  build/android/resource_sizes.pydeps
do
  install -D -m 0644 /dev/null "$V8_SOURCE/$pydeps"
done

if [[ "$TOOLCHAIN_HOST" == "linux-x86_64" ]]; then
  V8_SYSROOT_INSTALLER="$V8_SOURCE/build/linux/sysroot_scripts/install-sysroot.py"
  V8_HOST_SYSROOT="$V8_SOURCE/build/linux/debian_bullseye_amd64-sysroot"
  if [[ ! -f "$V8_SYSROOT_INSTALLER" ]]; then
    echo "rusty_v8 host sysroot installer was not found: $V8_SYSROOT_INSTALLER" >&2
    exit 1
  fi
  python3 "$V8_SYSROOT_INSTALLER" --arch=amd64
  if [[ ! -d "$V8_HOST_SYSROOT" ]]; then
    echo "rusty_v8 host sysroot was not installed: $V8_HOST_SYSROOT" >&2
    exit 1
  fi
fi

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
