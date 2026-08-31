import type { MaskBitmap } from "./types";

/** A closed polygon in image pixel coordinates: [[x,y], ...]. */
export type Polygon = Array<[number, number]>;

/** Axis-aligned box in image pixel coordinates: [x0, y0, x1, y1]. */
export type Box = [number, number, number, number];

/**
 * Fill polygons into a single-channel float mask. Overlapping polygons OR
 * together (max). Coordinates are in the same space as `width`/`height`.
 */
export function rasterizePolygons(
  polygons: Polygon[],
  width: number,
  height: number,
): MaskBitmap {
  const data = new Float32Array(width * height);
  for (const polygon of polygons) {
    if (polygon.length < 3) continue;
    fillPolygon(data, width, height, polygon);
  }
  return { width, height, data };
}

/** Fill axis-aligned boxes into a mask (inclusive of edges). */
export function rasterizeBoxes(boxes: Box[], width: number, height: number): MaskBitmap {
  const data = new Float32Array(width * height);
  for (const [x0, y0, x1, y1] of boxes) {
    const left = Math.max(0, Math.floor(Math.min(x0, x1)));
    const right = Math.min(width - 1, Math.ceil(Math.max(x0, x1)));
    const top = Math.max(0, Math.floor(Math.min(y0, y1)));
    const bottom = Math.min(height - 1, Math.ceil(Math.max(y0, y1)));
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        data[y * width + x] = 1;
      }
    }
  }
  return { width, height, data };
}

export function maskCoverage(mask: MaskBitmap, threshold = 0.5): number {
  if (mask.data.length === 0) return 0;
  let count = 0;
  for (let i = 0; i < mask.data.length; i += 1) {
    if (mask.data[i]! > threshold) count += 1;
  }
  return count / mask.data.length;
}

/** Nearest-neighbor upscale/downscale for export-sized masks. */
export function resizeMask(mask: MaskBitmap, width: number, height: number): MaskBitmap {
  if (mask.width === width && mask.height === height) {
    return { width, height, data: new Float32Array(mask.data) };
  }
  const data = new Float32Array(width * height);
  const xRatio = mask.width / width;
  const yRatio = mask.height / height;
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(mask.height - 1, Math.floor(y * yRatio));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(mask.width - 1, Math.floor(x * xRatio));
      data[y * width + x] = mask.data[sy * mask.width + sx]!;
    }
  }
  return { width, height, data };
}

function fillPolygon(
  data: Float32Array,
  width: number,
  height: number,
  polygon: Polygon,
): void {
  let minY = height - 1;
  let maxY = 0;
  for (const [, y] of polygon) {
    const yi = Math.floor(y);
    if (yi < minY) minY = yi;
    if (yi > maxY) maxY = yi;
  }
  minY = Math.max(0, minY);
  maxY = Math.min(height - 1, maxY);

  for (let y = minY; y <= maxY; y += 1) {
    const nodes: number[] = [];
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      const [xi, yi] = polygon[i]!;
      const [xj, yj] = polygon[j]!;
      if ((yi < y && yj >= y) || (yj < y && yi >= y)) {
        nodes.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
      }
    }
    nodes.sort((a, b) => a - b);
    for (let i = 0; i + 1 < nodes.length; i += 2) {
      let x0 = Math.ceil(nodes[i]!);
      let x1 = Math.floor(nodes[i + 1]!);
      if (x0 < 0) x0 = 0;
      if (x1 >= width) x1 = width - 1;
      for (let x = x0; x <= x1; x += 1) {
        const idx = y * width + x;
        if (data[idx]! < 1) data[idx] = 1;
      }
    }
  }
}
