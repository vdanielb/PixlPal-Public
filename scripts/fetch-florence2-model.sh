#!/usr/bin/env bash
# Download Florence-2-base-ft ONNX weights into web/public so the segmentation
# worker can load them from /models/florence-2-base-ft (same-origin, preferred).
# Optional for production: when these files are absent the worker falls back to
# the Hugging Face Hub (see web/src/lib/segmentation/modelSource.ts).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${ROOT}/web/public/models/florence-2-base-ft"
REPO="https://huggingface.co/onnx-community/Florence-2-base-ft"
REVISION="${FLORENCE2_REVISION:-main}"

mkdir -p "$DEST"

if command -v huggingface-cli >/dev/null 2>&1; then
  echo "Fetching Florence-2-base-ft via huggingface-cli…"
  huggingface-cli download onnx-community/Florence-2-base-ft \
    --revision "$REVISION" \
    --local-dir "$DEST" \
    --local-dir-use-symlinks False
  echo "Model ready at $DEST"
  exit 0
fi

echo "huggingface-cli not found; fetching essential files with curl…"

# Config / tokenizer / processor sidecars
FILES=(
  "config.json"
  "generation_config.json"
  "preprocessor_config.json"
  "processor_config.json"
  "tokenizer.json"
  "tokenizer_config.json"
  "special_tokens_map.json"
  "vocab.json"
  "onnx/embed_tokens_fp16.onnx"
  "onnx/vision_encoder.onnx"
  "onnx/encoder_model_q4.onnx"
  "onnx/decoder_model_merged_q4.onnx"
)

# Fallbacks if quantized names differ across releases.
ALT_FILES=(
  "onnx/embed_tokens.onnx"
  "onnx/vision_encoder_fp32.onnx"
  "onnx/encoder_model.onnx"
  "onnx/decoder_model_merged.onnx"
  "onnx/decoder_model_merged_q4f16.onnx"
)

download() {
  local rel="$1"
  local url="${REPO}/resolve/${REVISION}/${rel}"
  local out="${DEST}/${rel}"
  mkdir -p "$(dirname "$out")"
  if [[ -f "$out" ]]; then
    echo "  skip (exists): $rel"
    return 0
  fi
  echo "  get $rel"
  if ! curl -fL --retry 3 --retry-delay 2 "$url" -o "$out"; then
    rm -f "$out"
    return 1
  fi
}

failed=0
for rel in "${FILES[@]}"; do
  download "$rel" || failed=1
done

if [[ "$failed" -ne 0 ]]; then
  echo "Some preferred quantized files were missing; trying alternates…"
  for rel in "${ALT_FILES[@]}"; do
    download "$rel" || true
  done
fi

# Minimal sanity check: need a vision encoder and a decoder of some kind.
if ! ls "$DEST"/onnx/vision_encoder*.onnx >/dev/null 2>&1; then
  echo "error: vision encoder ONNX missing under $DEST/onnx" >&2
  exit 1
fi
if ! ls "$DEST"/onnx/decoder_model_merged*.onnx >/dev/null 2>&1; then
  echo "error: decoder ONNX missing under $DEST/onnx" >&2
  exit 1
fi

echo "Model files present under $DEST"
echo "Note: for a complete tree, install huggingface_hub and re-run this script."
