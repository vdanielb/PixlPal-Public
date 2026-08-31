/**
 * Editor state model. The editor keeps a map of active operations and their
 * parameter values; the declarative pipeline is derived from it in the
 * canonical order defined by OPERATION_DEFS. Presets, manual edits, and AI
 * output all flow through this one representation.
 */

import { OPERATION_DEFS } from "./operations";
import type { MaskDeclaration, OpName, Operation, Pipeline } from "./types";

export type ParamValues = Record<string, number | string>;

/** One active operation in the editor, including optional mask binding. */
export type ActiveOp = {
  params: ParamValues;
  mask?: string;
  invertMask?: boolean;
  /** 0..1; omit means full strength (1). */
  maskStrength?: number;
};

export type OpState = Partial<Record<OpName, ActiveOp>>;

export function opStateToPipeline(
  state: OpState,
  masks: MaskDeclaration[] = [],
): Pipeline {
  const operations: Operation[] = [];
  let usesMask = false;
  for (const def of OPERATION_DEFS) {
    const active = state[def.op];
    if (!active) continue;
    const entry: Operation = { op: def.op, params: active.params } as Operation;
    if (active.mask) {
      entry.mask = active.mask;
      usesMask = true;
      if (active.maskStrength !== undefined) {
        entry.maskStrength = active.maskStrength;
      }
    }
    if (active.invertMask) {
      entry.invertMask = true;
      usesMask = true;
    }
    operations.push(entry);
  }

  const version = usesMask || masks.length > 0 ? 2 : 1;
  return {
    version,
    ...(masks.length > 0 ? { masks } : {}),
    operations,
  };
}

export function pipelineToOpState(pipeline: Pipeline): OpState {
  const state: OpState = {};
  for (const operation of pipeline.operations) {
    state[operation.op] = {
      params: { ...((operation.params as ParamValues | undefined) ?? {}) },
      ...(operation.mask ? { mask: operation.mask } : {}),
      ...(operation.invertMask ? { invertMask: true } : {}),
      ...(operation.maskStrength !== undefined ? { maskStrength: operation.maskStrength } : {}),
    };
  }
  return state;
}

/** Read params from an OpState entry, tolerating nothing else. */
export function getOpParams(state: OpState, op: OpName): ParamValues | undefined {
  return state[op]?.params;
}

/**
 * Editing target for the adjustments panel. `null` means the whole image
 * (ops with no mask); a string is a mask id from segmentation.
 */
export type MaskEditingTarget = string | null;

function opBelongsToTarget(active: ActiveOp, target: MaskEditingTarget): boolean {
  if (target === null) return active.mask === undefined;
  return active.mask === target;
}

/**
 * Slice of OpState visible while editing a given mask (or the whole image).
 * Ops bound to other masks are hidden so the sliders match the selection.
 */
export function projectOpStateForMask(state: OpState, target: MaskEditingTarget): OpState {
  const projected: OpState = {};
  for (const def of OPERATION_DEFS) {
    const active = state[def.op];
    if (!active) continue;
    if (opBelongsToTarget(active, target)) {
      projected[def.op] = active;
    }
  }
  return projected;
}

/**
 * Merge a projected panel edit back into the full OpState, forcing the mask
 * binding to match the current editing target. Because OpState holds at most
 * one entry per operation name, enabling an op under a new target replaces any
 * prior binding of that same op.
 */
export function mergeOpStateForMask(
  full: OpState,
  projected: OpState,
  target: MaskEditingTarget,
): OpState {
  const next: OpState = { ...full };

  for (const def of OPERATION_DEFS) {
    const existing = full[def.op];
    if (existing && opBelongsToTarget(existing, target) && projected[def.op] === undefined) {
      delete next[def.op];
    }
  }

  for (const def of OPERATION_DEFS) {
    const active = projected[def.op];
    if (!active) continue;
    if (target === null) {
      next[def.op] = { params: { ...active.params } };
    } else {
      const entry: ActiveOp = {
        params: { ...active.params },
        mask: target,
      };
      if (active.invertMask) entry.invertMask = true;
      if (active.maskStrength !== undefined) entry.maskStrength = active.maskStrength;
      next[def.op] = entry;
    }
  }

  return next;
}
