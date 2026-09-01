/**
 * The safety property the whole design rests on: whatever a model emits, the
 * editor either rejects it untouched or ends up in a state that is valid by
 * construction. An invalid pipeline must never reach the engine.
 */

import { describe, expect, it } from "vitest";
import { OPERATION_DEFS, opStateToPipeline, type OpState } from "@pixelcam/shared";
import { AGENT_TOOLS, executeTool } from "./tools";

function assertValidFrame(frame: OpState["frame"]): void {
  if (frame === undefined) return;
  expect([0, 90, 180, 270, undefined]).toContain(frame.rotate);
  if (frame.crop !== undefined) {
    for (const value of [frame.crop.x, frame.crop.y, frame.crop.width, frame.crop.height]) {
      expect(typeof value).toBe("number");
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(frame.crop.width).toBeGreaterThan(0);
    expect(frame.crop.height).toBeGreaterThan(0);
    expect(frame.crop.x + frame.crop.width).toBeLessThanOrEqual(1.0001);
    expect(frame.crop.y + frame.crop.height).toBeLessThanOrEqual(1.0001);
  }
}

function assertValidOpState(opState: OpState): void {
  assertValidFrame(opState.frame);
  for (const [op, entry] of Object.entries(opState)) {
    if (op === "frame") continue;
    const active = entry as import("@pixelcam/shared").ActiveOp | undefined;
    const def = OPERATION_DEFS.find((candidate) => candidate.op === op);
    expect(def, `pipeline contains unknown operation "${op}"`).toBeDefined();
    expect(active, `"${op}" entry must be defined`).toBeDefined();
    for (const [key, value] of Object.entries(active!.params ?? {})) {
      const param = def!.params[key];
      expect(param, `"${op}" has no parameter "${key}"`).toBeDefined();
      if (param!.kind === "slider") {
        expect(typeof value).toBe("number");
        expect(Number.isFinite(value as number)).toBe(true);
        expect(value as number).toBeGreaterThanOrEqual(param!.min);
        expect(value as number).toBeLessThanOrEqual(param!.max);
      } else {
        expect(param!.options).toContain(value as string);
      }
    }
    if (active!.mask !== undefined) {
      expect(typeof active!.mask).toBe("string");
      expect(active!.mask.length).toBeGreaterThan(0);
    }
    if (active!.invertMask !== undefined) {
      expect(active!.invertMask).toBe(true);
      expect(active!.mask).toBeDefined();
    }
    if (active!.maskStrength !== undefined) {
      expect(active!.mask).toBeDefined();
      expect(typeof active!.maskStrength).toBe("number");
      expect(active!.maskStrength).toBeGreaterThanOrEqual(0);
      expect(active!.maskStrength).toBeLessThanOrEqual(1);
    }
  }
}

const HOSTILE_VALUES: unknown[] = [
  0,
  1,
  -1,
  0.5,
  1e9,
  -1e9,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  "0.5",
  "a lot",
  "",
  true,
  false,
  null,
  undefined,
  [],
  [0.5],
  {},
  { amount: 0.5 },
];

const HOSTILE_OPS: unknown[] = [
  "exposure",
  "grain",
  "tone_curve",
  "Exposure",
  "exposure ",
  "sharpen",
  "",
  null,
  undefined,
  42,
  ["exposure"],
  { op: "exposure" },
];

const HOSTILE_KEYS = ["amount", "size", "preset", "strength", "amount", "", "__proto__", "0"];

const STARTING_STATES: OpState[] = [
  {},
  { exposure: { params: { amount: 0.2 } } },
  {
    grain: { params: { amount: 0.65, size: 1.4 } },
    vignette: { params: { amount: 0.3, size: 0.55 } },
  },
];

describe("tool execution invariants", () => {
  it("either rejects hostile set_operations arguments or produces a valid edit", async () => {
    let accepted = 0;
    let rejected = 0;

    for (const before of STARTING_STATES) {
      for (const op of HOSTILE_OPS) {
        for (const key of HOSTILE_KEYS) {
          for (const value of HOSTILE_VALUES) {
            const outcome = await executeTool(
              "set_operations",
              { operations: [{ op, params: { [key]: value } }] },
              { opState: before },
            );
            if (outcome.result.ok) {
              accepted += 1;
              assertValidOpState(outcome.opState);
              // Untouched operations must survive verbatim.
              for (const [existingOp, params] of Object.entries(before)) {
                if (existingOp !== op) {
                  expect(outcome.opState[existingOp as keyof OpState]).toEqual(params);
                }
              }
            } else {
              rejected += 1;
              expect(outcome.opState).toEqual(before);
              expect(outcome.changed).toBe(false);
              expect(outcome.result.error.length).toBeGreaterThan(0);
            }
          }
        }
      }
    }

    // Both branches must actually be exercised, or this test proves nothing.
    expect(accepted).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
  });

  it("never throws, whatever tool name and arguments arrive", async () => {
    const names = [...AGENT_TOOLS.map((tool) => tool.name), "", "not_a_tool", "DROP TABLE"];
    const payloads: unknown[] = [
      undefined,
      null,
      "",
      "{}",
      "[]",
      "null",
      "{oops",
      '"a string"',
      "123",
      { operations: "grain" },
      { operations: [null] },
      { ops: "grain" },
      { ops: [] },
      { preset: 7 },
      { unexpected: true },
      [],
    ];

    for (const before of STARTING_STATES) {
      for (const name of names) {
        for (const payload of payloads) {
          const outcome = await executeTool(name, payload, { opState: before });
          assertValidOpState(outcome.opState);
          const version = opStateToPipeline(outcome.opState).version;
          expect(version === 1 || version === 2 || version === 3).toBe(true);
          if (!outcome.result.ok) {
            expect(outcome.opState).toEqual(before);
          }
        }
      }
    }
  });
});
