/**
 * Model-agnostic segmentation contract.
 *
 * The LLM agent and the Rust engine never import a concrete model. The host
 * app owns a `Segmenter` implementation (Florence-2 today; swappable later)
 * and only ever hands the engine plain mask bitmaps.
 */

export type SegmentRequest = {
  /** Referring expression, e.g. "the red dress". */
  prompt: string;
  signal?: AbortSignal;
};

export type MaskBitmap = {
  width: number;
  height: number;
  /** Row-major, 0..1 coverage. */
  data: Float32Array;
};

export type SegmentResult = {
  mask: MaskBitmap;
  /** Rough fraction of pixels with coverage > 0.5. */
  coverage: number;
  meta?: Record<string, unknown>;
};

export interface Segmenter {
  readonly id: string;
  ensureReady(signal?: AbortSignal): Promise<void>;
  segment(image: ImageData, request: SegmentRequest): Promise<SegmentResult>;
  dispose?(): void;
}

export type SegmenterId = "florence2-base-ft";

export const DEFAULT_SEGMENTER_ID: SegmenterId = "florence2-base-ft";
