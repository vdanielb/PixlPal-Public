import { describe, expect, it } from "vitest";
import {
  mergeOpStateForMask,
  projectOpStateForMask,
  type OpState,
} from "@pixelcam/shared";

describe("projectOpStateForMask / mergeOpStateForMask", () => {
  const full: OpState = {
    exposure: { params: { amount: 0.2 } },
    saturation: { params: { amount: 0.4 }, mask: "dress" },
    contrast: { params: { amount: 0.1 }, mask: "sky", invertMask: true },
  };

  it("projects whole-image ops when target is null", () => {
    expect(projectOpStateForMask(full, null)).toEqual({
      exposure: { params: { amount: 0.2 } },
    });
  });

  it("projects only ops bound to the selected mask", () => {
    expect(projectOpStateForMask(full, "dress")).toEqual({
      saturation: { params: { amount: 0.4 }, mask: "dress" },
    });
  });

  it("merges whole-image edits without attaching a mask", () => {
    const projected: OpState = {
      exposure: { params: { amount: -0.1 } },
      grain: { params: { amount: 0.3, size: 1.5 } },
    };
    expect(mergeOpStateForMask(full, projected, null)).toEqual({
      exposure: { params: { amount: -0.1 } },
      saturation: { params: { amount: 0.4 }, mask: "dress" },
      contrast: { params: { amount: 0.1 }, mask: "sky", invertMask: true },
      grain: { params: { amount: 0.3, size: 1.5 } },
    });
  });

  it("merges mask edits and forces the selected mask id", () => {
    const projected: OpState = {
      saturation: { params: { amount: 0.55 }, maskStrength: 0.8 },
    };
    const next = mergeOpStateForMask(full, projected, "dress");
    expect(next.saturation).toEqual({
      params: { amount: 0.55 },
      mask: "dress",
      maskStrength: 0.8,
    });
    expect(next.exposure).toEqual({ params: { amount: 0.2 } });
    expect(next.contrast?.mask).toBe("sky");
  });

  it("removes ops cleared in the projected panel for that target", () => {
    const next = mergeOpStateForMask(full, {}, "dress");
    expect(next.saturation).toBeUndefined();
    expect(next.exposure).toEqual({ params: { amount: 0.2 } });
  });
});
