import { describe, expect, it } from "vitest";
import { MaskStore } from "./maskStore";
import type { MaskBitmap } from "./types";

function bitmap(values: number[], width = 2, height = 2): MaskBitmap {
  return { width, height, data: Float32Array.from(values) };
}

describe("MaskStore.invert", () => {
  it("creates a selectable complement with inverted coverage", () => {
    const store = new MaskStore();
    const source = store.put({
      prompt: "the person",
      mask: bitmap([1, 1, 0, 0]),
      segmenterId: "test",
      preferredId: "person",
    });

    const inverted = store.invert(source.id);
    expect("error" in inverted).toBe(false);
    if ("error" in inverted) return;

    expect(inverted.id).toBe("not_person");
    expect(inverted.sourceMaskId).toBe("person");
    expect(inverted.invertedFrom).toBe("person");
    expect(inverted.prompt).toBe("everything except the person");
    expect([...inverted.mask.data]).toEqual([0, 0, 1, 1]);
    expect(inverted.coverage).toBeCloseTo(0.5);
    expect(store.get(source.id)?.mask.data[0]).toBe(1);
  });

  it("refreshes an existing complement instead of minting a new id", () => {
    const store = new MaskStore();
    store.put({
      prompt: "sky",
      mask: bitmap([1, 0, 0, 0]),
      segmenterId: "test",
      preferredId: "sky",
    });
    const first = store.invert("sky");
    expect("error" in first).toBe(false);
    if ("error" in first) return;

    store.put({
      prompt: "sky",
      mask: bitmap([1, 1, 0, 0]),
      segmenterId: "test",
      preferredId: "sky",
    });
    const second = store.invert("sky");
    expect("error" in second).toBe(false);
    if ("error" in second) return;

    expect(second.id).toBe(first.id);
    expect([...second.mask.data]).toEqual([0, 0, 1, 1]);
  });

  it("errors on an unknown mask id and lists known ones", () => {
    const store = new MaskStore();
    store.put({
      prompt: "dress",
      mask: bitmap([1, 0, 0, 0]),
      segmenterId: "test",
      preferredId: "dress",
    });
    const result = store.invert("missing");
    expect(result).toEqual(
      expect.objectContaining({
        error: expect.stringContaining('unknown mask "missing"'),
      }),
    );
    if ("error" in result) {
      expect(result.error).toContain("dress");
    }
  });
});
