/**
 * Minimal typings and feature detection for the WebMCP `ModelContext` API.
 *
 * The spec (https://webmachinelearning.github.io/webmcp/) exposes the API on
 * `document.modelContext`; earlier Chrome previews shipped it on
 * `navigator.modelContext`. We detect both so the same build works in
 * Chrome-with-flag and agentic browsers regardless of which surface they ship.
 */

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

export interface ToolExecuteCallbackOptions {
  signal?: AbortSignal;
}

/** MCP-style tool result: JSON-serializable, so agents on either side of the spec can read it. */
export interface ModelContextToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface ModelContextTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  execute: (
    input: Record<string, unknown>,
    options?: ToolExecuteCallbackOptions,
  ) => Promise<unknown>;
  annotations?: ToolAnnotations;
}

export interface ModelContextRegisterToolOptions {
  signal?: AbortSignal;
}

export interface ModelContext {
  registerTool(
    tool: ModelContextTool,
    options?: ModelContextRegisterToolOptions,
  ): Promise<unknown> | unknown;
}

type ModelContextCarrier = { modelContext?: ModelContext };

/** The page's ModelContext, or null when the browser has no WebMCP support. */
export function getModelContext(): ModelContext | null {
  if (typeof document !== "undefined") {
    const context = (document as unknown as ModelContextCarrier).modelContext;
    if (context && typeof context.registerTool === "function") return context;
  }
  if (typeof navigator !== "undefined") {
    const context = (navigator as unknown as ModelContextCarrier).modelContext;
    if (context && typeof context.registerTool === "function") return context;
  }
  return null;
}
