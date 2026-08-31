// Re-exported from the shared package so web and mobile use the exact same
// editor-state model.
export {
  mergeOpStateForMask,
  opStateToPipeline,
  pipelineToOpState,
  projectOpStateForMask,
  type ActiveOp,
  type MaskEditingTarget,
  type OpState,
  type ParamValues,
} from "@pixelcam/shared";
