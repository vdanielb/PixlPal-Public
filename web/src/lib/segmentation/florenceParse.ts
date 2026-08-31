import type { Polygon } from "./rasterize";

/** Florence-2 quantizes coordinates into this many bins per axis. */
export const FLORENCE_SIZE_PER_BIN = 1000;

/**
 * Parse Florence-2 referring-expression / region-to-segmentation output into
 * polygons. Transformers.js does not post-process the `polygons` task type yet,
 * so we decode the raw `<loc_N>` stream ourselves (same scheme as the Python
 * Florence2Processor).
 *
 * Recognized shapes:
 * - `<poly>…</poly>` blocks (preferred)
 * - `<sep>`-separated loc runs
 * - bare runs of 6+ loc tokens (3+ vertices)
 */
export function extractPolygonsFromText(
  text: string,
  width: number,
  height: number,
): Polygon[] {
  const cleaned = text
    .replaceAll("<s>", "")
    .replaceAll("</s>", "")
    .replaceAll("<pad>", "");

  const polygons: Polygon[] = [];
  const polyBlocks = [...cleaned.matchAll(/<poly>(.*?)<\/poly>/g)].map((m) => m[1]!);
  const chunks =
    polyBlocks.length > 0
      ? polyBlocks.flatMap((block) => block.split(/<sep>/))
      : cleaned.split(/<sep>/);

  for (const chunk of chunks) {
    for (const run of chunk.matchAll(/((?:<loc_\d+>){6,})/g)) {
      const polygon = locRunToPolygon(run[1]!, width, height);
      if (polygon) polygons.push(polygon);
    }
  }

  return polygons;
}

function locRunToPolygon(run: string, width: number, height: number): Polygon | null {
  let bins = [...run.matchAll(/<loc_(\d+)>/g)].map((m) => Number(m[1]));
  if (bins.some((n) => !Number.isFinite(n))) return null;
  // Drop a trailing odd coordinate if the model emitted one.
  if (bins.length % 2 === 1) bins = bins.slice(0, -1);
  if (bins.length < 6) return null;

  const points: Polygon = [];
  for (let i = 0; i + 1 < bins.length; i += 2) {
    points.push([
      clamp(((bins[i]! + 0.5) / FLORENCE_SIZE_PER_BIN) * width, 0, width - 1e-3),
      clamp(((bins[i + 1]! + 0.5) / FLORENCE_SIZE_PER_BIN) * height, 0, height - 1e-3),
    ]);
  }
  return points.length >= 3 ? points : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
