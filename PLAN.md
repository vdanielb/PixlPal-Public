# PixlPal — Implementation Plan

Lovable for photo editing. AI never generates the photo — it orchestrates tools that edit it.

```text
                 User (natural language or sliders)
                              │
                    AI agent orchestrator
                    │                   │
            Segmentation model      Pipeline JSON
            (masks: "the dress")        │
                    └────────┬──────────┘
                             │
                       Rust engine
                             │
                      Edited pixels
```

## Guiding principles

- One image-processing engine (Rust). It only transforms pixels — it knows nothing about UIs, platforms, AI, or ML models.
- One pipeline format (versioned JSON) produced by sliders, presets, and AI alike.
- One frontend (web) consuming the same engine API. (Desktop and mobile are out of scope for this public snapshot; the engine and pipeline format already support adding them later.)
- AI generates pipelines — never pixels. Segmentation models generate masks — never edits.
- Every filter is modular and composable.

---

## Phase 1 — Core engine ✅ DONE

Rust crate at [`engine/core`](engine/core): decodes JPEG/PNG/WebP into an RGBA f32 buffer, applies a pipeline, returns processed pixels. Public API:

```rust
process(image_bytes, pipeline_json) -> bytes      // encoded round trip
process_rgba8(pixels, w, h, pipeline_json) -> pixels  // raw fast path
```

Typed errors (bad image, bad pipeline, unknown op, unsupported version). 38 unit tests.

## Phase 2 — Declarative pipeline ✅ DONE

Versioned JSON, formalized in [`shared/pipeline.schema.json`](shared/pipeline.schema.json) with TypeScript types and slider metadata in [`shared/src`](shared/src):

```json
{
  "version": 1,
  "operations": [
    { "op": "grain", "params": { "amount": 0.65, "size": 1.8 } },
    { "op": "tone_curve", "params": { "preset": "soft" } },
    { "op": "halation", "params": { "strength": 0.25 } }
  ]
}
```

Presets are just saved pipelines ([`shared/src/presets.ts`](shared/src/presets.ts)).

## Phase 3 — Operations ✅ DONE

Tonal, color, texture and optical ops in [`engine/core/src/ops`](engine/core/src/ops): exposure, contrast, shadows_highlights, tone_curve, blacks_whites, dodge_burn, saturation, color_balance, color_shift, hsl_mixer, grain, film_softness, vignette, bloom, halation, lens_blur. Deterministic seeded grain; spatial parameters are resolution-independent so previews match exports. Parametric masks (luminance/color/gradient) are engine-computed against the input image.

## Phase 4 — Mobile app — omitted from this public snapshot

The private PixelCamAI repo shipped an Expo app with a UniFFI turbo module. This public competition snapshot is web-only.

## Web ✅ DONE (pulled forward from the original plan's web phase)

React + Vite SPA at [`web/`](web). Engine compiled to WASM ([`engine/wasm`](engine/wasm)), running in a Web Worker with job coalescing. Fully client-side for editing; each assistant turn sends a downscaled JPEG preview of the current look to the configured model endpoint.

---

## Phase 5 — AI editing ✅ DONE for whole-image edits (web)

Natural language → the editor's own controls. The agent sees a JPEG preview of the current look on each user turn and edits exclusively through the same tools the UI exposes, so its output is a valid pipeline by construction.

Shipped in [`ai/`](ai): a tool-calling agent loop, tool schemas and a system prompt generated from the operation metadata, and a validating executor. Tools: `set_operations`, `remove_operations`, `apply_preset`, `reset_edits`, `get_image_stats`. Bad arguments come back to the model as tool errors and it corrects itself, so invalid pipelines are unreachable rather than caught. The web editor gained a chat panel on the right, and undo/redo over a stack of edit versions covering slider, preset and agent changes alike.

Where the model lives, and where it is going:

- **Now: hosted key on a Cloudflare Worker, with an anonymous 3-chat cap.** The browser posts each model turn to `POST /api/agent`. The Worker holds `OPENAI_API_KEY`, picks the model (`LLM_MODEL` / `LLM_BASE_URL` vars), and tracks chat ids per visitor via an HttpOnly cookie + KV (`CHAT_LIMIT`, default 3). Each hosted user message is also capped (`MAX_USER_MESSAGE_CHARS`, default 1000) and each completion is capped (`MAX_OUTPUT_TOKENS`, default 4096, including reasoning tokens). A short `AGENT_COMPLETION_TIMEOUT_MS` (default 90s) is only a hang guard. No account is required; clearing cookies or another device resets the counter. Optional BYOK remains under *Use your own API key* for local mocks and power users. The agent loop, tools, and segmentation stay in the browser — only the `ChatModel` transport moved.
- **Optional later:** accounts / paid tiers on top of the same endpoint, or shrinking CSP further once BYOK is retired.
- **Vision.** Each user turn attaches a downscaled JPEG of how the photo currently looks (edits applied). Older turns keep text only. `get_image_stats` still supplies precise on-device measurements when numbers matter more than the preview.

Still open: the evaluation fixtures (prompt → expected pipeline shape) need a real model to be meaningful; today the agent is covered by unit tests over the tool executor, the loop against a scripted model, and an invariant test asserting that hostile arguments either bounce or produce a valid edit.

## Phase 6 — Segmentation & local edits (masks)

Goal: *"Make my dress really pop out."* The AI shouldn't just edit the whole frame — it should find the dress, boost it, and quietly pull everything else back.

### Division of labor

| Component | Responsibility | Explicitly not responsible for |
| --- | --- | --- |
| Segmentation model | text/point prompt → grayscale mask bitmap | any pixel editing |
| Rust engine | apply ops modulated by a mask bitmap | knowing where masks come from |
| AI agent orchestrator | decide which masks to request and which masked ops to apply | touching pixels |

### Engine changes (`engine/core`)

- New `MaskBuf` (single-channel f32, image-sized). `process` gains an optional map of named masks: `process(image, pipeline_json, masks: {name -> MaskBuf})`.
- Every operation accepts an optional `mask` reference; the op's output is blended with its input by mask value (1 = full effect, 0 = untouched). One generic blend wrapper — individual ops stay unchanged.
- Mask utilities as engine ops on masks: feather (gaussian on the mask), invert, grow/shrink.
- Engine never runs a model: masks arrive as bitmaps from the host app.

### Pipeline schema v2

```json
{
  "version": 2,
  "masks": [
    { "id": "dress", "source": "segmentation", "prompt": "the red dress", "feather": 0.02 }
  ],
  "operations": [
    { "op": "saturation", "params": { "amount": 0.4 }, "mask": "dress" },
    { "op": "exposure",   "params": { "amount": 0.15 }, "mask": "dress" },
    { "op": "exposure",   "params": { "amount": -0.18 }, "mask": "dress", "invertMask": true },
    { "op": "lens_blur",  "params": { "radius": 0.15 }, "mask": "dress", "invertMask": true }
  ]
}
```

The `masks` declarations are resolved by the **host app** (it runs the segmentation model and hands the engine plain bitmaps keyed by id), keeping the engine model-free. Version 1 pipelines remain valid — masks are additive.

### Segmentation model: on-device first

Priority is lightweight, small models that run on the web — private by default, no upload, no inference cost. The photo continues to never leave the device.

- Runtime: ONNX Runtime Web (WASM, WebGPU where available) inside the existing web worker.
- Model candidates, smallest-first:
  - Class-specific parsing for the common cases (person, clothing, sky, background): SegFormer-B0-class models fine-tuned for clothes/human parsing or U²-Net-lite portrait matting — quantized to roughly 5–20 MB, well within web budgets. "Dress" is a clothing-parsing class, so the flagship example needs no giant open-vocabulary model.
  - Promptable segmentation for everything else: MobileSAM / EfficientSAM-class encoders (quantized, tens of MB) with point/box prompts; the orchestrator (or a tap from the user) supplies the prompt point.
  - Text prompts map to the above: the LLM turns "the dress" into either a parsing class or a coarse region hint before segmentation runs — so no on-device text-vision grounding model is required in v1.
- Segmentation always runs on the downscaled preview; the mask is upscaled and feathered by the engine, so inference stays fast even for full-res exports.
- Models load lazily (first masked edit) and cache; masks are cached per photo per prompt, so re-running a pipeline never re-runs the model.
- Optional later: a server-side open-vocabulary fallback (Grounded-SAM / SAM 2) behind the Phase 5 backend for prompts the small models can't resolve — opt-in, since it uploads the preview.

### AI agent orchestrator

Phase 5's tool-calling loop gains one more tool, `segment`, and learns to attach masks to the operations it sets:

```text
"Make my dress really pop out"
   │
   ▼
LLM plans: needs a mask → calls tool segment("the dress")
   │                          │
   │                          ▼
   │            host runs model → mask id "dress" + coverage stats
   ▼
LLM writes pipeline v2 referencing mask "dress"
(boost dress: saturation/exposure; recede rest: darken, slight blur)
   │
   ▼
client validates against schema → engine applies → preview
   │
   ▼
user: "bit less blur on the background" → loop continues with pipeline context
```

New tool: `segment(prompt) -> {maskId, coverage}`, alongside the phase 5 tools (`set_operations`, `remove_operations`, `apply_preset`, `reset_edits`, `get_image_stats`), with `set_operations` gaining optional `mask` and `invertMask` on each operation. The loop owns retries (e.g. segmentation finds nothing → fall back to a global edit and say so).

UI: masked ops render in the existing controls with a mask badge; tapping the badge shows the mask overlay. Manual mask editing (brush) is a later enhancement.

## Phase 7 — GPU acceleration

Keep the public engine API identical; swap op implementations behind a backend trait: wgpu first (covers Metal/Vulkan/DX12 and WebGPU in one API). CPU path remains as fallback and reference implementation for tests.
