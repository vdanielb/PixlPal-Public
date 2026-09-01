/**
 * The frame transform: non-destructive rotate + crop, applied by the engine
 * *after* every filter operation. Filter ops (and their masks) always work in
 * the original image space; the frame then reorients and trims the result.
 *
 * Crop rectangles are normalized (0..1 fractions of the *rotated* image), so
 * the same frame applies identically to the preview and the full-resolution
 * export.
 */

export type FrameRotation = 0 | 90 | 180 | 270;

export const FRAME_ROTATIONS: readonly FrameRotation[] = [0, 90, 180, 270];

/** Normalized crop rectangle in rotated-image space; all values 0..1. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameTransform {
  /** Clockwise rotation applied before the crop. Default 0. */
  rotate?: FrameRotation;
  /** Normalized crop in the rotated frame. Omitted = keep the whole frame. */
  crop?: CropRect;
}

/** Smallest crop side we allow, as a fraction of the image. */
export const MIN_CROP_SIZE = 0.02;

export function isFrameRotation(value: unknown): value is FrameRotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

/** Width/height of the image after rotation (before the crop). */
export function rotatedSize(
  width: number,
  height: number,
  rotate: FrameRotation | undefined,
): { width: number; height: number } {
  return rotate === 90 || rotate === 270 ? { width: height, height: width } : { width, height };
}

/**
 * Clamp a crop rect into 0..1 with a minimum size. Returns undefined when the
 * rect is unusable (non-finite or collapses to nothing), or when it covers the
 * whole frame (which is the same as no crop).
 */
export function clampCrop(rect: CropRect): CropRect | undefined {
  const values = [rect.x, rect.y, rect.width, rect.height];
  if (!values.every((v) => Number.isFinite(v))) return undefined;
  if (rect.width <= 0 || rect.height <= 0) return undefined;

  const x = Math.min(Math.max(rect.x, 0), 1 - MIN_CROP_SIZE);
  const y = Math.min(Math.max(rect.y, 0), 1 - MIN_CROP_SIZE);
  const width = Math.min(Math.max(rect.width, MIN_CROP_SIZE), 1 - x);
  const height = Math.min(Math.max(rect.height, MIN_CROP_SIZE), 1 - y);

  if (x <= 0 && y <= 0 && width >= 1 && height >= 1) return undefined;
  const round = (v: number) => Number(v.toFixed(4));
  return { x: round(x), y: round(y), width: round(width), height: round(height) };
}

/** True when the frame changes nothing (no rotation, no crop). */
export function isNoopFrame(frame: FrameTransform | undefined): boolean {
  if (!frame) return true;
  return (frame.rotate ?? 0) === 0 && frame.crop === undefined;
}

/**
 * Normalize a frame: clamp the crop, drop a zero rotation, and return
 * undefined when nothing remains. OpState should only ever store the result
 * of this, so "no frame" has exactly one representation.
 */
export function normalizeFrame(frame: FrameTransform | undefined): FrameTransform | undefined {
  if (!frame) return undefined;
  const rotate = isFrameRotation(frame.rotate) && frame.rotate !== 0 ? frame.rotate : undefined;
  const crop = frame.crop ? clampCrop(frame.crop) : undefined;
  if (rotate === undefined && crop === undefined) return undefined;
  return { ...(rotate !== undefined ? { rotate } : {}), ...(crop !== undefined ? { crop } : {}) };
}

/** Rotate a normalized rect by +90 degrees clockwise (within the unit square). */
function rotateRectCw(rect: CropRect): CropRect {
  return {
    x: 1 - (rect.y + rect.height),
    y: rect.x,
    width: rect.height,
    height: rect.width,
  };
}

/**
 * Rotate a normalized rect from unrotated-image space into the space of an
 * image rotated clockwise by `rotate`. Used to carry crops (and mask bounding
 * boxes) along when the rotation changes.
 */
export function rotateRectInto(rect: CropRect, rotate: FrameRotation | undefined): CropRect {
  let result = rect;
  const steps = ((rotate ?? 0) / 90) % 4;
  for (let i = 0; i < steps; i += 1) result = rotateRectCw(result);
  return result;
}

/**
 * Rotate the whole frame a further 90 degrees (positive = clockwise,
 * negative = counter-clockwise), carrying the crop so it keeps selecting the
 * same pixels.
 */
export function rotateFrame(
  frame: FrameTransform | undefined,
  direction: 1 | -1,
): FrameTransform | undefined {
  const current = frame?.rotate ?? 0;
  const rotate = (((current + direction * 90) % 360) + 360) % 360 as FrameRotation;
  let crop = frame?.crop;
  if (crop) {
    // CCW is three CW turns of the rect.
    const turns = direction === 1 ? 1 : 3;
    for (let i = 0; i < turns; i += 1) crop = rotateRectCw(crop!);
  }
  return normalizeFrame({ rotate, ...(crop ? { crop } : {}) });
}

/**
 * Largest centered rect with the given pixel aspect ratio (width / height),
 * expressed in normalized coordinates of a frame that is `frameWidth` x
 * `frameHeight` pixels.
 */
export function centeredAspectCrop(
  frameWidth: number,
  frameHeight: number,
  aspect: number,
): CropRect | undefined {
  if (!(frameWidth > 0) || !(frameHeight > 0) || !Number.isFinite(aspect) || !(aspect > 0)) {
    return undefined;
  }
  const frameAspect = frameWidth / frameHeight;
  let width = 1;
  let height = 1;
  if (aspect < frameAspect) {
    width = aspect / frameAspect;
  } else {
    height = frameAspect / aspect;
  }
  return clampCrop({ x: (1 - width) / 2, y: (1 - height) / 2, width, height });
}

/**
 * Fit a crop of the given pixel aspect ratio around a normalized subject rect,
 * padded by `padding` (fraction of the subject's size on every side). The crop
 * grows to reach the aspect ratio and shifts to stay inside the frame; when the
 * padded subject is wider/taller than the aspect allows at full frame size, the
 * subject is centered as well as possible instead of fully contained.
 */
export function cropAroundSubject(
  frameWidth: number,
  frameHeight: number,
  subject: CropRect,
  aspect: number | undefined,
  padding = 0.15,
): CropRect | undefined {
  if (!(frameWidth > 0) || !(frameHeight > 0)) return undefined;
  const pad = Math.min(Math.max(padding, 0), 1);

  // Work in pixels so the aspect ratio is meaningful.
  const sx = subject.x * frameWidth;
  const sy = subject.y * frameHeight;
  const sw = Math.max(subject.width * frameWidth, 1);
  const sh = Math.max(subject.height * frameHeight, 1);

  let width = Math.min(sw * (1 + 2 * pad), frameWidth);
  let height = Math.min(sh * (1 + 2 * pad), frameHeight);

  if (aspect !== undefined && Number.isFinite(aspect) && aspect > 0) {
    // Grow the shorter dimension to hit the aspect; shrink only if the frame
    // cannot contain the grown rect.
    if (width / height < aspect) {
      width = height * aspect;
    } else {
      height = width / aspect;
    }
    if (width > frameWidth) {
      width = frameWidth;
      height = width / aspect;
    }
    if (height > frameHeight) {
      height = frameHeight;
      width = height * aspect;
    }
  }

  const centerX = sx + sw / 2;
  const centerY = sy + sh / 2;
  let x = centerX - width / 2;
  let y = centerY - height / 2;
  x = Math.min(Math.max(x, 0), frameWidth - width);
  y = Math.min(Math.max(y, 0), frameHeight - height);

  return clampCrop({
    x: x / frameWidth,
    y: y / frameHeight,
    width: width / frameWidth,
    height: height / frameHeight,
  });
}

/**
 * Parse an aspect ratio argument: "W:H" (e.g. "4:5", "16:9"), "square", or
 * "original". Returns the pixel width/height ratio, using the rotated frame
 * dimensions for "original".
 */
export function parseAspect(
  value: string,
  frameWidth: number,
  frameHeight: number,
): number | undefined {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "square" || trimmed === "1:1") return 1;
  if (trimmed === "original") {
    return frameWidth > 0 && frameHeight > 0 ? frameWidth / frameHeight : undefined;
  }
  const match = /^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/.exec(trimmed);
  if (!match) return undefined;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!(w > 0) || !(h > 0)) return undefined;
  return w / h;
}

/** Output pixel size of an image after the frame is applied. */
export function framedSize(
  width: number,
  height: number,
  frame: FrameTransform | undefined,
): { width: number; height: number } {
  const rotated = rotatedSize(width, height, frame?.rotate);
  if (!frame?.crop) return rotated;
  return {
    width: Math.max(1, Math.round(frame.crop.width * rotated.width)),
    height: Math.max(1, Math.round(frame.crop.height * rotated.height)),
  };
}

/** Compact human-readable description, e.g. "rotated 90° · crop 4:5 at (12%, 4%)". */
export function describeFrame(frame: FrameTransform | undefined): string {
  if (isNoopFrame(frame)) return "none";
  const parts: string[] = [];
  if (frame?.rotate) parts.push(`rotated ${frame.rotate}° clockwise`);
  if (frame?.crop) {
    const c = frame.crop;
    parts.push(
      `crop x=${c.x.toFixed(3)} y=${c.y.toFixed(3)} width=${c.width.toFixed(3)} height=${c.height.toFixed(3)} (normalized, rotated frame)`,
    );
  }
  return parts.join(", ");
}
