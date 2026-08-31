import { describe, expect, it } from "vitest";
import { extractPolygonsFromText } from "./florenceParse";

describe("extractPolygonsFromText", () => {
  it("parses a <poly> block into pixel coordinates", () => {
    // Bins at the four corners of a 1000-bin space on a 100×200 image.
    const text =
      "<poly><loc_0><loc_0><loc_999><loc_0><loc_999><loc_999><loc_0><loc_999></poly>";
    const polygons = extractPolygonsFromText(text, 100, 200);
    expect(polygons).toHaveLength(1);
    expect(polygons[0]).toHaveLength(4);
    expect(polygons[0]![0]![0]).toBeCloseTo(0.05, 2);
    expect(polygons[0]![0]![1]).toBeCloseTo(0.1, 2);
    expect(polygons[0]![2]![0]).toBeCloseTo(99.95, 2);
    expect(polygons[0]![2]![1]).toBeCloseTo(199.9, 2);
  });

  it("splits multiple polygons on <sep>", () => {
    const text =
      "<loc_10><loc_10><loc_20><loc_10><loc_20><loc_20><sep><loc_30><loc_30><loc_40><loc_30><loc_40><loc_40>";
    const polygons = extractPolygonsFromText(text, 1000, 1000);
    expect(polygons).toHaveLength(2);
    expect(polygons[0]).toHaveLength(3);
    expect(polygons[1]).toHaveLength(3);
  });

  it("ignores short loc runs that would only form a box", () => {
    const text = "person<loc_10><loc_20><loc_30><loc_40>";
    expect(extractPolygonsFromText(text, 100, 100)).toEqual([]);
  });

  it("strips special tokens before parsing", () => {
    const text =
      "<s><poly><loc_0><loc_0><loc_10><loc_0><loc_10><loc_10></poly></s>";
    expect(extractPolygonsFromText(text, 1000, 1000)).toHaveLength(1);
  });
});
