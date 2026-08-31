/** Image loading and export helpers (main thread, canvas-based). */

const PREVIEW_MAX_DIM = 1100;

/** Longest side for vision payloads — enough detail, small enough for BYOK. */
const AGENT_IMAGE_MAX_DIM = 768;
const AGENT_JPEG_QUALITY = 0.72;

export interface LoadedImage {
  fileName: string;
  full: ImageData;
  preview: ImageData;
}

function drawToImageData(source: CanvasImageSource, width: number, height: number): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas is not available");
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

export async function loadImageFile(file: File): Promise<LoadedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const full = drawToImageData(bitmap, bitmap.width, bitmap.height);
    const scale = Math.min(1, PREVIEW_MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const preview =
      scale < 1
        ? drawToImageData(
            bitmap,
            Math.round(bitmap.width * scale),
            Math.round(bitmap.height * scale),
          )
        : full;
    return { fileName: file.name, full, preview };
  } finally {
    bitmap.close();
  }
}

/**
 * Encode the current preview for the editing agent (JPEG base64, no data-URL
 * prefix). Downscales large frames so the request stays manageable.
 */
export async function encodeImageForAgent(
  image: ImageData,
): Promise<{ mimeType: "image/jpeg"; dataBase64: string }> {
  const scale = Math.min(1, AGENT_IMAGE_MAX_DIM / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas is not available");

  if (scale < 1) {
    const source = document.createElement("canvas");
    source.width = image.width;
    source.height = image.height;
    const sourceCtx = source.getContext("2d");
    if (!sourceCtx) throw new Error("2D canvas is not available");
    sourceCtx.putImageData(image, 0, 0);
    ctx.drawImage(source, 0, 0, width, height);
  } else {
    ctx.putImageData(image, 0, 0);
  }

  const dataUrl = canvas.toDataURL("image/jpeg", AGENT_JPEG_QUALITY);
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("failed to encode preview for the agent");
  return { mimeType: "image/jpeg", dataBase64: dataUrl.slice(comma + 1) };
}

export async function exportImage(
  image: ImageData,
  format: "jpeg" | "png",
  fileName: string,
): Promise<void> {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas is not available");
  ctx.putImageData(image, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, format === "jpeg" ? "image/jpeg" : "image/png", 0.92),
  );
  if (!blob) throw new Error("failed to encode image");

  const base = fileName.replace(/\.[^.]+$/, "") || "photo";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${base}-pixlpal.${format === "jpeg" ? "jpg" : "png"}`;
  link.click();
  URL.revokeObjectURL(link.href);
}
