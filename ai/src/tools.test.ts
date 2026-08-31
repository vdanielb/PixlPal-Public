import { describe, expect, it } from "vitest";
import { OPERATION_DEFS, type OpState } from "@pixelcam/shared";
import { AGENT_TOOLS, TOOL_NAMES, executeTool, type InvertMaskHost, type SegmentHost, type ToolOutcome } from "./tools";
import type { ImageStats } from "./types";

const STATS: ImageStats = {
  width: 1100,
  height: 733,
  meanLuma: 0.28,
  blackPoint: 0.02,
  whitePoint: 0.81,
  clippedShadows: 0.031,
  clippedHighlights: 0.004,
  meanSaturation: 0.12,
  colorCast: -0.22,
};

async function run(
  name: string,
  args: unknown,
  opState: OpState = {},
  imageStats?: ImageStats,
  segment?: SegmentHost,
  invertMask?: InvertMaskHost,
): Promise<ToolOutcome> {
  return executeTool(name, JSON.stringify(args), { opState, imageStats, segment, invertMask });
}

function expectOk(outcome: ToolOutcome) {
  if (!outcome.result.ok) throw new Error(`expected success, got: ${outcome.result.error}`);
  return outcome.result;
}

function expectErr(outcome: ToolOutcome) {
  if (outcome.result.ok) throw new Error(`expected failure, got: ${outcome.result.summary}`);
  return outcome.result;
}

describe("set_operations", () => {
  it("activates an operation at its defaults when no params are given", async () => {
    const outcome = await run(TOOL_NAMES.setOperations, { operations: [{ op: "grain" }] });
    expectOk(outcome);
    expect(outcome.opState.grain).toEqual({ params: { amount: 0.5, size: 1 } });
    expect(outcome.changed).toBe(true);
  });

  it("merges into existing params so a single knob can be nudged", async () => {
    const outcome = await run(
      TOOL_NAMES.setOperations,
      { operations: [{ op: "grain", params: { amount: 0.2 } }] },
      { grain: { params: { amount: 0.65, size: 1.4 } } },
    );
    expectOk(outcome);
    expect(outcome.opState.grain).toEqual({ params: { amount: 0.2, size: 1.4 } });
  });

  it("leaves untouched operations alone", async () => {
    const outcome = await run(
      TOOL_NAMES.setOperations,
      { operations: [{ op: "exposure", params: { amount: 0.1 } }] },
      { vignette: { params: { amount: 0.3, size: 0.5 } } },
    );
    expectOk(outcome);
    expect(outcome.opState.vignette).toEqual({ params: { amount: 0.3, size: 0.5 } });
  });

  it("applies several operations in one call", async () => {
    const outcome = await run(TOOL_NAMES.setOperations, {
      operations: [
        { op: "saturation", params: { amount: -0.4 } },
        { op: "vignette", params: { amount: 0.3 } },
      ],
    });
    expectOk(outcome);
    expect(Object.keys(outcome.opState)).toEqual(["saturation", "vignette"]);
  });

  it("clamps out-of-range values and reports the clamp as a warning", async () => {
    const outcome = await run(TOOL_NAMES.setOperations, {
      operations: [{ op: "exposure", params: { amount: 3 } }],
    });
    const result = expectOk(outcome);
    expect(outcome.opState.exposure).toEqual({ params: { amount: 1 } });
    expect(result.warnings?.[0]).toContain("clamped from 3 to 1");
  });

  it("snaps values to the slider step so the UI and JSON agree", async () => {
    const outcome = await run(TOOL_NAMES.setOperations, {
      operations: [{ op: "grain", params: { amount: 0.6666, size: 1.43 } }],
    });
    expectOk(outcome);
    expect(outcome.opState.grain).toEqual({ params: { amount: 0.67, size: 1.4 } });
  });

  it("attaches a mask id from a prior segment call", async () => {
    const outcome = await run(TOOL_NAMES.setOperations, {
      operations: [
        { op: "saturation", params: { amount: 0.4 }, mask: "dress" },
        { op: "exposure", params: { amount: -0.2 }, mask: "dress", invertMask: true },
      ],
    });
    expectOk(outcome);
    expect(outcome.opState.saturation).toEqual({
      params: { amount: 0.4 },
      mask: "dress",
    });
    expect(outcome.opState.exposure).toEqual({
      params: { amount: -0.2 },
      mask: "dress",
      invertMask: true,
    });
    const pipeline = expectOk(outcome).data?.pipeline as {
      version: number;
      operations: { op: string; mask?: string; invertMask?: boolean }[];
    };
    expect(pipeline.version).toBe(2);
    expect(pipeline.operations[0]?.mask).toBe("dress");
  });

  it("accepts maskStrength and dodge_burn for local tone", async () => {
    const outcome = await run(TOOL_NAMES.setOperations, {
      operations: [
        {
          op: "dodge_burn",
          params: { amount: 0.35, range: "midtones" },
          mask: "dress",
          maskStrength: 0.85,
        },
      ],
    });
    expectOk(outcome);
    expect(outcome.opState.dodge_burn).toEqual({
      params: { amount: 0.35, range: "midtones" },
      mask: "dress",
      maskStrength: 0.85,
    });
    const pipeline = expectOk(outcome).data?.pipeline as {
      version: number;
      operations: { maskStrength?: number }[];
    };
    expect(pipeline.version).toBe(2);
    expect(pipeline.operations[0]?.maskStrength).toBe(0.85);
  });

  it("rejects maskStrength without a mask", async () => {
    const outcome = await run(TOOL_NAMES.setOperations, {
      operations: [{ op: "exposure", params: { amount: 0.2 }, maskStrength: 0.5 }],
    });
    expect(expectErr(outcome).error).toContain("maskStrength");
  });

  it("returns the resulting pipeline in canonical order", async () => {
    const outcome = await run(TOOL_NAMES.setOperations, {
      operations: [
        { op: "vignette", params: { amount: 0.3 } },
        { op: "exposure", params: { amount: 0.1 } },
      ],
    });
    const result = expectOk(outcome);
    const pipeline = result.data?.pipeline as { version: number; operations: { op: string }[] };
    expect(pipeline.version).toBe(1);
    expect(pipeline.operations.map((operation) => operation.op)).toEqual(["exposure", "vignette"]);
  });

  it("rejects an unknown operation and lists the valid ones", async () => {
    const outcome = await run(TOOL_NAMES.setOperations, { operations: [{ op: "sharpen_9000" }] });
    const result = expectErr(outcome);
    expect(result.error).toContain('unknown operation "sharpen_9000"');
    expect(result.error).toContain("exposure");
    expect(outcome.changed).toBe(false);
  });

  it("rejects a parameter the operation does not have", async () => {
    const outcome = await run(TOOL_NAMES.setOperations, {
      operations: [{ op: "exposure", params: { strength: 0.5 } }],
    });
    expect(expectErr(outcome).error).toContain('"exposure" has no parameter "strength"');
  });

  it("rejects a non-numeric slider value", async () => {
    const outcome = await run(TOOL_NAMES.setOperations, {
      operations: [{ op: "exposure", params: { amount: "lots" } }],
    });
    expect(expectErr(outcome).error).toContain('"exposure.amount" must be a number');
  });

  it("rejects a select value outside its options", async () => {
    const outcome = await run(TOOL_NAMES.setOperations, {
      operations: [{ op: "tone_curve", params: { preset: "cinematic" } }],
    });
    expect(expectErr(outcome).error).toContain("linear, soft, hard, film");
  });

  it("leaves the edit untouched when any operation in the batch is invalid", async () => {
    const before: OpState = { exposure: { params: { amount: 0.2 } } };
    const outcome = await run(
      TOOL_NAMES.setOperations,
      { operations: [{ op: "saturation", params: { amount: 0.3 } }, { op: "nope" }] },
      before,
    );
    expectErr(outcome);
    expect(outcome.opState).toEqual(before);
  });

  it("rejects an empty or missing operations array", async () => {
    expect(expectErr(await run(TOOL_NAMES.setOperations, { operations: [] })).error).toContain(
      "non-empty array",
    );
    expect(expectErr(await run(TOOL_NAMES.setOperations, {})).error).toContain("non-empty array");
  });
});

describe("remove_operations", () => {
  it("removes active operations", async () => {
    const outcome = await run(
      TOOL_NAMES.removeOperations,
      { ops: ["grain"] },
      {
        grain: { params: { amount: 0.5 } },
        exposure: { params: { amount: 0.1 } },
      },
    );
    expect(expectOk(outcome).summary).toContain("Removed grain");
    expect(outcome.opState).toEqual({ exposure: { params: { amount: 0.1 } } });
  });

  it("reports operations that were not active without failing", async () => {
    const outcome = await run(TOOL_NAMES.removeOperations, { ops: ["grain"] }, {});
    expect(expectOk(outcome).summary).toContain("Already inactive: grain");
    expect(outcome.changed).toBe(false);
  });

  it("rejects unknown operation names", async () => {
    expect(expectErr(await run(TOOL_NAMES.removeOperations, { ops: ["glow"] })).error).toContain(
      'unknown operation "glow"',
    );
  });
});

describe("reset_edits", () => {
  it("clears every adjustment", async () => {
    const outcome = await run(TOOL_NAMES.resetEdits, {}, { grain: { params: { amount: 0.5 } } });
    expectOk(outcome);
    expect(outcome.opState).toEqual({});
    expect(outcome.changed).toBe(true);
  });

  it("is a no-op when there is nothing to clear", async () => {
    const outcome = await run(TOOL_NAMES.resetEdits, {}, {});
    expect(expectOk(outcome).summary).toContain("no adjustments");
    expect(outcome.changed).toBe(false);
  });
});

describe("get_image_stats", () => {
  it("describes the photo in plain language and returns the raw numbers", async () => {
    const outcome = await run(TOOL_NAMES.getImageStats, {}, {}, STATS);
    const result = expectOk(outcome);
    expect(result.summary).toContain("1100x733");
    expect(result.summary).toContain("dark");
    expect(result.summary).toContain("cool");
    expect(result.data?.stats).toEqual(STATS);
    expect(outcome.changed).toBe(false);
  });

  it("fails cleanly when no photo is open", async () => {
    expect(expectErr(await run(TOOL_NAMES.getImageStats, {}, {})).error).toContain(
      "no photo is open",
    );
  });
});

describe("segment", () => {
  it("returns a mask id from the host callback without changing the edit", async () => {
    const segment: SegmentHost = async (prompt) => ({
      maskId: prompt.includes("dress") ? "dress" : "subject",
      coverage: 0.18,
    });
    const before: OpState = { grain: { params: { amount: 0.4, size: 1 } } };
    const outcome = await run(
      TOOL_NAMES.segment,
      { prompt: "the red dress" },
      before,
      undefined,
      segment,
    );
    const result = expectOk(outcome);
    expect(result.data).toEqual({ maskId: "dress", coverage: 0.18 });
    expect(result.summary).toContain('mask "dress"');
    expect(outcome.opState).toEqual(before);
    expect(outcome.changed).toBe(false);
  });

  it("surfaces host errors as tool errors", async () => {
    const segment: SegmentHost = async () => ({ error: 'could not find "unicorn"' });
    const outcome = await run(
      TOOL_NAMES.segment,
      { prompt: "unicorn" },
      {},
      undefined,
      segment,
    );
    expect(expectErr(outcome).error).toContain("unicorn");
  });

  it("fails when the host did not inject segmentation", async () => {
    const outcome = await run(TOOL_NAMES.segment, { prompt: "sky" });
    expect(expectErr(outcome).error).toContain("not available");
  });
});

describe("invert_mask", () => {
  it("returns a complement mask id from the host without changing the edit", async () => {
    const invertMask: InvertMaskHost = async (maskId) => ({
      maskId: `not_${maskId}`,
      coverage: 0.82,
      sourceMaskId: maskId,
    });
    const before: OpState = { grain: { params: { amount: 0.4, size: 1 } } };
    const outcome = await run(
      TOOL_NAMES.invertMask,
      { maskId: "person" },
      before,
      undefined,
      undefined,
      invertMask,
    );
    const result = expectOk(outcome);
    expect(result.data).toEqual({
      maskId: "not_person",
      coverage: 0.82,
      sourceMaskId: "person",
    });
    expect(result.summary).toContain('inverse of mask "person"');
    expect(result.summary).toContain('"not_person"');
    expect(outcome.opState).toEqual(before);
    expect(outcome.changed).toBe(false);
  });

  it("surfaces host errors as tool errors", async () => {
    const invertMask: InvertMaskHost = async () => ({ error: 'unknown mask "missing"' });
    const outcome = await run(
      TOOL_NAMES.invertMask,
      { maskId: "missing" },
      {},
      undefined,
      undefined,
      invertMask,
    );
    expect(expectErr(outcome).error).toContain("missing");
  });

  it("fails when the host did not inject invert", async () => {
    const outcome = await run(TOOL_NAMES.invertMask, { maskId: "person" });
    expect(expectErr(outcome).error).toContain("not available");
  });

  it("rejects an empty maskId", async () => {
    const invertMask: InvertMaskHost = async () => ({
      maskId: "not_x",
      coverage: 0.5,
      sourceMaskId: "x",
    });
    const outcome = await run(
      TOOL_NAMES.invertMask,
      { maskId: "  " },
      {},
      undefined,
      undefined,
      invertMask,
    );
    expect(expectErr(outcome).error).toContain("maskId");
  });
});

describe("argument handling", () => {
  it("treats malformed JSON as a recoverable tool error", async () => {
    const outcome = await executeTool(TOOL_NAMES.setOperations, "{oops", { opState: {} });
    expect(expectErr(outcome).error).toContain("not valid JSON");
  });

  it("accepts empty arguments for tools that take none", async () => {
    expectOk(await executeTool(TOOL_NAMES.resetEdits, "", { opState: {} }));
    expectOk(await executeTool(TOOL_NAMES.resetEdits, undefined, { opState: {} }));
  });

  it("accepts already-parsed argument objects", async () => {
    const outcome = await executeTool(
      TOOL_NAMES.setOperations,
      { operations: [{ op: "contrast", params: { amount: 0.25 } }] },
      { opState: {} },
    );
    expectOk(outcome);
    expect(outcome.opState.contrast).toEqual({ params: { amount: 0.25 } });
  });

  it("rejects a hallucinated tool name and lists the real ones", async () => {
    const outcome = await executeTool("crop_image", "{}", { opState: {} });
    const result = expectErr(outcome);
    expect(result.error).toContain('unknown tool "crop_image"');
    expect(result.error).toContain(TOOL_NAMES.setOperations);
  });
});

describe("tool schemas", () => {
  it("advertises exactly the tools the executor implements", async () => {
    for (const tool of AGENT_TOOLS) {
      const outcome = await executeTool(tool.name, "{}", { opState: {} });
      const failedAsUnknown = !outcome.result.ok && outcome.result.error.includes("unknown tool");
      expect(failedAsUnknown).toBe(false);
    }
    expect(AGENT_TOOLS.map((tool) => tool.name).sort()).toEqual(
      Object.values(TOOL_NAMES).slice().sort(),
    );
  });

  it("derives the operation enum and every parameter name from the operation metadata", () => {
    const setOperations = AGENT_TOOLS.find((tool) => tool.name === TOOL_NAMES.setOperations);
    const items = (setOperations?.parameters as any).properties.operations.items;
    expect(items.properties.op.enum).toEqual(OPERATION_DEFS.map((def) => def.op));

    const paramNames = new Set(OPERATION_DEFS.flatMap((def) => Object.keys(def.params)));
    expect(Object.keys(items.properties.params.properties).sort()).toEqual([...paramNames].sort());
    expect(items.properties.mask).toBeDefined();
    expect(items.properties.invertMask).toBeDefined();
    expect(items.properties.maskStrength).toBeDefined();
    expect(items.properties.op.enum).toContain("dodge_burn");
  });

  it("advertises invert_mask with a maskId parameter", () => {
    const invert = AGENT_TOOLS.find((tool) => tool.name === TOOL_NAMES.invertMask);
    expect(invert).toBeDefined();
    expect((invert?.parameters as any).properties.maskId).toBeDefined();
    expect((invert?.parameters as any).required).toEqual(["maskId"]);
  });
});
