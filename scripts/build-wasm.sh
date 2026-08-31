#!/usr/bin/env bash
# Builds the Rust engine to WebAssembly and drops the generated package
# into web/src/engine/ (gitignored; wasm-pack writes its own .gitignore).
set -euo pipefail

cd "$(dirname "$0")/.."

wasm-pack build engine/wasm \
  --release \
  --target web \
  --out-dir ../../web/src/engine \
  --out-name pixelcam_engine

echo "WASM engine built -> web/src/engine/"
