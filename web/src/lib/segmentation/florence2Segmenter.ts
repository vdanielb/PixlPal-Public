import type { SegWorkerRequest, SegWorkerResponse } from "../../worker/segmentation.worker";
import { maskCoverage } from "./rasterize";
import type { Segmenter, SegmentRequest, SegmentResult } from "./types";

/**
 * Florence-2-base-ft Segmenter. Inference runs in a dedicated worker; this
 * class is only a thin RPC client so the rest of the app never imports
 * Transformers.js directly.
 */
export class Florence2Segmenter implements Segmenter {
  readonly id = "florence2-base-ft";

  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private nextRequestId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: SegmentResult) => void;
      reject: (error: Error) => void;
    }
  >();

  async ensureReady(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const worker = this.ensureWorker();
    if (!this.ready) {
      this.ready = new Promise<void>((resolve, reject) => {
        const onMessage = (event: MessageEvent<SegWorkerResponse>) => {
          if (event.data.type === "ready") {
            cleanup();
            resolve();
          } else if (event.data.type === "error" && event.data.requestId === undefined) {
            cleanup();
            this.ready = null;
            reject(new Error(event.data.message));
          }
        };
        const onError = () => {
          cleanup();
          this.ready = null;
          reject(new Error("segmentation worker failed to start"));
        };
        const cleanup = () => {
          worker.removeEventListener("message", onMessage as EventListener);
          worker.removeEventListener("error", onError);
        };
        worker.addEventListener("message", onMessage as EventListener);
        worker.addEventListener("error", onError);
        post(worker, { type: "ensureReady" });
      });
    }

    if (signal) {
      await Promise.race([
        this.ready,
        abortPromise(signal),
      ]);
    } else {
      await this.ready;
    }
  }

  async segment(image: ImageData, request: SegmentRequest): Promise<SegmentResult> {
    throwIfAborted(request.signal);
    await this.ensureReady(request.signal);
    const worker = this.ensureWorker();
    const requestId = this.nextRequestId++;
    const pixels = image.data.buffer.slice(
      image.data.byteOffset,
      image.data.byteOffset + image.data.byteLength,
    );

    const result = await new Promise<SegmentResult>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      const onAbort = () => {
        const pending = this.pending.get(requestId);
        if (pending) {
          this.pending.delete(requestId);
          pending.reject(new DOMException("The segmentation was cancelled.", "AbortError"));
        }
      };
      if (request.signal) {
        if (request.signal.aborted) {
          onAbort();
          return;
        }
        request.signal.addEventListener("abort", onAbort, { once: true });
      }
      post(
        worker,
        {
          type: "segment",
          requestId,
          pixels,
          width: image.width,
          height: image.height,
          prompt: request.prompt,
        },
        [pixels],
      );
    });

    // Recompute coverage locally so callers do not depend on the worker's math.
    return {
      ...result,
      coverage: maskCoverage(result.mask),
    };
  }

  dispose(): void {
    for (const [, pending] of this.pending) {
      pending.reject(new Error("segmenter disposed"));
    }
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("../../worker/segmentation.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<SegWorkerResponse>) => {
      const msg = event.data;
      if (msg.type === "segmented") {
        const pending = this.pending.get(msg.requestId);
        if (!pending) return;
        this.pending.delete(msg.requestId);
        pending.resolve({
          mask: {
            width: msg.width,
            height: msg.height,
            data: new Float32Array(msg.mask),
          },
          coverage: msg.coverage,
          meta: msg.meta,
        });
      } else if (msg.type === "error" && msg.requestId !== undefined) {
        const pending = this.pending.get(msg.requestId);
        if (!pending) return;
        this.pending.delete(msg.requestId);
        pending.reject(new Error(msg.message));
      }
    };
    this.worker = worker;
    return worker;
  }
}

function post(worker: Worker, msg: SegWorkerRequest, transfer: Transferable[] = []) {
  worker.postMessage(msg, transfer);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The segmentation was cancelled.", "AbortError");
  }
}

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException("The segmentation was cancelled.", "AbortError"),
      );
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new DOMException("The segmentation was cancelled.", "AbortError"),
        );
      },
      { once: true },
    );
  });
}
