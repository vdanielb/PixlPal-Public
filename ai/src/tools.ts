/**
 * The knobs, as tools.
 *
 * Tool schemas are derived from `OPERATION_DEFS`, so they can never drift
 * from the sliders the user sees. Execution mutates the same `OpState` the
 * editor UI owns — the agent turns the real knobs rather than writing a
 * pipeline behind the editor's back.
 *
 * Segmentation is host-injected: this package never imports a model. The host
 * supplies `ctx.segment(prompt)` which returns a mask id the agent can attach
 * to later `set_operations` calls. `ctx.invertMask(maskId)` creates a selectable
 * complement of an existing mask for background / "everything else" edits.
 *
 * Bad arguments are *results*, not exceptions: every failure comes back as
 * `{ ok: false, error }` and is handed to the model, which then corrects
 * itself. That is what makes invalid pipelines impossible to reach.
 */

import {
  OPERATION_DEFS,
  defaultOperation,
  opStateToPipeline,
  type ActiveOp,
  type OperationDef,
  type OpName,
  type OpState,
  type ParamValues,
} from "@pixelcam/shared";
import type { ImageStats, ToolOk, ToolResult, ToolSchema } from "./types";

export const TOOL_NAMES = {
  setOperations: "set_operations",
  removeOperations: "remove_operations",
  resetEdits: "reset_edits",
  getImageStats: "get_image_stats",
  segment: "segment",
  invertMask: "invert_mask",
} as const;

/** Short human labels for rendering tool activity in a chat transcript. */
export const TOOL_LABELS: Record<string, string> = {
  [TOOL_NAMES.setOperations]: "Adjusting",
  [TOOL_NAMES.removeOperations]: "Removing",
  [TOOL_NAMES.resetEdits]: "Resetting",
  [TOOL_NAMES.getImageStats]: "Reading the photo",
  [TOOL_NAMES.segment]: "Finding subject",
  [TOOL_NAMES.invertMask]: "Selecting inverse",
};

const OP_NAMES: OpName[] = OPERATION_DEFS.map((def) => def.op);

export type SegmentHostResult =
  | { maskId: string; coverage: number }
  | { error: string };

export type SegmentHost = (
  prompt: string,
  signal?: AbortSignal,
) => Promise<SegmentHostResult>;

export type InvertMaskHostResult =
  | { maskId: string; coverage: number; sourceMaskId: string }
  | { error: string };

export type InvertMaskHost = (
  maskId: string,
  signal?: AbortSignal,
) => Promise<InvertMaskHostResult>;

function findDef(op: unknown): OperationDef | undefined {
  return OPERATION_DEFS.find((def) => def.op === op);
}

/** One-line spec of an operation's parameters, e.g. `grain: amount 0..1, size 0.5..4`. */
export function describeOpParams(def: OperationDef): string {
  const parts = Object.entries(def.params).map(([key, param]) =>
    param.kind === "slider"
      ? `${key} ${param.min}..${param.max}`
      : `${key} one of ${param.options.join("|")}`,
  );
  return parts.length > 0 ? parts.join(", ") : "no parameters";
}

/**
 * Every parameter name used by any operation, typed. Which keys are legal for
 * a given `op` is enforced at execution time, where the error message can name
 * the offending operation.
 */
function paramProperties(): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const def of OPERATION_DEFS) {
    for (const [key, param] of Object.entries(def.params)) {
      if (param.kind === "slider") {
        properties[key] = { type: "number" };
      } else {
        const existing = properties[key] as { enum?: string[] } | undefined;
        const options = [...new Set([...(existing?.enum ?? []), ...param.options])];
        properties[key] = { type: "string", enum: options };
      }
    }
  }
  return properties;
}

export const AGENT_TOOLS: ToolSchema[] = [
  {
    name: TOOL_NAMES.setOperations,
    description: [
      "Turn one or more editing knobs. Parameters you pass are merged into the",
      "current edit, so you can nudge a single value without restating the rest;",
      "omitting `params` entirely enables the operation at its default strength.",
      "Optional `mask` (from a prior segment or invert_mask call) limits the op",
      "to that region. Prefer invert_mask when the user wants edits on everything",
      "except a subject; `invertMask: true` on this tool is a quick alternative",
      "that does not create a selectable complement mask.",
      "`maskStrength` (0..1, default 1) softens how hard the mask applies without",
      "changing the op's own amount — use it to dial in local edits.",
      "For local lighten/darken prefer dodge_burn with a range (shadows|midtones|",
      "highlights) plus a mask; prefer shadows_highlights for whole-frame shadow/",
      "highlight recovery; keep exposure for whole-frame EV.",
      "Operations and their parameter ranges:",
      ...OPERATION_DEFS.map((def) => `- ${def.op} (${def.description}) ${describeOpParams(def)}`),
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        operations: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: OP_NAMES },
              params: {
                type: "object",
                additionalProperties: false,
                properties: paramProperties(),
              },
              mask: {
                type: "string",
                description: "Mask id returned by segment or invert_mask.",
              },
              invertMask: {
                type: "boolean",
                description:
                  "When true, apply the op outside the mask without creating a complement mask. Prefer invert_mask when both the subject and its surroundings need separate selectable edits.",
              },
              maskStrength: {
                type: "number",
                minimum: 0,
                maximum: 1,
                description: "0..1 scale on the mask before invert. Requires mask. Default 1.",
              },
            },
            required: ["op"],
            additionalProperties: false,
          },
        },
      },
      required: ["operations"],
      additionalProperties: false,
    },
  },
  {
    name: TOOL_NAMES.removeOperations,
    description:
      "Switch operations off entirely, removing them from the edit. Use this rather than setting a parameter to zero when the user wants an effect gone.",
    parameters: {
      type: "object",
      properties: {
        ops: { type: "array", minItems: 1, items: { type: "string", enum: OP_NAMES } },
      },
      required: ["ops"],
      additionalProperties: false,
    },
  },
  {
    name: TOOL_NAMES.resetEdits,
    description: "Clear every adjustment and return to the untouched original photo.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: TOOL_NAMES.getImageStats,
    description:
      "Measure the photo currently open in the editor: brightness, black and white points, clipping, saturation and color cast. Returns precise numbers to complement the preview image attached to each user message. Call this when you need quantitative measurements (for example exact clipping or color-cast values).",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: TOOL_NAMES.segment,
    description: [
      "Find a subject in the open photo by referring expression and create a mask.",
      "Call this before local edits like 'make the dress pop' or 'blur the background'.",
      "Returns a maskId you then pass to set_operations via `mask`, or to invert_mask",
      "to select everything else. Runs fully on-device; no pixels leave the device.",
      "If segmentation fails, fall back to a global edit and say so.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          minLength: 1,
          description: 'Referring expression, e.g. "the red dress" or "the sky".',
        },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  {
    name: TOOL_NAMES.invertMask,
    description: [
      "Create a selectable mask that is the inverse of an existing mask from segment.",
      "Use after segment when the user wants edits on everything except a subject,",
      "for example 'blur everything except the person' or 'emphasize this object'",
      "(boost the subject mask, then de-emphasize the inverse). Returns a new maskId",
      "for set_operations. Prefer this over set_operations invertMask:true when both",
      "the subject and its surroundings need their own edits.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        maskId: {
          type: "string",
          minLength: 1,
          description: "Mask id returned by a prior segment call.",
        },
      },
      required: ["maskId"],
      additionalProperties: false,
    },
  },
];

export interface ToolContext {
  opState: OpState;
  imageStats?: ImageStats | null;
  /** Host-provided segmentation. Required for the segment tool. */
  segment?: SegmentHost;
  /** Host-provided mask invert. Required for the invert_mask tool. */
  invertMask?: InvertMaskHost;
  signal?: AbortSignal;
}

export interface ToolOutcome {
  opState: OpState;
  changed: boolean;
  result: ToolResult;
}

function roundToStep(value: number, step: number): number {
  if (!(step > 0)) return value;
  return Number((Math.round(value / step) * step).toFixed(6));
}

type CoercedParams = { params: ParamValues; warnings: string[] } | { error: string };

function coerceParams(def: OperationDef, raw: unknown): CoercedParams {
  if (raw === undefined || raw === null) return { params: {}, warnings: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { error: `"params" for "${def.op}" must be an object.` };
  }

  const params: ParamValues = {};
  const warnings: string[] = [];

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    // Own-property check only: a key like "__proto__" must not resolve up the
    // prototype chain and be mistaken for a real parameter definition.
    const param = Object.prototype.hasOwnProperty.call(def.params, key)
      ? def.params[key]
      : undefined;
    if (!param) {
      const valid = Object.keys(def.params).join(", ") || "(none)";
      return { error: `"${def.op}" has no parameter "${key}". Valid parameters: ${valid}.` };
    }

    if (param.kind === "slider") {
      // Numeric strings are tolerated because models emit them; booleans,
      // arrays and objects are not, so they get a useful error instead of a
      // silent coercion to 0.
      const numeric =
        typeof value === "number"
          ? value
          : typeof value === "string" && value.trim() !== ""
            ? Number(value)
            : Number.NaN;
      if (!Number.isFinite(numeric)) {
        return {
          error: `"${def.op}.${key}" must be a number between ${param.min} and ${param.max}.`,
        };
      }
      const clamped = Math.min(param.max, Math.max(param.min, numeric));
      if (clamped !== numeric) {
        warnings.push(
          `${def.op}.${key} was clamped from ${numeric} to ${clamped} (valid range ${param.min}..${param.max}).`,
        );
      }
      params[key] = roundToStep(clamped, param.step);
    } else {
      const option = String(value);
      if (!param.options.includes(option)) {
        return { error: `"${def.op}.${key}" must be one of: ${param.options.join(", ")}.` };
      }
      params[key] = option;
    }
  }

  return { params, warnings };
}

function describeOp(op: OpName, active: ActiveOp): string {
  const rendered = Object.entries(active.params)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  const base = rendered ? `${op} (${rendered})` : op;
  if (!active.mask) return base;
  const strength =
    active.maskStrength !== undefined && active.maskStrength !== 1
      ? ` strength=${active.maskStrength}`
      : "";
  return active.invertMask
    ? `${base} [mask=${active.mask} inverted${strength}]`
    : `${base} [mask=${active.mask}${strength}]`;
}

/** Plain-language reading of the photo, so the model does not have to interpret raw numbers. */
export function describeImageStats(stats: ImageStats): string {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const tone =
    stats.meanLuma < 0.32 ? "dark" : stats.meanLuma > 0.62 ? "bright" : "averagely exposed";
  const cast =
    stats.colorCast > 0.12 ? "warm" : stats.colorCast < -0.12 ? "cool" : "roughly neutral";
  const color =
    stats.meanSaturation < 0.15 ? "muted" : stats.meanSaturation > 0.45 ? "vivid" : "moderate";
  return [
    `${stats.width}x${stats.height} preview.`,
    `Overall ${tone} (mean luminance ${stats.meanLuma.toFixed(3)}).`,
    `Black point ${stats.blackPoint.toFixed(3)}, white point ${stats.whitePoint.toFixed(3)}.`,
    `${pct(stats.clippedShadows)} of pixels are crushed to black and ${pct(stats.clippedHighlights)} are blown out.`,
    `Color is ${color} (mean saturation ${stats.meanSaturation.toFixed(3)}) and ${cast} (cast ${stats.colorCast.toFixed(3)} on a -1 cool to +1 warm scale).`,
  ].join(" ");
}

function unchanged(ctx: ToolContext, result: ToolResult): ToolOutcome {
  return { opState: ctx.opState, changed: false, result };
}

function fail(ctx: ToolContext, error: string): ToolOutcome {
  return unchanged(ctx, { ok: false, error });
}

function edited(next: OpState, result: ToolOk): ToolOutcome {
  return { opState: next, changed: true, result };
}

function ok(summary: string, next: OpState, warnings: string[]): ToolOk {
  return {
    ok: true,
    summary,
    data: { pipeline: opStateToPipeline(next) },
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

function parseArgs(
  rawArguments: unknown,
  ctx: ToolContext,
): { args: Record<string, unknown> } | ToolOutcome {
  let args: Record<string, unknown> = {};
  if (typeof rawArguments === "string") {
    const trimmed = rawArguments.trim();
    if (trimmed !== "") {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          return fail(ctx, "tool arguments must be a JSON object.");
        }
        args = parsed as Record<string, unknown>;
      } catch {
        return fail(ctx, `tool arguments were not valid JSON: ${trimmed}`);
      }
    }
  } else if (typeof rawArguments === "object" && rawArguments !== null && !Array.isArray(rawArguments)) {
    args = rawArguments as Record<string, unknown>;
  } else if (rawArguments !== undefined && rawArguments !== null) {
    return fail(ctx, "tool arguments must be a JSON object.");
  }
  return { args };
}

/**
 * Run one tool call against the current editor state and return the new state
 * plus the result to feed back to the model. Async so host segmentation can run.
 */
export async function executeTool(
  name: string,
  rawArguments: unknown,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const parsed = parseArgs(rawArguments, ctx);
  if ("result" in parsed) return parsed;
  const { args } = parsed;

  switch (name) {
    case TOOL_NAMES.setOperations:
      return setOperations(args, ctx);
    case TOOL_NAMES.removeOperations:
      return removeOperations(args, ctx);
    case TOOL_NAMES.resetEdits:
      return resetEdits(ctx);
    case TOOL_NAMES.getImageStats:
      return getImageStats(ctx);
    case TOOL_NAMES.segment:
      return segment(args, ctx);
    case TOOL_NAMES.invertMask:
      return invertMask(args, ctx);
    default:
      return fail(
        ctx,
        `unknown tool "${name}". Available tools: ${AGENT_TOOLS.map((tool) => tool.name).join(", ")}.`,
      );
  }
}

function setOperations(args: Record<string, unknown>, ctx: ToolContext): ToolOutcome {
  const entries = args.operations;
  if (!Array.isArray(entries) || entries.length === 0) {
    return fail(ctx, '"operations" must be a non-empty array of { op, params } objects.');
  }

  const next: OpState = { ...ctx.opState };
  const warnings: string[] = [];
  const applied: string[] = [];

  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return fail(
        ctx,
        'each item of "operations" must be an object like { "op": "grain", "params": { "amount": 0.5 } }.',
      );
    }
    const { op, params, mask, invertMask, maskStrength } = entry as {
      op?: unknown;
      params?: unknown;
      mask?: unknown;
      invertMask?: unknown;
      maskStrength?: unknown;
    };
    const def = findDef(op);
    if (!def) {
      return fail(
        ctx,
        `unknown operation "${String(op)}". Valid operations: ${OP_NAMES.join(", ")}.`,
      );
    }

    const coerced = coerceParams(def, params);
    if ("error" in coerced) return fail(ctx, coerced.error);

    if (mask !== undefined && (typeof mask !== "string" || mask.trim() === "")) {
      return fail(ctx, `"mask" for "${def.op}" must be a non-empty string mask id from segment.`);
    }
    if (invertMask !== undefined && typeof invertMask !== "boolean") {
      return fail(ctx, `"invertMask" for "${def.op}" must be a boolean.`);
    }
    let strengthValue: number | undefined;
    if (maskStrength !== undefined) {
      const numeric =
        typeof maskStrength === "number"
          ? maskStrength
          : typeof maskStrength === "string" && maskStrength.trim() !== ""
            ? Number(maskStrength)
            : Number.NaN;
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
        return fail(ctx, `"maskStrength" for "${def.op}" must be a number between 0 and 1.`);
      }
      strengthValue = roundToStep(numeric, 0.01);
    }

    const previous = next[def.op];
    const baseParams = previous?.params ?? defaultOperation(def.op).params;
    const merged: ParamValues = { ...baseParams, ...coerced.params };

    const active: ActiveOp = { params: merged };
    const maskId = typeof mask === "string" ? mask.trim() : previous?.mask;
    if (invertMask === true && !maskId) {
      return fail(ctx, `"invertMask" for "${def.op}" requires a "mask" id.`);
    }
    if (strengthValue !== undefined && !maskId) {
      return fail(ctx, `"maskStrength" for "${def.op}" requires a "mask" id.`);
    }
    if (maskId) active.mask = maskId;
    const invert =
      typeof invertMask === "boolean" ? invertMask : maskId ? Boolean(previous?.invertMask) : false;
    if (invert) active.invertMask = true;
    if (maskId) {
      const strength = strengthValue ?? previous?.maskStrength;
      if (strength !== undefined) active.maskStrength = strength;
    }

    next[def.op] = active;
    warnings.push(...coerced.warnings);
    applied.push(describeOp(def.op, active));
  }

  return edited(next, ok(`Set ${applied.join("; ")}.`, next, warnings));
}

function removeOperations(args: Record<string, unknown>, ctx: ToolContext): ToolOutcome {
  const ops = args.ops;
  if (!Array.isArray(ops) || ops.length === 0) {
    return fail(ctx, '"ops" must be a non-empty array of operation names.');
  }

  const next: OpState = { ...ctx.opState };
  const removed: string[] = [];
  const inactive: string[] = [];

  for (const op of ops) {
    const def = findDef(op);
    if (!def) {
      return fail(
        ctx,
        `unknown operation "${String(op)}". Valid operations: ${OP_NAMES.join(", ")}.`,
      );
    }
    if (next[def.op] === undefined) {
      inactive.push(def.op);
    } else {
      delete next[def.op];
      removed.push(def.op);
    }
  }

  const summary = [
    removed.length > 0 ? `Removed ${removed.join(", ")}.` : "Nothing was removed.",
    inactive.length > 0 ? `Already inactive: ${inactive.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (removed.length === 0) {
    return unchanged(ctx, ok(summary, ctx.opState, []));
  }
  return edited(next, ok(summary, next, []));
}

function resetEdits(ctx: ToolContext): ToolOutcome {
  const hadEdits = Object.keys(ctx.opState).length > 0;
  const next: OpState = {};
  const result = ok(
    hadEdits ? "Cleared every adjustment; back to the original photo." : "There were no adjustments to clear.",
    next,
    [],
  );
  return { opState: next, changed: hadEdits, result };
}

function getImageStats(ctx: ToolContext): ToolOutcome {
  if (!ctx.imageStats) {
    return fail(ctx, "no photo is open, so it cannot be measured.");
  }
  return unchanged(ctx, {
    ok: true,
    summary: describeImageStats(ctx.imageStats),
    data: { stats: ctx.imageStats as unknown as Record<string, unknown> },
  });
}

async function segment(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  if (!ctx.segment) {
    return fail(ctx, "segmentation is not available in this editor session.");
  }
  const prompt = args.prompt;
  if (typeof prompt !== "string" || prompt.trim() === "") {
    return fail(ctx, '"prompt" must be a non-empty referring expression.');
  }

  try {
    const result = await ctx.segment(prompt.trim(), ctx.signal);
    if ("error" in result) {
      return fail(ctx, result.error);
    }
    const pct = (result.coverage * 100).toFixed(1);
    return unchanged(ctx, {
      ok: true,
      summary: `Segmented "${prompt.trim()}" as mask "${result.maskId}" (covers ~${pct}% of the frame).`,
      data: { maskId: result.maskId, coverage: result.coverage },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return fail(ctx, "segmentation was cancelled.");
    }
    return fail(ctx, error instanceof Error ? error.message : String(error));
  }
}

async function invertMask(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  if (!ctx.invertMask) {
    return fail(ctx, "mask invert is not available in this editor session.");
  }
  const maskId = args.maskId;
  if (typeof maskId !== "string" || maskId.trim() === "") {
    return fail(ctx, '"maskId" must be a non-empty mask id from segment.');
  }

  try {
    const result = await ctx.invertMask(maskId.trim(), ctx.signal);
    if ("error" in result) {
      return fail(ctx, result.error);
    }
    const pct = (result.coverage * 100).toFixed(1);
    return unchanged(ctx, {
      ok: true,
      summary: `Selected the inverse of mask "${result.sourceMaskId}" as "${result.maskId}" (covers ~${pct}% of the frame).`,
      data: {
        maskId: result.maskId,
        coverage: result.coverage,
        sourceMaskId: result.sourceMaskId,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return fail(ctx, "mask invert was cancelled.");
    }
    return fail(ctx, error instanceof Error ? error.message : String(error));
  }
}
