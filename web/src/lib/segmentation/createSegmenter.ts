import { Florence2Segmenter } from "./florence2Segmenter";
import { DEFAULT_SEGMENTER_ID, type Segmenter, type SegmenterId } from "./types";

const registry: Record<SegmenterId, () => Segmenter> = {
  "florence2-base-ft": () => new Florence2Segmenter(),
};

/** Construct a Segmenter by id. Default is Florence-2-base-ft. */
export function createSegmenter(id: SegmenterId = DEFAULT_SEGMENTER_ID): Segmenter {
  const factory = registry[id];
  if (!factory) {
    throw new Error(`Unknown segmenter "${id}". Known: ${Object.keys(registry).join(", ")}`);
  }
  return factory();
}

export function listSegmenterIds(): SegmenterId[] {
  return Object.keys(registry) as SegmenterId[];
}
