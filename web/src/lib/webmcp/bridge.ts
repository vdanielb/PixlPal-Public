/**
 * WebMCP bridge for the PixlPal editor.
 *
 * Exposes the exact same validated tools the in-app assistant uses (defined in
 * `@pixelcam/ai`, generated from `shared/src/operations.ts`) to *external*
 * agents through the browser's `ModelContext` API — a browser-side agent in
 * Chrome or an agentic browser can turn the same knobs a human drags, and every
 * change lands in the same undo stack and pipeline JSON panel.
 *
 * This is a bridge, not a second agent: `ai/` stays transport-free and
 * platform-agnostic, and this module adapts its tool schemas + validating
 * executor to `modelContext.registerTool`. Tool failures are returned as
 * `isError` text results (never thrown) so a calling agent can read the
 * message and correct itself, matching the `ai/` package's philosophy that
 * bad arguments are results, not exceptions.
 */

import {
  AGENT_TOOLS,
  TOOL_NAMES,
  executeTool,
  type ImageStats,
  type InvertMaskHost,
  type MaskBoundsHost,
  type SegmentHost,
  type CreateMaskHost,
  type ToolContext,
  type ToolResult,
} from "@pixelcam/ai";
import type { OpState } from "../pipelineState";
import type {
  ModelContext,
  ModelContextRegisterToolOptions,
  ModelContextTool,
  ModelContextToolResult,
} from "./modelContext";

/** Everything registered by the bridge, in registration order. */
export const WEBMCP_TOOL_NAMES = {
  ...TOOL_NAMES,
  getEditState: "get_edit_state",
} as const;

/** Human-readable titles for browser UI surfaces (the spec's `title` field). */
const TOOL_TITLES: Record<string, string> = {
  [TOOL_NAMES.setOperations]: "Adjust editing operations",
  [TOOL_NAMES.removeOperations]: "Remove editing operations",
  [TOOL_NAMES.resetEdits]: "Reset all edits",
  [TOOL_NAMES.getImageStats]: "Measure the photo",
  [TOOL_NAMES.segment]: "Select a subject",
  [TOOL_NAMES.invertMask]: "Select everything else",
  [TOOL_NAMES.createMask]: "Select an area",
  [TOOL_NAMES.setFrame]: "Crop or rotate the photo",
  [WEBMCP_TOOL_NAMES.getEditState]: "Read the current edit",
};

/** Tools that never change editor state. */
const READ_ONLY_TOOLS = new Set<string>([
  TOOL_NAMES.getImageStats,
  WEBMCP_TOOL_NAMES.getEditState,
]);

export interface WebMcpMaskSummary {
  id: string;
  prompt?: string;
  coverage: number;
  inverted: boolean;
}

/** Snapshot of the editor for `get_edit_state`, computed fresh by the host. */
export interface WebMcpEditState {
  photo: { fileName: string; width: number; height: number } | null;
  /** The current declarative pipeline, serialized. */
  pipelineJson: string;
  masks: WebMcpMaskSummary[];
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * How the bridge reaches the live editor. `getOpState` must reflect edits
 * applied through `applyOpState` *synchronously* (not after a React render),
 * so back-to-back tool calls in one agent turn compose instead of clobbering.
 */
export interface WebMcpHost {
  isPhotoOpen(): boolean;
  getOpState(): OpState;
  /** Commit an agent edit into the editor (and its undo history). */
  applyOpState(next: OpState): void;
  getImageStats(): ImageStats | null;
  getEditState(): WebMcpEditState;
  segment?: SegmentHost;
  invertMask?: InvertMaskHost;
  createMask?: CreateMaskHost;
  getMaskBounds?: MaskBoundsHost;
}

function textResult(text: string, isError = false): ModelContextToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

function toToolResult(result: ToolResult): ModelContextToolResult {
  if (!result.ok) return textResult(result.error, true);
  const lines = [result.summary];
  for (const warning of result.warnings ?? []) lines.push(`Warning: ${warning}`);
  if (result.data) lines.push(`Data: ${JSON.stringify(result.data)}`);
  return textResult(lines.join("\n"));
}

const NO_PHOTO_MESSAGE =
  "No photo is open in the editor. Ask the user to open a photo first — " +
  "PixlPal edits run fully on-device, so only they can provide the file.";

function editStateText(state: WebMcpEditState): string {
  const lines: string[] = [];
  if (state.photo) {
    lines.push(
      `Photo "${state.photo.fileName}" (${state.photo.width}x${state.photo.height}) is open.`,
    );
  } else {
    lines.push("No photo is open.");
  }
  lines.push(`Current pipeline: ${state.pipelineJson}`);
  if (state.masks.length > 0) {
    const masks = state.masks
      .map((mask) => {
        const label = mask.inverted ? "inverse mask" : "mask";
        const prompt = mask.prompt ? ` for "${mask.prompt}"` : "";
        return `${mask.id} (${label}${prompt}, ~${(mask.coverage * 100).toFixed(1)}% of frame)`;
      })
      .join("; ");
    lines.push(`Available masks: ${masks}.`);
  } else {
    lines.push("No masks exist yet; use segment or create_mask to create one.");
  }
  lines.push(`Undo available: ${state.canUndo}. Redo available: ${state.canRedo}.`);
  return lines.join("\n");
}

/**
 * Build the WebMCP tool list for a host. Executions are serialized through a
 * per-bridge queue so overlapping calls read-modify-write editor state in
 * order rather than racing.
 */
export function createWebMcpTools(host: WebMcpHost): ModelContextTool[] {
  let queue: Promise<unknown> = Promise.resolve();

  const enqueue = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  };

  const bridged = AGENT_TOOLS.map<ModelContextTool>((tool) => ({
    name: tool.name,
    title: TOOL_TITLES[tool.name],
    description: tool.description,
    inputSchema: tool.parameters,
    ...(READ_ONLY_TOOLS.has(tool.name) ? { annotations: { readOnlyHint: true } } : {}),
    execute: (input, options) =>
      enqueue(async () => {
        if (!host.isPhotoOpen()) return textResult(NO_PHOTO_MESSAGE, true);
        const ctx: ToolContext = {
          opState: host.getOpState(),
          imageStats: host.getImageStats(),
          segment: host.segment,
          invertMask: host.invertMask,
          createMask: host.createMask,
          getMaskBounds: host.getMaskBounds,
          signal: options?.signal,
        };
        const outcome = await executeTool(tool.name, input, ctx);
        if (outcome.changed) host.applyOpState(outcome.opState);
        return toToolResult(outcome.result);
      }),
  }));

  const getEditState: ModelContextTool = {
    name: WEBMCP_TOOL_NAMES.getEditState,
    title: TOOL_TITLES[WEBMCP_TOOL_NAMES.getEditState],
    description: [
      "Read the current state of the PixlPal editor: whether a photo is open,",
      "the declarative pipeline of active operations (the same JSON shown in the",
      "editor's pipeline panel), the masks available for local edits, and",
      "whether undo/redo are available. Call this first to see what the user",
      "and you have done so far before making further edits.",
    ].join(" "),
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: () => enqueue(async () => textResult(editStateText(host.getEditState()))),
  };

  return [...bridged, getEditState];
}

export interface RegisterWebMcpResult {
  registered: string[];
  /** Tools the ModelContext rejected (e.g. duplicate names on a hot reload). */
  failed: Array<{ name: string; error: unknown }>;
}

/**
 * Register every PixlPal tool on a ModelContext. Aborting `options.signal`
 * unregisters them (per spec `ModelContextRegisterToolOptions.signal`).
 */
export async function registerWebMcpTools(
  modelContext: ModelContext,
  host: WebMcpHost,
  options?: ModelContextRegisterToolOptions,
): Promise<RegisterWebMcpResult> {
  const result: RegisterWebMcpResult = { registered: [], failed: [] };
  for (const tool of createWebMcpTools(host)) {
    try {
      await modelContext.registerTool(tool, options);
      result.registered.push(tool.name);
    } catch (error) {
      result.failed.push({ name: tool.name, error });
    }
  }
  return result;
}
