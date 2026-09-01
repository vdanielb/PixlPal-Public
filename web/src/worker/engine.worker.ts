/// <reference lib="webworker" />
/**
 * Web Worker that owns the WASM engine. Pixel processing happens here so
 * slider drags never block the UI thread.
 *
 * Protocol (all pixel buffers are transferred, not copied):
 *   -> { type: "setPreview", pixels, width, height }
 *   -> { type: "process", jobId, pipelineJson, maskIdsJson?, masks? }
 *   <- { type: "processed", jobId, pixels, width, height }
 *   -> { type: "processFull", requestId, pixels, width, height, pipelineJson, maskIdsJson?, masks? }
 *   <- { type: "fullProcessed", requestId, pixels, width, height }
 *   <- { type: "ready" } | { type: "error", jobId?, requestId?, message }
 */

import init, { process_rgba8, process_rgba8_with_masks } from "../engine/pixelcam_engine";

export type EngineMasks = {
  /** JSON array of mask ids, e.g. `["dress"]`. */
  maskIdsJson: string;
  /** Concatenated f32 planes, each width*height. */
  masks: Float32Array;
};

export type WorkerRequest =
  | { type: "setPreview"; pixels: ArrayBuffer; width: number; height: number }
  | {
      type: "process";
      jobId: number;
      pipelineJson: string;
      maskIdsJson?: string;
      masks?: ArrayBuffer;
    }
  | {
      type: "processFull";
      requestId: number;
      pixels: ArrayBuffer;
      width: number;
      height: number;
      pipelineJson: string;
      maskIdsJson?: string;
      masks?: ArrayBuffer;
    };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "processed"; jobId: number; pixels: ArrayBuffer; width: number; height: number }
  | { type: "fullProcessed"; requestId: number; pixels: ArrayBuffer; width: number; height: number }
  | { type: "error"; jobId?: number; requestId?: number; message: string };

const ready = init().then(() => {
  post({ type: "ready" });
});

let preview: { pixels: Uint8Array; width: number; height: number } | null = null;

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);
}

type ProcessedPixels = { pixels: Uint8Array; width: number; height: number };

function runProcess(
  pixels: Uint8Array,
  width: number,
  height: number,
  pipelineJson: string,
  maskIdsJson?: string,
  masksBuf?: ArrayBuffer,
): ProcessedPixels {
  // Since pipeline v3 the frame transform (rotate + crop) can change the
  // output size, so the engine returns dimensions along with the pixels.
  const out =
    maskIdsJson && masksBuf
      ? process_rgba8_with_masks(
          pixels,
          width,
          height,
          pipelineJson,
          maskIdsJson,
          new Float32Array(masksBuf),
        )
      : process_rgba8(pixels, width, height, pipelineJson);
  try {
    return { pixels: out.pixels(), width: out.width, height: out.height };
  } finally {
    out.free();
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  await ready;
  const msg = event.data;

  switch (msg.type) {
    case "setPreview": {
      preview = {
        pixels: new Uint8Array(msg.pixels),
        width: msg.width,
        height: msg.height,
      };
      break;
    }

    case "process": {
      if (!preview) {
        post({ type: "error", jobId: msg.jobId, message: "no preview image loaded" });
        return;
      }
      try {
        const out = runProcess(
          preview.pixels,
          preview.width,
          preview.height,
          msg.pipelineJson,
          msg.maskIdsJson,
          msg.masks,
        );
        post(
          {
            type: "processed",
            jobId: msg.jobId,
            pixels: out.pixels.buffer as ArrayBuffer,
            width: out.width,
            height: out.height,
          },
          [out.pixels.buffer as ArrayBuffer],
        );
      } catch (err) {
        post({ type: "error", jobId: msg.jobId, message: String(err) });
      }
      break;
    }

    case "processFull": {
      try {
        const pixels = new Uint8Array(msg.pixels);
        const out = runProcess(
          pixels,
          msg.width,
          msg.height,
          msg.pipelineJson,
          msg.maskIdsJson,
          msg.masks,
        );
        post(
          {
            type: "fullProcessed",
            requestId: msg.requestId,
            pixels: out.pixels.buffer as ArrayBuffer,
            width: out.width,
            height: out.height,
          },
          [out.pixels.buffer as ArrayBuffer],
        );
      } catch (err) {
        post({ type: "error", requestId: msg.requestId, message: String(err) });
      }
      break;
    }
  }
};
