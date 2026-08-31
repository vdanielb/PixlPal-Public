import { useMemo } from "react";
import {
  CATEGORY_LABELS,
  OPERATION_DEFS,
  mergeOpStateForMask,
  projectOpStateForMask,
  type OpCategory,
  type Pipeline,
} from "@pixelcam/shared";
import type { OpState } from "../lib/pipelineState";
import { OpControl } from "./OpControl";
import { PipelineJson } from "./PipelineJson";

const CATEGORIES: OpCategory[] = ["tonal", "color", "texture", "optical"];

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
}) {
  const editingTarget = activeMaskId;
  const projectedOpState = useMemo(
    () => projectOpStateForMask(opState, editingTarget),
    [opState, editingTarget],
  );

  const handleProjectedOpChange = (projected: OpState) => {
    onOpChange(mergeOpStateForMask(opState, projected, editingTarget));
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
