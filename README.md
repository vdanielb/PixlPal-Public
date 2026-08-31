# PixlPal

Lovable for photo editing. AI never generates the photo — it helps you apply filters and pixel transformations to get the feel you want.

Every edit — whether it comes from a slider or an AI prompt — is a **declarative pipeline of pixel operations** executed by a single Rust engine. The AI's only job is to operate the controls; pixels are always processed deterministically, on-device.

```text
                  React + Vite web app
                           │
                      WebAssembly
                     (wasm-bindgen)
                           │
                  Rust engine (engine/core)
                  process(image, pipeline)
```

## Repository layout

| Path | What it is |
| --- | --- |
| `engine/core` | Platform-agnostic Rust engine: pipeline parser + 13 pixel operations |
| `engine/wasm` | `wasm-bindgen` wrapper for the web |
| `shared/` | Pipeline JSON Schema, TypeScript types, operation metadata |
| `ai/` | The editing agent: tool schemas, the validating tool executor, the agent loop |
| `web/` | React + Vite editor (WASM engine in a Web Worker) |

## The pipeline format

The contract between the editor and the engine (see [`shared/pipeline.schema.json`](shared/pipeline.schema.json)):

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

Operations: `exposure`, `contrast`, `tone_curve`, `lift_blacks`, `saturation`, `color_balance`, `color_shift`, `grain`, `film_softness`, `vignette`, `bloom`, `halation`, `lens_blur`. All parameters are normalized (0..1, or -1..1 for bipolar), spatial parameters scale with image size so previews match exports, and grain is deterministic (seeded hash noise).

## Getting started

Prerequisites: Rust (stable), `wasm-pack`, Node 22+, pnpm.

```bash
pnpm install
pnpm test               # cargo tests for the engine + vitest for the agent
pnpm build:wasm         # compile the engine to WASM (required once before web dev)
pnpm fetch:florence2    # download on-device Florence-2 weights into web/public/models (gitignored)
pnpm dev:web            # start the web editor
```

### Web

The web app ([`web/`](web/)) is a fully client-side React + Vite SPA. Files are decoded to pixels on a canvas and processed by the WASM engine inside a Web Worker (slider drags never block the UI). The editor is a three-column layout — adjustments on the left, the photo in the middle, the AI assistant on the right — and the pipeline JSON panel shows the live declarative pipeline for the current edit. Undo and redo cover every version of the edit, whoever produced it.

Local segmentation uses a swappable `Segmenter` interface ([`web/src/lib/segmentation/`](web/src/lib/segmentation/)). The default implementation is Florence-2-base-ft (Transformers.js, WebGPU when available) running in a dedicated worker; the LLM agent only sees a `segment(prompt)` tool and never imports the model. Masks are plain bitmaps handed to the Rust engine for masked ops (pipeline v2). Weights are preferred from `web/public/models` after `pnpm fetch:florence2`; when that tree is missing (as on Cloudflare deploys — ONNX files exceed the Workers per-file size limit) the worker downloads them from Hugging Face on first use and caches them in the browser. Segmentation still runs fully on-device.

### The AI assistant

The assistant does not generate pixels and does not write pipelines behind the editor's back. It operates the same controls the user can drag, through tools defined in [`ai/`](ai/): `set_operations`, `remove_operations`, `reset_edits`, `get_image_stats`, `segment`, and `invert_mask`. Every change appears on the sliders as it happens, ends up in the undo stack, and shows up in the pipeline JSON panel. For local edits ("make the dress pop"), it calls `segment` with a referring expression; the host runs the Segmenter and returns a `maskId` that later ops can attach via `mask`. For "everything except" edits ("blur the background", de-emphasize surroundings), it calls `invert_mask` on that id to create a selectable complement mask.

The tool schemas and the system prompt are generated from [`shared/src/operations.ts`](shared/src/operations.ts), so adding an operation teaches the agent about it for free. Arguments are validated and clamped before they reach the editor: an unknown operation or an out-of-range value comes back to the model as a tool error, which it then corrects. An invalid pipeline never reaches the engine.

When a photo is opened, the assistant panel also asks the same model for a few **suggested edits tailored to that photo** (one tool-free completion with the preview attached). Hosted mode serves this from a quota-free, rate-limited `/api/agent/suggest` route, so it never consumes one of the anonymous chat slots; if the request fails, generic fallback chips are shown. The chips only appear before the first prompt of a chat.

Every user message includes a JPEG preview of how the photo currently looks (active edit applied), so the model can see the frame. Older turns keep text only. The agent can also call `get_image_stats` for precise on-device measurements (brightness, black and white points, clipping, saturation, color cast) from [`web/src/lib/imageStats.ts`](web/src/lib/imageStats.ts). Pixel processing and segmentation stay on-device; the preview is sent only to the model endpoint you configured.

**Configuring a model.** By default the web app talks to a thin Cloudflare Worker at `/api/agent` that holds the product API key and caps each anonymous browser to **3 chats** (tracked with an HttpOnly cookie + Workers KV — no account required). Hosted user messages are also capped at **1000 characters**, and each model completion is capped at **4096 generated tokens** (including reasoning tokens on GPT-5.6), so a single prompt cannot dump a novel into the product key. Continuing an existing chat does not consume another slot; **New chat** does. Clearing cookies or switching browsers resets the counter — that is the trade-off of no login.

Optional BYOK still lives under *Use your own API key* at the bottom of the assistant panel: set an endpoint, model, and key to talk straight to OpenAI / OpenRouter / Groq / a local Ollama or LM Studio server instead of the hosted path. GPT-5.6+ models (including `gpt-5.6-luna`) use OpenAI's `/responses` API; other OpenAI-compatible endpoints keep `/chat/completions`.

To work on the assistant without a product key, run the mock endpoint and fill in Model settings with `http://localhost:3939/v1` (use model `gpt-5.6-luna` to exercise `/responses`, or any other name for `/chat/completions`):

```bash
pnpm mock:llm
```

It speaks both wire protocols and returns keyword-matched tool calls, so everything below the network boundary behaves exactly as it does against a real model.

## Design principles
Decoupled.
- **One engine** (Rust), knowing nothing about UIs, platforms, or AI.
- **One pipeline format** (versioned JSON) shared by the sliders and the AI.
- **The web app** consumes the engine through generated WASM bindings.
- **AI turns the knobs, it does not paint pixels.** The agent has no path to the image except the operations the UI already exposes.
- **The agent is transport-free.** [`ai/`](ai/) knows nothing about HTTP; a one-method `ChatModel` is the only seam. The web app defaults to a hosted Worker transport and can still use BYOK.
