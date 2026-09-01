/**
 * TypeScript mirror of `pipeline.schema.json` and the Rust engine's
 * `pipeline.rs`. Versions 1..3 (v2 adds optional masks, v3 adds the optional
 * frame transform: rotate + crop applied after every operation).
 */

import type { FrameTransform } from "./frame";

export const PIPELINE_VERSION = 3 as const;
export type PipelineVersion = 1 | 2 | 3;

export interface ExposureParams {
  /** -1..1 → ±2.5 stops */
  amount?: number;
}

export interface ContrastParams {
  /** -1..1 */
  amount?: number;
}

export interface ShadowsHighlightsParams {
  /** -1..1; positive opens shadows, negative darkens */
  shadows?: number;
  /** -1..1; positive brightens highlights, negative recovers */
  highlights?: number;
}

export type ToneCurvePreset = "linear" | "soft" | "hard" | "film";

export interface ToneCurveParams {
  preset?: ToneCurvePreset;
  /** Explicit [x, y] control points in 0..1; overrides preset. */
  points?: [number, number][];
}

export interface LiftBlacksParams {
  /** 0..1 */
  amount?: number;
}

export type DodgeBurnRange = "shadows" | "midtones" | "highlights";

export interface DodgeBurnParams {
  /** -1..1; positive dodges (lightens), negative burns (darkens) */
  amount?: number;
  /** Which tonal band to emphasize. Default midtones. */
  range?: DodgeBurnRange;
}

export interface SaturationParams {
  /** -1..1 */
  amount?: number;
}

export interface ColorBalanceParams {
  /** -1..1, + warm / - cool */
  temperature?: number;
  /** -1..1, + magenta / - green */
  tint?: number;
}

export interface ColorShiftParams {
  /** -1..1 → ±180° hue rotation */
  hue?: number;
}

export interface GrainParams {
  /** 0..1 */
  amount?: number;
  /** 0.5..4 grain clump size */
  size?: number;
  /** deterministic noise seed */
  seed?: number;
}

export interface FilmSoftnessParams {
  /** 0..1 */
  amount?: number;
}

export interface VignetteParams {
  /** 0..1 darkening strength */
  amount?: number;
  /** 0..1 untouched center size */
  size?: number;
}

export interface BloomParams {
  /** 0..1 */
  strength?: number;
  /** 0..1 luminance threshold */
  threshold?: number;
  /** 0..1 spread */
  radius?: number;
}

export interface HalationParams {
  /** 0..1 */
  strength?: number;
  /** 0..1 luminance threshold */
  threshold?: number;
  /** 0..1 spread */
  radius?: number;
}

export interface LensBlurParams {
  /** 0..1 */
  radius?: number;
}

/** Optional per-operation mask binding (pipeline v2). */
export interface MaskRef {
  /** Id of a host-resolved mask bitmap. */
  mask?: string;
  /** When true, apply the op where the mask is low. */
  invertMask?: boolean;
  /** 0..1 scale on the mask before invert. Omit = 1. Requires `mask`. */
  maskStrength?: number;
}

type OpBody =
  | { op: "exposure"; params?: ExposureParams }
  | { op: "contrast"; params?: ContrastParams }
  | { op: "shadows_highlights"; params?: ShadowsHighlightsParams }
  | { op: "tone_curve"; params?: ToneCurveParams }
  | { op: "lift_blacks"; params?: LiftBlacksParams }
  | { op: "dodge_burn"; params?: DodgeBurnParams }
  | { op: "saturation"; params?: SaturationParams }
  | { op: "color_balance"; params?: ColorBalanceParams }
  | { op: "color_shift"; params?: ColorShiftParams }
  | { op: "grain"; params?: GrainParams }
  | { op: "film_softness"; params?: FilmSoftnessParams }
  | { op: "vignette"; params?: VignetteParams }
  | { op: "bloom"; params?: BloomParams }
  | { op: "halation"; params?: HalationParams }
  | { op: "lens_blur"; params?: LensBlurParams };

export type Operation = OpBody & MaskRef;

export type OpName = OpBody["op"];

/**
 * Host-side mask declaration. The engine ignores `source` / `prompt` and only
 * consumes the bitmap the host supplies under `id`.
 */
export interface MaskDeclaration {
  id: string;
  source?: string;
  prompt?: string;
  /** Feather radius as a fraction of the image's smaller side. */
  feather?: number;
}

export interface Pipeline {
  version: PipelineVersion;
  masks?: MaskDeclaration[];
  operations: Operation[];
  /**
   * Non-destructive rotate + crop, applied by the engine after all
   * operations. Requires version 3.
   */
  frame?: FrameTransform;
}

export function emptyPipeline(): Pipeline {
  return { version: 1, operations: [] };
}

export function serializePipeline(pipeline: Pipeline): string {
  return JSON.stringify(pipeline);
}
