/**
 * Undo/redo as a stack of edit versions, shared by the sliders and the agent —
 * whoever changed the edit, it is revertible the same way.
 *
 * Slider drags fire a change per pixel of travel, so consecutive coalescable
 * commits inside a short window replace each other instead of piling up. A drag
 * is therefore one undo step, while an agent tool call is always its own.
 */

import { useCallback, useRef, useState } from "react";
import type { OpState } from "./pipelineState";

export interface EditSnapshot {
  opState: OpState;
}

const PRISTINE: EditSnapshot = { opState: {} };
const MAX_VERSIONS = 100;
const COALESCE_MS = 500;

export interface EditHistoryApi {
  current: EditSnapshot;
  canUndo: boolean;
  canRedo: boolean;
  commit: (next: EditSnapshot, options?: { coalesce?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  /** Start over, e.g. when a new photo is opened. */
  reset: () => void;
}

export function useEditHistory(): EditHistoryApi {
  const [{ versions, index }, setState] = useState<{
    versions: EditSnapshot[];
    index: number;
  }>({ versions: [PRISTINE], index: 0 });

  const lastCommit = useRef({ at: 0, coalescable: false });

  const commit = useCallback((next: EditSnapshot, options?: { coalesce?: boolean }) => {
    const coalescable = options?.coalesce === true;
    const now = Date.now();
    const merge =
      coalescable && lastCommit.current.coalescable && now - lastCommit.current.at < COALESCE_MS;
    lastCommit.current = { at: now, coalescable };

    setState((state) => {
      // Merging replaces the top version; the pristine version at index 0 is
      // never replaced, so "undo everything" always remains available.
      if (merge && state.index > 0) {
        return { versions: [...state.versions.slice(0, state.index), next], index: state.index };
      }
      const kept = [...state.versions.slice(0, state.index + 1), next];
      const overflow = Math.max(0, kept.length - MAX_VERSIONS);
      return { versions: kept.slice(overflow), index: kept.length - 1 - overflow };
    });
  }, []);

  const step = useCallback((delta: number) => {
    lastCommit.current = { at: 0, coalescable: false };
    setState((state) => {
      const next = state.index + delta;
      if (next < 0 || next >= state.versions.length) return state;
      return { ...state, index: next };
    });
  }, []);

  const undo = useCallback(() => step(-1), [step]);
  const redo = useCallback(() => step(1), [step]);

  const reset = useCallback(() => {
    lastCommit.current = { at: 0, coalescable: false };
    setState({ versions: [PRISTINE], index: 0 });
  }, []);

  return {
    current: versions[index],
    canUndo: index > 0,
    canRedo: index < versions.length - 1,
    commit,
    undo,
    redo,
    reset,
  };
}
