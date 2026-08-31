/**
 * Operation metadata: the single source of truth the editor uses to render
 * its controls. Adding an op to the engine plus an entry here makes it
 * appear in the UI.
 */

import type { OpName } from "./types";

export type OpCategory = "tonal" | "color" | "texture" | "optical";

export interface SliderParamDef {
  kind: "slider";
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** Value at which the parameter has no effect (slider reset point). */
  neutral: number;
}

export interface SelectParamDef {
  kind: "select";
  label: string;
  options: readonly string[];
  default: string;
}

export type ParamDef = SliderParamDef | SelectParamDef;

export interface OperationDef {
  op: OpName;
  label: string;
  category: OpCategory;
  description: string;
  params: Record<string, ParamDef>;
}

const unipolar = (label: string, def: number): SliderParamDef => ({
  kind: "slider",
  label,
  min: 0,
  max: 1,
  step: 0.01,
  default: def,
  neutral: 0,
});

const bipolar = (label: string): SliderParamDef => ({
  kind: "slider",
  label,
  min: -1,
  max: 1,
  step: 0.01,
  default: 0,
  neutral: 0,
});

export const OPERATION_DEFS: readonly OperationDef[] = [
  {
    op: "exposure",
    label: "Exposure",
    category: "tonal",
    description: "Brightens or darkens the whole image in photographic stops.",
    params: { amount: bipolar("Amount") },
  },
  {
    op: "contrast",
    label: "Contrast",
    category: "tonal",
    description: "Expands or compresses tones around middle gray.",
    params: { amount: bipolar("Amount") },
  },
  {
    op: "shadows_highlights",
    label: "Shadows / Highlights",
    category: "tonal",
    description:
      "Opens or recovers shadows and highlights independently (Lightroom-style). Prefer for whole-frame tonal recovery.",
    params: {
      shadows: bipolar("Shadows"),
      highlights: bipolar("Highlights"),
    },
  },
  {
    op: "tone_curve",
    label: "Tone Curve",
    category: "tonal",
    description: "Remaps tones through a named response curve.",
    params: {
      preset: {
        kind: "select",
        label: "Curve",
        options: ["linear", "soft", "hard", "film"],
        default: "soft",
      },
    },
  },
  {
    op: "lift_blacks",
    label: "Lift Blacks",
    category: "tonal",
    description: "Raises the black point for a faded, matte film look.",
    params: { amount: unipolar("Amount", 0.5) },
  },
  {
    op: "dodge_burn",
    label: "Dodge / Burn",
    category: "tonal",
    description:
      "Lightens (dodge) or darkens (burn) a tonal range — shadows, midtones, or highlights. Best used with a mask for local edits.",
    params: {
      amount: bipolar("Amount"),
      range: {
        kind: "select",
        label: "Range",
        options: ["shadows", "midtones", "highlights"],
        default: "midtones",
      },
    },
  },
  {
    op: "saturation",
    label: "Saturation",
    category: "color",
    description: "Pushes colors toward or away from grayscale.",
    params: { amount: bipolar("Amount") },
  },
  {
    op: "color_balance",
    label: "Color Balance",
    category: "color",
    description: "Warm/cool temperature and green/magenta tint.",
    params: {
      temperature: bipolar("Temperature"),
      tint: bipolar("Tint"),
    },
  },
  {
    op: "color_shift",
    label: "Color Shift",
    category: "color",
    description: "Rotates every hue around the color wheel.",
    params: { hue: bipolar("Hue") },
  },
  {
    op: "grain",
    label: "Grain",
    category: "texture",
    description: "Deterministic film grain, strongest in the midtones.",
    params: {
      amount: unipolar("Amount", 0.5),
      size: {
        kind: "slider",
        label: "Size",
        min: 0.5,
        max: 4,
        step: 0.1,
        default: 1,
        neutral: 1,
      },
    },
  },
  {
    op: "film_softness",
    label: "Film Softness",
    category: "texture",
    description: "Gentle diffusion that lowers micro-contrast, keeps detail.",
    params: { amount: unipolar("Amount", 0.5) },
  },
  {
    op: "vignette",
    label: "Vignette",
    category: "optical",
    description: "Darkens frame edges with a smooth radial falloff.",
    params: {
      amount: unipolar("Amount", 0.5),
      size: {
        kind: "slider",
        label: "Size",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.5,
        neutral: 1,
      },
    },
  },
  {
    op: "bloom",
    label: "Bloom",
    category: "optical",
    description: "Bright areas glow softly outward.",
    params: {
      strength: unipolar("Strength", 0.5),
      threshold: unipolar("Threshold", 0.65),
      radius: unipolar("Radius", 0.5),
    },
  },
  {
    op: "halation",
    label: "Halation",
    category: "optical",
    description: "Red-orange film halo around bright highlights.",
    params: {
      strength: unipolar("Strength", 0.4),
      threshold: unipolar("Threshold", 0.75),
      radius: unipolar("Radius", 0.4),
    },
  },
  {
    op: "lens_blur",
    label: "Lens Blur",
    category: "optical",
    description: "Soft gaussian defocus across the whole frame.",
    params: { radius: unipolar("Radius", 0.3) },
  },
] as const;

export const CATEGORY_LABELS: Record<OpCategory, string> = {
  tonal: "Tone",
  color: "Color",
  texture: "Texture",
  optical: "Optics",
};

export function getOperationDef(op: OpName): OperationDef {
  const def = OPERATION_DEFS.find((d) => d.op === op);
  if (!def) throw new Error(`Unknown operation: ${op}`);
  return def;
}

/** Build an operation object with every parameter at its default. */
export function defaultOperation(op: OpName): { op: OpName; params: Record<string, number | string> } {
  const def = getOperationDef(op);
  const params: Record<string, number | string> = {};
  for (const [key, p] of Object.entries(def.params)) {
    params[key] = p.default;
  }
  return { op, params };
}
