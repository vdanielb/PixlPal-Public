import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isNoopFrame,
  serializePipeline,
  type FrameTransform,
  type MaskDeclaration,
} from "@pixelcam/shared";
import type { ImageStats, InvertMaskHost, MaskBoundsHost, SegmentHost, CreateMaskHost } from "@pixelcam/ai";
import { ChatPanel } from "./components/ChatPanel";
import { Controls } from "./components/Controls";
import { Dropzone } from "./components/Dropzone";
import { EditorCanvas } from "./components/EditorCanvas";
import { SiteFooter } from "./components/SiteFooter";
import { Topbar } from "./components/Topbar";
import { exportImage, loadImageFile, type LoadedImage } from "./lib/image";
import { analyzeImage } from "./lib/imageStats";
import { opStateToPipeline, type OpState } from "./lib/pipelineState";
import { loadAgentSettings, saveAgentSettings, type AgentSettings } from "./lib/agent/settings";
import { createSegmenter, maskBounds, MaskStore, type MaskBitmap } from "./lib/segmentation";
import { useAgent } from "./lib/useAgent";
import { useEditHistory } from "./lib/useEditHistory";
import { useWebMcp } from "./lib/webmcp";
import { useEngine, type EngineMaskPayload } from "./lib/useEngine";
import { useSuggestions } from "./lib/useSuggestions";

export function App() {
  const engine = useEngine();
  const history = useEditHistory();
  const { opState } = history.current;

  const [image, setImage] = useState<LoadedImage | null>(null);
  const [imageStats, setImageStats] = useState<ImageStats | null>(null);
  const [exportFormat, setExportFormat] = useState<"jpeg" | "png">("jpeg");
  const [exporting, setExporting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [agentSettings, setAgentSettings] = useState<AgentSettings>(loadAgentSettings);

  const maskStoreRef = useRef(new MaskStore());
  const segmenterRef = useRef(createSegmenter());
  const [maskVersion, setMaskVersion] = useState(0);
  const [activeMaskId, setActiveMaskId] = useState<string | null>(null);
  // Off by default so agent-applied masked edits are not covered by the cyan wash.
  const [showOverlay, setShowOverlay] = useState(false);
  const [subjectPrompt, setSubjectPrompt] = useState("");
  const [segmenting, setSegmenting] = useState(false);
  const [segmentError, setSegmentError] = useState<string | null>(null);

  const maskList = useMemo(() => {
    void maskVersion;
    return maskStoreRef.current.list().map((m) => ({
      id: m.id,
      prompt: m.prompt,
      coverage: m.coverage,
    }));
  }, [maskVersion]);

  const maskDeclarations: MaskDeclaration[] = useMemo(() => {
    void maskVersion;
    return maskStoreRef.current.declarations();
  }, [maskVersion]);

  const pipeline = useMemo(
    () => opStateToPipeline(opState, maskDeclarations),
    [opState, maskDeclarations],
  );
  const pipelineJson = useMemo(() => serializePipeline(pipeline), [pipeline]);
  // The preview never applies the frame: the canvas shows the whole photo and
  // renders the crop as a dimmed overlay instead. Only export applies it.
  const previewPipelineJson = useMemo(
    () => serializePipeline({ ...pipeline, frame: undefined }),
    [pipeline],
  );

  const previewMasks: EngineMaskPayload | null = useMemo(() => {
    void maskVersion;
    if (!image || maskStoreRef.current.list().length === 0) return null;
    const { ids, data } = maskStoreRef.current.toEngineMasks(
      image.preview.width,
      image.preview.height,
    );
    if (ids.length === 0) return null;
    return { maskIdsJson: JSON.stringify(ids), masks: data };
  }, [image, maskVersion]);

  const overlayMask: MaskBitmap | null = useMemo(() => {
    void maskVersion;
    if (!activeMaskId) return null;
    return maskStoreRef.current.get(activeMaskId)?.mask ?? null;
  }, [activeMaskId, maskVersion]);

  const runSegment = useCallback<SegmentHost>(
    async (prompt, signal) => {
      if (!image) return { error: "no photo is open, so it cannot be segmented." };
      try {
        await segmenterRef.current.ensureReady(signal);
        const result = await segmenterRef.current.segment(image.preview, { prompt, signal });
        const stored = maskStoreRef.current.put({
          prompt,
          mask: result.mask,
          segmenterId: segmenterRef.current.id,
        });
        setMaskVersion((v) => v + 1);
        setActiveMaskId(stored.id);
        setSegmentError(null);
        return { maskId: stored.id, coverage: stored.coverage };
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return { error: "segmentation was cancelled." };
        }
        const message = error instanceof Error ? error.message : String(error);
        return { error: message };
      }
    },
    [image],
  );

  const runInvertMask = useCallback<InvertMaskHost>(
    async (maskId) => {
      const result = maskStoreRef.current.invert(maskId);
      if ("error" in result) return result;
      setMaskVersion((v) => v + 1);
      setActiveMaskId(result.id);
      return {
        maskId: result.id,
        coverage: result.coverage,
        sourceMaskId: result.sourceMaskId,
      };
    },
    [],
  );

  const runCreateMask = useCallback<CreateMaskHost>(
    async (input) => {
      if (!image) return { error: "no photo is open, so a mask cannot be created." };
      try {
        const decl: MaskDeclaration = {
          id: input.id ?? input.type,
          source: input.type,
          prompt: input.prompt,
          feather: input.feather ?? 0.02,
          params: input.params,
        };
        const plane = await engine.renderMask(JSON.stringify(decl));
        const width = image.preview.width;
        const height = image.preview.height;
        if (plane.length !== width * height) {
          return { error: "mask render size did not match the preview." };
        }
        const stored = maskStoreRef.current.put({
          prompt: input.prompt,
          mask: { width, height, data: plane },
          segmenterId: "engine",
          feather: decl.feather,
          preferredId: decl.id,
          source: input.type,
          params: input.params,
        });
        setMaskVersion((v) => v + 1);
        setActiveMaskId(stored.id);
        return { maskId: stored.id, coverage: stored.coverage };
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return { error: "mask creation was cancelled." };
        }
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    [image, engine],
  );

  const runGetMaskBounds = useCallback<MaskBoundsHost>(async (maskId) => {
    const stored = maskStoreRef.current.get(maskId.trim());
    if (!stored) {
      const known = maskStoreRef.current.list().map((m) => m.id).join(", ") || "(none)";
      return { error: `unknown mask "${maskId}". Known masks: ${known}.` };
    }
    const bounds = maskBounds(stored.mask);
    if (!bounds) {
      return { error: `mask "${maskId}" is empty, so it has no bounding box.` };
    }
    return { bounds };
  }, []);

  const agent = useAgent({
    settings: agentSettings,
    getEditSnapshot: () => history.current,
    getImageStats: () => imageStats,
    getPreviewImage: () => (image ? (engine.previewFrame ?? image.preview) : null),
    segment: runSegment,
    invertMask: runInvertMask,
    createMask: runCreateMask,
    getMaskBounds: runGetMaskBounds,
    onApplyEdit: (nextOpState) => history.commit({ opState: nextOpState }),
  });

  // `history.current` only updates on the next render, but WebMCP tool calls
  // can arrive back-to-back within one agent turn. This ref tracks the edit
  // synchronously so consecutive calls compose instead of clobbering.
  const latestOpState = useRef(opState);
  latestOpState.current = opState;

  const webMcpStatus = useWebMcp({
    isPhotoOpen: () => image !== null,
    getOpState: () => latestOpState.current,
    applyOpState: (next) => {
      latestOpState.current = next;
      history.commit({ opState: next });
    },
    getImageStats: () => imageStats,
    getEditState: () => ({
      photo: image
        ? { fileName: image.fileName, width: image.full.width, height: image.full.height }
        : null,
      pipelineJson: serializePipeline(
        opStateToPipeline(latestOpState.current, maskDeclarations),
      ),
      masks: maskStoreRef.current.list().map((mask) => ({
        id: mask.id,
        prompt: mask.prompt,
        coverage: mask.coverage,
        inverted: mask.invertedFrom !== undefined,
      })),
      canUndo: history.canUndo,
      canRedo: history.canRedo,
    }),
    segment: runSegment,
    invertMask: runInvertMask,
    createMask: runCreateMask,
    getMaskBounds: runGetMaskBounds,
  });

  const suggestions = useSuggestions(
    agentSettings,
    image?.preview ?? null,
    image ? `${image.fileName}:${image.full.width}x${image.full.height}` : null,
  );

  const handleFile = useCallback(
    async (file: File) => {
      try {
        const loaded = await loadImageFile(file);
        setImage(loaded);
        setImageStats(analyzeImage(loaded.preview));
        maskStoreRef.current.setPhoto(`${file.name}:${loaded.full.width}x${loaded.full.height}`);
        setMaskVersion((v) => v + 1);
        setActiveMaskId(null);
        setSubjectPrompt("");
        setSegmentError(null);
        history.reset();
        agent.clear();
        setLoadError(null);
        engine.setPreviewImage(loaded.preview);
      } catch (err) {
        setLoadError(`Could not open ${file.name}: ${String(err)}`);
      }
    },
    [agent, engine, history],
  );

  useEffect(() => {
    if (image && engine.ready) {
      engine.requestPreview(previewPipelineJson, previewMasks);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, engine.ready, previewPipelineJson, previewMasks]);

  const handleOpChange = useCallback(
    (next: OpState) => {
      // Coalesced: a whole slider drag collapses into one undo step.
      history.commit({ opState: next }, { coalesce: true });
    },
    [history],
  );

  const handleFrameChange = useCallback(
    (frame: FrameTransform | undefined, options?: { coalesce?: boolean }) => {
      const next: OpState = { ...latestOpState.current };
      if (frame && !isNoopFrame(frame)) {
        next.frame = frame;
      } else {
        delete next.frame;
      }
      latestOpState.current = next;
      // Crop drags coalesce into one undo step, like slider drags.
      history.commit({ opState: next }, { coalesce: options?.coalesce === true });
    },
    [history],
  );

  const handleSettingsChange = useCallback((next: AgentSettings) => {
    setAgentSettings(next);
    saveAgentSettings(next);
  }, []);

  const handleSegmentSubject = useCallback(async () => {
    const prompt = subjectPrompt.trim();
    if (!prompt || !image) return;
    setSegmenting(true);
    setSegmentError(null);
    try {
      const result = await runSegment(prompt);
      if ("error" in result) {
        setSegmentError(result.error);
        return;
      }
      // User asked to select a subject — show the mask so they can verify it.
      setActiveMaskId(result.maskId);
      setShowOverlay(true);
    } finally {
      setSegmenting(false);
    }
  }, [image, runSegment, subjectPrompt]);

  const handleExport = useCallback(async () => {
    if (!image) return;
    setExporting(true);
    try {
      let fullMasks: EngineMaskPayload | null = null;
      if (maskStoreRef.current.list().length > 0) {
        const { ids, data } = maskStoreRef.current.toEngineMasks(
          image.full.width,
          image.full.height,
        );
        if (ids.length > 0) {
          fullMasks = { maskIdsJson: JSON.stringify(ids), masks: data };
        }
      }
      const processed = await engine.processFull(image.full, pipelineJson, fullMasks);
      await exportImage(processed, exportFormat, image.fileName);
    } finally {
      setExporting(false);
    }
  }, [image, engine, pipelineJson, exportFormat]);

  return (
    <>
      <Topbar titleIsHeading>
        {webMcpStatus === "registered" && (
          <p
            className="webmcp-badge"
            title="This editor's tools are registered with your browser's agent via WebMCP."
          >
            Agent-ready
          </p>
        )}
        {image && (
          <nav className="actions" aria-label="Editor actions">
            <button onClick={history.undo} disabled={!history.canUndo} title="Undo">
              Undo
            </button>
            <button onClick={history.redo} disabled={!history.canRedo} title="Redo">
              Redo
            </button>
            <label className="format-picker">
              Format
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as "jpeg" | "png")}
              >
                <option value="jpeg">JPEG</option>
                <option value="png">PNG</option>
              </select>
            </label>
            <button className="primary" onClick={handleExport} disabled={exporting}>
              {exporting ? "Exporting…" : "Export"}
            </button>
            <button
              onClick={() => {
                setImage(null);
                setImageStats(null);
                maskStoreRef.current.clear();
                setMaskVersion((v) => v + 1);
                setActiveMaskId(null);
                history.reset();
                agent.clear();
              }}
            >
              New photo
            </button>
          </nav>
        )}
      </Topbar>

      {loadError && <p className="error-banner">{loadError}</p>}
      {engine.error && <p className="error-banner">Engine error: {engine.error}</p>}

      {!image ? (
        <>
          <Dropzone onFile={handleFile} engineReady={engine.ready} />
          <SiteFooter />
        </>
      ) : (
        <section className="editor" aria-label="Photo editor">
          <Controls
            opState={opState}
            onOpChange={handleOpChange}
            pipeline={pipeline}
            masks={maskList}
            activeMaskId={activeMaskId}
            onSelectMask={(maskId) => {
              setActiveMaskId(maskId);
              setShowOverlay(maskId !== null);
            }}
            onMaskBadgeClick={(maskId) => {
              setActiveMaskId(maskId);
              setShowOverlay(true);
            }}
            subjectPrompt={subjectPrompt}
            onSubjectPromptChange={setSubjectPrompt}
            onSegmentSubject={handleSegmentSubject}
            segmenting={segmenting}
            segmentError={segmentError}
            imageWidth={image.full.width}
            imageHeight={image.full.height}
            onFrameChange={handleFrameChange}
          />
          <EditorCanvas
            frame={engine.previewFrame ?? image.preview}
            original={image.preview}
            fileName={image.fileName}
            fullWidth={image.full.width}
            fullHeight={image.full.height}
            processing={engine.processing || segmenting}
            overlayMask={overlayMask}
            showOverlay={showOverlay}
            onToggleOverlay={() => setShowOverlay((v) => !v)}
            frameTransform={opState.frame}
            onFrameChange={handleFrameChange}
          />
          <ChatPanel
            agent={agent}
            settings={agentSettings}
            onSettingsChange={handleSettingsChange}
            suggestions={suggestions}
          />
        </section>
      )}
    </>
  );
}
