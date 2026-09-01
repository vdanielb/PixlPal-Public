import { useEffect, useMemo, useRef, useState } from "react";
import {
  clampCrop,
  framedSize,
  isNoopFrame,
  rotatedSize,
  type CropRect,
  type FrameTransform,
} from "@pixelcam/shared";
import type { MaskBitmap } from "../lib/segmentation";

/** Smallest crop side the handles allow, as a fraction of the frame. */
const MIN_DRAG_SIZE = 0.05;
/** Handle hit radius in CSS pixels. */
const HANDLE_HIT_PX = 14;

type DragMode = "move" | "nw" | "ne" | "sw" | "se";

type DragState = {
  mode: DragMode;
  startX: number;
  startY: number;
  startCrop: CropRect;
};

function cursorFor(mode: DragMode | null): string {
  switch (mode) {
    case "move":
      return "move";
    case "nw":
    case "se":
      return "nwse-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    default:
      return "default";
  }
}

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
  frameTransform,
  onFrameChange,
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
  /** The non-destructive rotate + crop; undefined = whole frame. */
  frameTransform: FrameTransform | undefined;
  /** Commit a frame edit (coalesced while dragging the crop). */
  onFrameChange: (next: FrameTransform | undefined, options?: { coalesce?: boolean }) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [comparing, setComparing] = useState(false);
  const [hoverMode, setHoverMode] = useState<DragMode | null>(null);

  // While comparing we show the untouched original: no rotation, no crop.
  const shown = comparing ? original : frame;
  const rotate = comparing ? 0 : (frameTransform?.rotate ?? 0);
  const crop = comparing ? undefined : frameTransform?.crop;

  const exportSize = useMemo(
    () => framedSize(fullWidth, fullHeight, frameTransform),
    [fullWidth, fullHeight, frameTransform],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const size = rotatedSize(shown.width, shown.height, rotate);
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Base frame (and mask tint) are in unrotated space; draw them through
    // the rotation transform.
    const source = document.createElement("canvas");
    source.width = shown.width;
    source.height = shown.height;
    const sourceCtx = source.getContext("2d");
    if (!sourceCtx) return;
    sourceCtx.putImageData(shown, 0, 0);

    ctx.save();
    if (rotate === 90) {
      ctx.translate(canvas.width, 0);
      ctx.rotate(Math.PI / 2);
    } else if (rotate === 180) {
      ctx.translate(canvas.width, canvas.height);
      ctx.rotate(Math.PI);
    } else if (rotate === 270) {
      ctx.translate(0, canvas.height);
      ctx.rotate(-Math.PI / 2);
    }
    ctx.drawImage(source, 0, 0);

    if (showOverlay && overlayMask && !comparing) {
      const tint = new ImageData(shown.width, shown.height);
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
    }
    ctx.restore();

    if (crop) {
      // The crop is non-destructive: keep the whole photo visible and dim
      // everything outside the frame instead of hiding it.
      const cx = crop.x * canvas.width;
      const cy = crop.y * canvas.height;
      const cw = crop.width * canvas.width;
      const ch = crop.height * canvas.height;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.rect(cx, cy, cw, ch);
      ctx.fillStyle = "rgba(8, 10, 14, 0.6)";
      ctx.fill("evenodd");

      const line = Math.max(1.5, canvas.width / 500);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = line;
      ctx.strokeRect(cx, cy, cw, ch);

      // Rule-of-thirds guides inside the crop.
      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.lineWidth = Math.max(1, line / 2);
      ctx.beginPath();
      for (let i = 1; i <= 2; i += 1) {
        ctx.moveTo(cx + (cw * i) / 3, cy);
        ctx.lineTo(cx + (cw * i) / 3, cy + ch);
        ctx.moveTo(cx, cy + (ch * i) / 3);
        ctx.lineTo(cx + cw, cy + (ch * i) / 3);
      }
      ctx.stroke();

      // Corner handles.
      const handle = Math.max(8, canvas.width / 90);
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      for (const [hx, hy] of [
        [cx, cy],
        [cx + cw, cy],
        [cx, cy + ch],
        [cx + cw, cy + ch],
      ] as const) {
        ctx.fillRect(hx - handle / 2, hy - handle / 2, handle, handle);
      }
      ctx.restore();
    }
  }, [shown, showOverlay, overlayMask, comparing, rotate, crop]);

  /** Pointer position in normalized canvas coordinates (rotated space). */
  const toNormalized = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
      // Hit radii in normalized units, derived from CSS pixels.
      hitX: HANDLE_HIT_PX / rect.width,
      hitY: HANDLE_HIT_PX / rect.height,
    };
  };

  const hitTest = (event: React.PointerEvent<HTMLCanvasElement>): DragMode | null => {
    if (!crop) return null;
    const p = toNormalized(event);
    const near = (cornerX: number, cornerY: number) =>
      Math.abs(p.x - cornerX) <= p.hitX && Math.abs(p.y - cornerY) <= p.hitY;
    if (near(crop.x, crop.y)) return "nw";
    if (near(crop.x + crop.width, crop.y)) return "ne";
    if (near(crop.x, crop.y + crop.height)) return "sw";
    if (near(crop.x + crop.width, crop.y + crop.height)) return "se";
    if (
      p.x >= crop.x &&
      p.x <= crop.x + crop.width &&
      p.y >= crop.y &&
      p.y <= crop.y + crop.height
    ) {
      return "move";
    }
    return null;
  };

  const applyDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const p = toNormalized(event);
    const dx = p.x - drag.startX;
    const dy = p.y - drag.startY;
    const start = drag.startCrop;
    let next: CropRect;

    if (drag.mode === "move") {
      next = {
        x: Math.min(Math.max(start.x + dx, 0), 1 - start.width),
        y: Math.min(Math.max(start.y + dy, 0), 1 - start.height),
        width: start.width,
        height: start.height,
      };
    } else {
      let left = start.x;
      let top = start.y;
      let right = start.x + start.width;
      let bottom = start.y + start.height;
      if (drag.mode === "nw" || drag.mode === "sw") {
        left = Math.min(Math.max(start.x + dx, 0), right - MIN_DRAG_SIZE);
      } else {
        right = Math.max(Math.min(start.x + start.width + dx, 1), left + MIN_DRAG_SIZE);
      }
      if (drag.mode === "nw" || drag.mode === "ne") {
        top = Math.min(Math.max(start.y + dy, 0), bottom - MIN_DRAG_SIZE);
      } else {
        bottom = Math.max(Math.min(start.y + start.height + dy, 1), top + MIN_DRAG_SIZE);
      }
      next = { x: left, y: top, width: right - left, height: bottom - top };
    }

    const clamped = clampCrop(next);
    onFrameChange(
      { ...(frameTransform ?? {}), ...(clamped ? { crop: clamped } : {}) },
      { coalesce: true },
    );
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (comparing || !crop) return;
    const mode = hitTest(event);
    if (!mode) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = toNormalized(event);
    dragRef.current = { mode, startX: p.x, startY: p.y, startCrop: crop };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) {
      applyDrag(event);
    } else {
      setHoverMode(comparing ? null : hitTest(event));
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      dragRef.current = null;
    }
  };

  const hasFrame = !isNoopFrame(frameTransform);

  return (
    <figure className="stage" data-processing={processing || undefined}>
      <canvas
        ref={canvasRef}
        aria-label={`Preview of ${fileName}`}
        style={{ cursor: cursorFor(dragRef.current?.mode ?? hoverMode) }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => setHoverMode(null)}
      />
      <figcaption>
        {fileName} · {fullWidth}×{fullHeight}
        {hasFrame && !comparing ? ` · framed to ${exportSize.width}×${exportSize.height}` : ""}
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
