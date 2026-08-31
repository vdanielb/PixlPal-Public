import { useEffect, useRef, useState } from "react";
import type { MaskBitmap } from "../lib/segmentation";

export function EditorCanvas({
  frame,
  original,
  fileName,
  fullWidth,
  fullHeight,
  processing,
  overlayMask,
  showOverlay,
  onToggleOverlay,
}: {
  frame: ImageData;
  original: ImageData;
  fileName: string;
  fullWidth: number;
  fullHeight: number;
  processing: boolean;
  overlayMask: MaskBitmap | null;
  showOverlay: boolean;
  onToggleOverlay: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [comparing, setComparing] = useState(false);

  const shown = comparing ? original : frame;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = shown.width;
    canvas.height = shown.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(shown, 0, 0);

    if (!(showOverlay && overlayMask && !comparing)) return;

    const tint = ctx.createImageData(shown.width, shown.height);
    const src = overlayMask;
    const xRatio = src.width / shown.width;
    const yRatio = src.height / shown.height;
    for (let y = 0; y < shown.height; y += 1) {
      const sy = Math.min(src.height - 1, Math.floor(y * yRatio));
      for (let x = 0; x < shown.width; x += 1) {
        const sx = Math.min(src.width - 1, Math.floor(x * xRatio));
        const t = src.data[sy * src.width + sx]!;
        if (t <= 0.05) continue;
        const i = (y * shown.width + x) * 4;
        // Soft cyan wash over the selection.
        tint.data[i] = 56;
        tint.data[i + 1] = 189;
        tint.data[i + 2] = 248;
        tint.data[i + 3] = Math.round(t * 120);
      }
    }
    const overlayCanvas = document.createElement("canvas");
    overlayCanvas.width = shown.width;
    overlayCanvas.height = shown.height;
    overlayCanvas.getContext("2d")?.putImageData(tint, 0, 0);
    ctx.drawImage(overlayCanvas, 0, 0);
  }, [shown, showOverlay, overlayMask, comparing]);

  return (
    <figure className="stage" data-processing={processing || undefined}>
      <canvas ref={canvasRef} aria-label={`Preview of ${fileName}`} />
      <figcaption>
        {fileName} · {fullWidth}×{fullHeight}
        {comparing ? " · original" : processing ? " · processing…" : ""}
        {showOverlay && overlayMask ? " · mask" : ""}
      </figcaption>
      <menu className="stage-actions">
        {overlayMask && (
          <li>
            <button
              type="button"
              className={showOverlay ? "active" : undefined}
              onClick={onToggleOverlay}
              title="Toggle mask overlay"
            >
              {showOverlay ? "Hide mask" : "Show mask"}
            </button>
          </li>
        )}
        <li>
          <button
            className="compare"
            onPointerDown={() => setComparing(true)}
            onPointerUp={() => setComparing(false)}
            onPointerLeave={() => setComparing(false)}
            title="Hold to see the original"
          >
            Hold to compare
          </button>
        </li>
      </menu>
    </figure>
  );
}
