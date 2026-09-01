import { useMemo } from "react";
import {
  CATEGORY_LABELS,
  OPERATION_DEFS,
  centeredAspectCrop,
  isNoopFrame,
  mergeOpStateForMask,
  normalizeFrame,
  projectOpStateForMask,
  rotateFrame,
  rotatedSize,
  type FrameTransform,
  type OpCategory,
  type Pipeline,
} from "@pixelcam/shared";
import type { OpState } from "../lib/pipelineState";
import { OpControl } from "./OpControl";
import { PipelineJson } from "./PipelineJson";

const CATEGORIES: OpCategory[] = ["tonal", "color", "texture", "optical"];

const ASPECT_PRESETS: Array<{ label: string; aspect: number }> = [
  { label: "1:1", aspect: 1 },
  { label: "4:5", aspect: 4 / 5 },
  { label: "3:2", aspect: 3 / 2 },
  { label: "16:9", aspect: 16 / 9 },
  { label: "9:16", aspect: 9 / 16 },
];

export type MaskListItem = {
  id: string;
  prompt: string;
  coverage: number;
};

export function Controls({
  opState,
  onOpChange,
  pipeline,
  masks,
  activeMaskId,
  onSelectMask,
  onMaskBadgeClick,
  subjectPrompt,
  onSubjectPromptChange,
  onSegmentSubject,
  segmenting,
  segmentError,
  imageWidth,
  imageHeight,
  onFrameChange,
}: {
  opState: OpState;
  onOpChange: (next: OpState) => void;
  pipeline: Pipeline;
  masks: MaskListItem[];
  /** `null` = editing the whole image. */
  activeMaskId: string | null;
  onSelectMask: (maskId: string | null) => void;
  onMaskBadgeClick?: (maskId: string) => void;
  subjectPrompt: string;
  onSubjectPromptChange: (value: string) => void;
  onSegmentSubject: () => void;
  segmenting: boolean;
  segmentError: string | null;
  /** Full-resolution photo size, for aspect-ratio math. */
  imageWidth: number;
  imageHeight: number;
  onFrameChange: (next: FrameTransform | undefined) => void;
}) {
  const editingTarget = activeMaskId;
  const projectedOpState = useMemo(
    () => projectOpStateForMask(opState, editingTarget),
    [opState, editingTarget],
  );

  const handleProjectedOpChange = (projected: OpState) => {
    onOpChange(mergeOpStateForMask(opState, projected, editingTarget));
  };

  const frame = opState.frame;
  const rotation = frame?.rotate ?? 0;
  const frameSize = rotatedSize(imageWidth, imageHeight, rotation);
  const cropAspect = frame?.crop
    ? (frame.crop.width * frameSize.width) / (frame.crop.height * frameSize.height)
    : null;

  const applyAspect = (aspect: number) => {
    const crop = centeredAspectCrop(frameSize.width, frameSize.height, aspect);
    onFrameChange(normalizeFrame({ rotate: rotation, ...(crop ? { crop } : {}) }));
  };

  return (
    <aside className="controls" aria-label="Adjustments">
      <section className="subject">
        <h2>Subject</h2>
        <p className="hint">Describe specific object to select</p>
        <label className="subject-field">
          <span className="sr-only">Subject to segment</span>
          <input
            type="text"
            value={subjectPrompt}
            placeholder='e.g. "the red dress"'
            onChange={(e) => onSubjectPromptChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSegmentSubject();
              }
            }}
          />
        </label>
        <button
          type="button"
          className="primary subject-run"
          onClick={onSegmentSubject}
          disabled={segmenting || !subjectPrompt.trim()}
        >
          {segmenting ? "Finding…" : "Select subject"}
        </button>
        {segmentError && <p className="inline-error">{segmentError}</p>}

        {masks.length > 0 && (
          <fieldset className="mask-list">
            <legend>Masks</legend>
            <menu aria-label="Masks">
              <li>
                <button
                  type="button"
                  className={activeMaskId === null ? "active" : undefined}
                  aria-pressed={activeMaskId === null}
                  onClick={() => onSelectMask(null)}
                >
                  Whole image
                </button>
              </li>
              {masks.map((mask) => (
                <li key={mask.id}>
                  <button
                    type="button"
                    className={activeMaskId === mask.id ? "active" : undefined}
                    aria-pressed={activeMaskId === mask.id}
                    title={`${mask.prompt} · ~${(mask.coverage * 100).toFixed(0)}% of frame`}
                    onClick={() => onSelectMask(mask.id)}
                  >
                    {mask.id}
                    <small>
                      {mask.prompt}
                      {" · "}
                      {(mask.coverage * 100).toFixed(0)}%
                    </small>
                  </button>
                </li>
              ))}
            </menu>
          </fieldset>
        )}
      </section>

      <section className="category frame-section">
        <h2>Frame</h2>
        <p className="hint">
          Non-destructive: the photo outside the crop stays visible but dimmed, and is only
          trimmed on export.
        </p>
        <fieldset className="frame-group">
          <legend>Rotate</legend>
          <menu aria-label="Rotate">
            <li>
              <button
                type="button"
                onClick={() => onFrameChange(rotateFrame(frame, -1))}
                title="Rotate 90° counter-clockwise"
              >
                ⟲ 90°
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => onFrameChange(rotateFrame(frame, 1))}
                title="Rotate 90° clockwise"
              >
                ⟳ 90°
              </button>
            </li>
            {rotation !== 0 && (
              <li>
                <output className="frame-state">{rotation}°</output>
              </li>
            )}
          </menu>
        </fieldset>
        <fieldset className="frame-group">
          <legend>Crop</legend>
          <menu aria-label="Crop aspect presets">
            {ASPECT_PRESETS.map((preset) => {
              const active =
                cropAspect !== null && Math.abs(cropAspect - preset.aspect) / preset.aspect < 0.02;
              return (
                <li key={preset.label}>
                  <button
                    type="button"
                    className={active ? "active" : undefined}
                    aria-pressed={active}
                    onClick={() => applyAspect(preset.aspect)}
                    title={`Crop to ${preset.label} (drag the frame on the photo to adjust)`}
                  >
                    {preset.label}
                  </button>
                </li>
              );
            })}
          </menu>
          {frame?.crop && (
            <p className="hint">Drag the frame or its corners on the photo to adjust.</p>
          )}
        </fieldset>
        {!isNoopFrame(frame) && (
          <button type="button" className="frame-clear" onClick={() => onFrameChange(undefined)}>
            Clear crop &amp; rotation
          </button>
        )}
      </section>

      {CATEGORIES.map((category) => (
        <section key={category} className="category">
          <h2>{CATEGORY_LABELS[category]}</h2>
          {OPERATION_DEFS.filter((def) => def.category === category).map((def) => (
            <OpControl
              key={def.op}
              def={def}
              opState={projectedOpState}
              onOpChange={handleProjectedOpChange}
              onMaskBadgeClick={onMaskBadgeClick}
            />
          ))}
        </section>
      ))}

      <PipelineJson pipeline={pipeline} />
    </aside>
  );
}
