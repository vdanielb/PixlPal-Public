/**
 * React hook that owns the engine worker and coalesces preview jobs:
 * while the worker is busy, only the latest requested pipeline is kept, so
 * fast slider drags never queue up stale work.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkerRequest, WorkerResponse } from "../worker/engine.worker";

export type EngineMaskPayload = {
  maskIdsJson: string;
  /** Concatenated f32 planes matching the image being processed. */
  masks: Float32Array;
};

export interface EngineApi {
  ready: boolean;
  /** Latest processed preview frame. */
  previewFrame: ImageData | null;
  /** True while the worker is chewing on a preview job. */
  processing: boolean;
  error: string | null;
  setPreviewImage: (image: ImageData) => void;
  /** Ask for the preview to be re-processed with this pipeline (+ optional masks). */
  requestPreview: (pipelineJson: string, masks?: EngineMaskPayload | null) => void;
  /** Process a full-resolution image (for export). */
  processFull: (
    image: ImageData,
    pipelineJson: string,
    masks?: EngineMaskPayload | null,
  ) => Promise<ImageData>;
}

type PendingJob = {
  pipelineJson: string;
  masks: EngineMaskPayload | null;
};

export function useEngine(): EngineApi {
  const workerRef = useRef<Worker | null>(null);
  const [ready, setReady] = useState(false);
  const [previewFrame, setPreviewFrame] = useState<ImageData | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const jobCounter = useRef(0);
  const inFlight = useRef<number | null>(null);
  const pendingJob = useRef<PendingJob | null>(null);
  const fullRequests = useRef(
    new Map<number, { resolve: (img: ImageData) => void; reject: (err: Error) => void }>(),
  );

  useEffect(() => {
    const worker = new Worker(new URL("../worker/engine.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      switch (msg.type) {
        case "ready":
          setReady(true);
          break;
        case "processed": {
          if (msg.jobId === inFlight.current) {
            inFlight.current = null;
          }
          setPreviewFrame(
            new ImageData(new Uint8ClampedArray(msg.pixels), msg.width, msg.height),
          );
          setError(null);
          // A newer pipeline arrived while we were busy — run it now.
          if (pendingJob.current !== null) {
            const next = pendingJob.current;
            pendingJob.current = null;
            dispatchPreview(next.pipelineJson, next.masks);
          } else {
            setProcessing(false);
          }
          break;
        }
        case "fullProcessed": {
          const handler = fullRequests.current.get(msg.requestId);
          if (handler) {
            fullRequests.current.delete(msg.requestId);
            handler.resolve(
              new ImageData(new Uint8ClampedArray(msg.pixels), msg.width, msg.height),
            );
          }
          break;
        }
        case "error": {
          if (msg.requestId !== undefined) {
            const handler = fullRequests.current.get(msg.requestId);
            if (handler) {
              fullRequests.current.delete(msg.requestId);
              handler.reject(new Error(msg.message));
            }
          } else {
            inFlight.current = null;
            pendingJob.current = null;
            setProcessing(false);
            setError(msg.message);
          }
          break;
        }
      }
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dispatchPreview = (pipelineJson: string, masks: EngineMaskPayload | null) => {
    const worker = workerRef.current;
    if (!worker) return;
    const jobId = ++jobCounter.current;
    inFlight.current = jobId;
    setProcessing(true);
    if (masks) {
      const copy = masks.masks.slice().buffer;
      const msg: WorkerRequest = {
        type: "process",
        jobId,
        pipelineJson,
        maskIdsJson: masks.maskIdsJson,
        masks: copy,
      };
      worker.postMessage(msg, [copy]);
    } else {
      const msg: WorkerRequest = { type: "process", jobId, pipelineJson };
      worker.postMessage(msg);
    }
  };

  const setPreviewImage = useCallback((image: ImageData) => {
    const worker = workerRef.current;
    if (!worker) return;
    // Copy: the caller keeps its ImageData, the worker gets its own buffer.
    const pixels = new Uint8Array(image.data).buffer;
    const msg: WorkerRequest = {
      type: "setPreview",
      pixels,
      width: image.width,
      height: image.height,
    };
    worker.postMessage(msg, [pixels]);
  }, []);

  const requestPreview = useCallback((pipelineJson: string, masks?: EngineMaskPayload | null) => {
    const payload = masks ?? null;
    if (inFlight.current !== null) {
      pendingJob.current = { pipelineJson, masks: payload };
    } else {
      dispatchPreview(pipelineJson, payload);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const processFull = useCallback(
    (image: ImageData, pipelineJson: string, masks?: EngineMaskPayload | null) => {
      return new Promise<ImageData>((resolve, reject) => {
        const worker = workerRef.current;
        if (!worker) {
          reject(new Error("engine worker not running"));
          return;
        }
        const requestId = ++jobCounter.current;
        fullRequests.current.set(requestId, { resolve, reject });
        const pixels = new Uint8Array(image.data).buffer;
        if (masks) {
          const copy = masks.masks.slice().buffer;
          const msg: WorkerRequest = {
            type: "processFull",
            requestId,
            pixels,
            width: image.width,
            height: image.height,
            pipelineJson,
            maskIdsJson: masks.maskIdsJson,
            masks: copy,
          };
          worker.postMessage(msg, [pixels, copy]);
        } else {
          const msg: WorkerRequest = {
            type: "processFull",
            requestId,
            pixels,
            width: image.width,
            height: image.height,
            pipelineJson,
          };
          worker.postMessage(msg, [pixels]);
        }
      });
    },
    [],
  );

  return { ready, previewFrame, processing, error, setPreviewImage, requestPreview, processFull };
}
