/**
 * On-device measurement of the open photo.
 *
 * Complements the JPEG preview attached to each user turn with precise
 * numbers the agent can reason about (clipping, cast, black/white points).
 */

import type { ImageStats } from "@pixelcam/ai";

/** Sample at most this many pixels; plenty for stable statistics. */
const MAX_SAMPLES = 40_000;

const CLIP_LOW = 2 / 255;
const CLIP_HIGH = 253 / 255;

function percentile(histogram: Uint32Array, total: number, fraction: number): number {
  const target = total * fraction;
  let seen = 0;
  for (let bin = 0; bin < histogram.length; bin += 1) {
    seen += histogram[bin];
    if (seen >= target) return bin / (histogram.length - 1);
  }
  return 1;
}

export function analyzeImage(image: ImageData): ImageStats {
  const { data, width, height } = image;
  const pixelCount = width * height;
  const stride = Math.max(1, Math.floor(pixelCount / MAX_SAMPLES));

  const histogram = new Uint32Array(256);
  let sampled = 0;
  let lumaSum = 0;
  let saturationSum = 0;
  let redSum = 0;
  let blueSum = 0;
  let clippedShadows = 0;
  let clippedHighlights = 0;

  for (let index = 0; index < pixelCount; index += stride) {
    const offset = index * 4;
    const r = data[offset] / 255;
    const g = data[offset + 1] / 255;
    const b = data[offset + 2] / 255;

    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);

    histogram[Math.min(255, Math.round(luma * 255))] += 1;
    lumaSum += luma;
    saturationSum += max > 0 ? (max - min) / max : 0;
    redSum += r;
    blueSum += b;
    if (luma <= CLIP_LOW) clippedShadows += 1;
    if (luma >= CLIP_HIGH) clippedHighlights += 1;
    sampled += 1;
  }

  const safe = Math.max(1, sampled);
  const round = (value: number) => Number(value.toFixed(4));

  return {
    width,
    height,
    meanLuma: round(lumaSum / safe),
    blackPoint: round(percentile(histogram, safe, 0.01)),
    whitePoint: round(percentile(histogram, safe, 0.99)),
    clippedShadows: round(clippedShadows / safe),
    clippedHighlights: round(clippedHighlights / safe),
    meanSaturation: round(saturationSum / safe),
    // Red-vs-blue energy, scaled so a strong cast lands near ±1 rather than
    // the ±0.1 that raw channel means would produce.
    colorCast: round(Math.max(-1, Math.min(1, ((redSum - blueSum) / safe) * 4))),
  };
}
