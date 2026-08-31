/// <reference lib="webworker" />
/**
 * Dedicated worker for on-device segmentation models.
 * Owns the Florence-2 session so the UI thread stays responsive.
 *
 * Florence-2 referring-expression segmentation returns polygon vertices as
 * `<loc_N>` tokens. Transformers.js does not post-process that task yet, so we
 * parse the raw stream and rasterize polygons into a mask bitmap.
 *
 * Protocol:
 *   -> { type: "ensureReady" }
 *   <- { type: "ready", modelId }
 *   -> { type: "segment", requestId, pixels, width, height, prompt }
 *   <- { type: "segmented", requestId, mask, width, height, coverage, meta }
 *   <- { type: "error", requestId?, message }
 */

import {
  Florence2ForConditionalGeneration,
  Florence2Processor,
  RawImage,
  Tensor,
  env,
} from "@huggingface/transformers";
import { extractPolygonsFromText } from "../lib/segmentation/florenceParse";
import {
  explainSegmentationLoadError,
  hubFetch,
  resolveModelSource,
} from "../lib/segmentation/modelSource";
import { configureOrtWasmPaths } from "../lib/segmentation/ortWasm";
import { maskCoverage, rasterizePolygons } from "../lib/segmentation/rasterize";

// Transformers.js defaults ORT wasmPaths to jsdelivr; CSP blocks that in prod.
configureOrtWasmPaths();

export type SegWorkerRequest =
  | { type: "ensureReady" }
  | {
      type: "segment";
      requestId: number;
      pixels: ArrayBuffer;
      width: number;
      height: number;
      prompt: string;
    };

export type SegWorkerResponse =
  | { type: "ready"; modelId: string }
  | {
      type: "segmented";
      requestId: number;
      mask: ArrayBuffer;
      width: number;
      height: number;
      coverage: number;
      meta?: Record<string, unknown>;
    }
  | { type: "error"; requestId?: number; message: string };

const MODEL_ID = "florence2-base-ft";
/** Text prompt → polygon mask. Same weights as grounding; different task token. */
const TASK = "<REFERRING_EXPRESSION_SEGMENTATION>";

env.useBrowserCache = true;
// Hub `/resolve` URLs 404 when a cross-site Referer is present; see hubFetch.
env.fetch = hubFetch;

type FlorenceModel = Awaited<ReturnType<typeof Florence2ForConditionalGeneration.from_pretrained>>;
/** Runtime instance is Florence2Processor; from_pretrained is typed as base Processor. */
type FlorenceProcessorInstance = InstanceType<typeof Florence2Processor>;

let model: FlorenceModel | null = null;
let processor: FlorenceProcessorInstance | null = null;
let loading: Promise<void> | null = null;

function post(msg: SegWorkerResponse, transfer: Transferable[] = []) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);
}

async function ensureReady(): Promise<void> {
  if (model && processor) return;
  if (!loading) {
    loading = (async () => {
      // Prefer same-origin weights when `pnpm fetch:florence2` has populated
      // web/public/models. Otherwise load from the Hub — Worker deploys cannot
      // ship the ONNX files (over the 25 MiB static-asset limit), and without
      // this fallback `/models/.../config.json` is the SPA HTML shell, which
      // surfaces as `Unexpected token '<' ... is not valid JSON`.
      const source = await resolveModelSource();
      env.allowLocalModels = source.mode === "local";
      env.allowRemoteModels = source.mode === "remote";

      const device = (await hasWebGpu()) ? "webgpu" : "wasm";
      try {
        processor = (await Florence2Processor.from_pretrained(
          source.path,
        )) as FlorenceProcessorInstance;
        model = await Florence2ForConditionalGeneration.from_pretrained(source.path, {
          device,
          dtype: {
            embed_tokens: "fp16",
            vision_encoder: "fp32",
            encoder_model: "q4",
            decoder_model_merged: "q4",
          },
        });
      } catch (err) {
        throw new Error(explainSegmentationLoadError(err));
      }
    })().catch((err) => {
      loading = null;
      model = null;
      processor = null;
      throw err;
    });
  }
  await loading;
}

async function hasWebGpu(): Promise<boolean> {
  try {
    const nav = self.navigator as Navigator & {
      gpu?: { requestAdapter: () => Promise<unknown> };
    };
    if (!nav.gpu) return false;
    return Boolean(await nav.gpu.requestAdapter());
  } catch {
    return false;
  }
}

function rgbaToRawImage(pixels: Uint8ClampedArray, width: number, height: number): RawImage {
  return new RawImage(pixels, width, height, 4);
}

function decodeGenerated(generated: Tensor | number[][] | { tolist?: () => unknown }): string {
  if (processor == null) return "";
  // Prefer the high-level helper when we have a Tensor; otherwise coerce.
  try {
    if (generated instanceof Tensor) {
      return processor.batch_decode(generated, { skip_special_tokens: false })[0] ?? "";
    }
  } catch {
    // fall through
  }
  const list =
    typeof (generated as { tolist?: () => unknown }).tolist === "function"
      ? (generated as { tolist: () => unknown }).tolist()
      : generated;
  if (Array.isArray(list)) {
    return processor.batch_decode(list as number[][], { skip_special_tokens: false })[0] ?? "";
  }
  return String(list ?? "");
}

self.onmessage = async (event: MessageEvent<SegWorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === "ensureReady") {
      await ensureReady();
      post({ type: "ready", modelId: MODEL_ID });
      return;
    }

    if (msg.type === "segment") {
      await ensureReady();
      if (!model || !processor) {
        post({
          type: "error",
          requestId: msg.requestId,
          message: "segmentation model is not loaded",
        });
        return;
      }

      const pixels = new Uint8ClampedArray(msg.pixels);
      const image = rgbaToRawImage(pixels, msg.width, msg.height);
      const text = msg.prompt.trim();
      if (!text) {
        post({
          type: "error",
          requestId: msg.requestId,
          message: "segmentation prompt must not be empty",
        });
        return;
      }

      const taskInput = `${TASK}${text}`;
      const inputs = await processor(image, taskInput);
      const generatedIds = await model.generate({
        ...inputs,
        // Polygon vertex streams are longer than box outputs.
        max_new_tokens: 1024,
      });
      const generatedText = decodeGenerated(generatedIds as Tensor);
      // Transformers.js throws on the polygons post-process type; parse locs ourselves.
      const polygons = extractPolygonsFromText(generatedText, msg.width, msg.height);
      const mask = rasterizePolygons(polygons, msg.width, msg.height);

      const coverage = maskCoverage(mask);
      if (polygons.length === 0 || coverage < 0.001) {
        post({
          type: "error",
          requestId: msg.requestId,
          message: `could not find "${text}" in the photo`,
        });
        return;
      }

      post(
        {
          type: "segmented",
          requestId: msg.requestId,
          mask: mask.data.buffer as ArrayBuffer,
          width: mask.width,
          height: mask.height,
          coverage,
          meta: {
            modelId: MODEL_ID,
            task: TASK,
            polygonCount: polygons.length,
          },
        },
        [mask.data.buffer as ArrayBuffer],
      );
    }
  } catch (err) {
    const requestId = msg.type === "segment" ? msg.requestId : undefined;
    post({
      type: "error",
      requestId,
      message: explainSegmentationLoadError(err),
    });
  }
};
