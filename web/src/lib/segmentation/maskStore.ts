import {
  isParametricMaskSource,
  type MaskDeclaration,
  type MaskParams,
  type MaskSourceKind,
} from "@pixelcam/shared";
import type { MaskBitmap } from "./types";
import { maskCoverage, resizeMask } from "./rasterize";

export type StoredMask = {
  id: string;
  prompt: string;
  mask: MaskBitmap;
  coverage: number;
  feather: number;
  segmenterId: string;
  /** When set, this mask is the complement of another stored mask. */
  invertedFrom?: string;
  source: MaskSourceKind;
  params?: MaskParams;
};

/**
 * In-memory mask cache for the open photo. Keys are normalized prompts;
 * ids are stable handles the pipeline and agent refer to.
 */
export class MaskStore {
  private byPrompt = new Map<string, StoredMask>();
  private byId = new Map<string, StoredMask>();
  private photoKey: string | null = null;
  private nextIndex = 1;

  /** Drop every mask when the open photo changes. */
  setPhoto(photoKey: string): void {
    if (this.photoKey === photoKey) return;
    this.photoKey = photoKey;
    this.clear();
  }

  clear(): void {
    this.byPrompt.clear();
    this.byId.clear();
    this.nextIndex = 1;
  }

  get(id: string): StoredMask | undefined {
    return this.byId.get(id);
  }

  getByPrompt(prompt: string): StoredMask | undefined {
    return this.byPrompt.get(normalizePrompt(prompt));
  }

  list(): StoredMask[] {
    return [...this.byId.values()];
  }

  /** Pipeline JSON declarations, including parametric sources. */
  declarations(): MaskDeclaration[] {
    return this.list().map((m) => ({
      id: m.id,
      source: m.source,
      prompt: m.prompt,
      feather: m.feather,
      ...(m.params ? { params: m.params } : {}),
    }));
  }

  put(input: {
    prompt: string;
    mask: MaskBitmap;
    segmenterId: string;
    feather?: number;
    preferredId?: string;
    invertedFrom?: string;
    source?: MaskSourceKind;
    params?: MaskParams;
  }): StoredMask {
    const promptKey = normalizePrompt(input.prompt);
    const existing = this.byPrompt.get(promptKey);
    if (existing) {
      this.byId.delete(existing.id);
    }

    const id =
      existing?.id ??
      sanitizeMaskId(input.preferredId) ??
      suggestIdFromPrompt(input.prompt) ??
      `mask_${this.nextIndex++}`;

    // Avoid colliding with a different prompt's id.
    let finalId = id;
    if (this.byId.has(finalId) && this.byId.get(finalId)?.prompt !== input.prompt) {
      finalId = `${id}_${this.nextIndex++}`;
    }

    const stored: StoredMask = {
      id: finalId,
      prompt: input.prompt.trim(),
      mask: input.mask,
      coverage: maskCoverage(input.mask),
      feather: input.feather ?? 0.02,
      segmenterId: input.segmenterId,
      ...(input.invertedFrom ? { invertedFrom: input.invertedFrom } : {}),
      source:
        input.source ??
        (input.invertedFrom ? "invert" : "segmentation"),
      ...(input.params ? { params: input.params } : {}),
    };
    this.byPrompt.set(promptKey, stored);
    this.byId.set(finalId, stored);
    return stored;
  }

  /**
   * Create (or refresh) a selectable complement of an existing mask.
   * Pixel values become `1 - v`; the new id is preferred as `not_<sourceId>`.
   */
  invert(
    sourceId: string,
  ): (StoredMask & { sourceMaskId: string }) | { error: string } {
    const source = this.byId.get(sourceId.trim());
    if (!source) {
      const known = [...this.byId.keys()].join(", ") || "(none)";
      return { error: `unknown mask "${sourceId}". Known masks: ${known}.` };
    }

    const data = new Float32Array(source.mask.data.length);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = 1 - (source.mask.data[i] ?? 0);
    }

    const stored = this.put({
      prompt: invertPrompt(source.prompt),
      mask: { width: source.mask.width, height: source.mask.height, data },
      segmenterId: source.segmenterId,
      feather: source.feather,
      preferredId: `not_${source.id}`,
      invertedFrom: source.id,
    });
    return { ...stored, sourceMaskId: source.id };
  }

  /** Build the float buffer map the engine worker expects, optionally resized.
   * Parametric masks are omitted — the engine generates them from the pipeline JSON.
   */
  toEngineMasks(width: number, height: number): { ids: string[]; data: Float32Array } {
    const masks = this.list().filter((m) => !isParametricMaskSource(m.source));
    const ids = masks.map((m) => m.id);
    const plane = width * height;
    const data = new Float32Array(ids.length * plane);
    masks.forEach((stored, index) => {
      const resized = resizeMask(stored.mask, width, height);
      data.set(resized.data, index * plane);
    });
    return { ids, data };
  }
}

function invertPrompt(prompt: string): string {
  return `everything except ${prompt.trim()}`;
}

function normalizePrompt(prompt: string): string {
  return prompt.trim().toLowerCase().replace(/\s+/g, " ");
}

function sanitizeMaskId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const cleaned = id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || undefined;
}

function suggestIdFromPrompt(prompt: string): string | undefined {
  const words = normalizePrompt(prompt)
    .replace(/^(the|a|an)\s+/i, "")
    .split(" ")
    .filter(Boolean);
  if (words.length === 0) return undefined;
  const candidate = words[words.length - 1]!;
  return sanitizeMaskId(candidate);
}
