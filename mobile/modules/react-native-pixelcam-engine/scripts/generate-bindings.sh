#!/usr/bin/env bash
# Regenerates the TypeScript + C++ JSI bindings and the turbo-module glue
# from the Rust FFI crate, using a host build of the library (no Android
# SDK / Xcode required). Run this after changing the engine's public API.
#
# Native builds for devices still happen via `pnpm ubrn:ios` / `pnpm ubrn:android`.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(cd ../../.. && pwd)"

echo "Building host library for metadata extraction..."
(cd "$REPO_ROOT" && cargo build --release -p pixelcam-engine-ffi)

LIB="$REPO_ROOT/target/release/libpixelcam_engine_ffi.so"
if [[ ! -f "$LIB" ]]; then
  LIB="$REPO_ROOT/target/release/libpixelcam_engine_ffi.dylib"
fi

echo "Generating TypeScript + C++ bindings from $LIB ..."
MODULE_DIR="$(pwd)"
(cd "$REPO_ROOT" && "$MODULE_DIR/node_modules/.bin/uniffi-bindgen-react-native" generate jsi bindings \
  --library "$LIB" \
  --ts-dir "$MODULE_DIR/src/generated" \
  --cpp-dir "$MODULE_DIR/cpp/generated")

echo "Generating turbo-module glue..."
pnpm exec uniffi-bindgen-react-native generate jsi turbo-module \
  --config ubrn.config.yaml \
  pixelcam_engine_ffi

echo "Done. Generated files in src/generated, cpp/generated, android/, ios/."
