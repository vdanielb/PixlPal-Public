import { describe, expect, it } from "vitest";
import { TOOL_NAMES, type ImageStats } from "@pixelcam/ai";
import type { OpState } from "../pipelineState";
import {
  createWebMcpTools,
  registerWebMcpTools,
  WEBMCP_TOOL_NAMES,
  type WebMcpHost,
} from "./bridge";
import type {
  ModelContext,
  ModelContextRegisterToolOptions,
  ModelContextTool,
  ModelContextToolResult,
} from "./modelContext";

const STATS: ImageStats = {
  width: 640,
  height: 480,
  meanLuma: 0.5,
  blackPoint: 0.02,
  whitePoint: 0.97,
  clippedShadows: 0.001,
  clippedHighlights: 0.002,
  meanSaturation: 0.3,
  colorCast: 0.05,
};

/** In-memory editor standing in for App: state updates are synchronous. */
function makeHost(overrides: Partial<WebMcpHost> = {}): WebMcpHost & { opState: OpState } {
  const host: WebMcpHost & { opState: OpState } = {
    opState: {},
    isPhotoOpen: () => true,
    getOpState: () => host.opState,
    applyOpState: (next: OpState) => {
      host.opState = next;
    },
    getImageStats: () => STATS,
    getEditState: () => ({
      photo: { fileName: "photo.jpg", width: 640, height: 480 },
      pipelineJson: '{"version":1,"operations":[]}',
      masks: [{ id: "m1", prompt: "the dress", coverage: 0.25, inverted: false }],
      canUndo: true,
      canRedo: false,
    }),
    ...overrides,
  };
  return host;
}

function toolByName(tools: ModelContextTool[], name: string): ModelContextTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  return tool;
}

async function call(
  tool: ModelContextTool,
  input: Record<string, unknown> = {},
): Promise<ModelContextToolResult> {
  return (await tool.execute(input)) as ModelContextToolResult;
}

function text(result: ModelContextToolResult): string {
  return result.content.map((part) => part.text).join("\n");
}

describe("createWebMcpTools", () => {
  it("exposes every ai/ tool plus get_edit_state, with schemas and descriptions", () => {
    const tools = createWebMcpTools(makeHost());
    expect(tools.map((tool) => tool.name)).toEqual([
      TOOL_NAMES.setOperations,
      TOOL_NAMES.removeOperations,
      TOOL_NAMES.resetEdits,
      TOOL_NAMES.getImageStats,
      TOOL_NAMES.segment,
      TOOL_NAMES.setFrame,
      TOOL_NAMES.invertMask,
      TOOL_NAMES.createMask,
      WEBMCP_TOOL_NAMES.getEditState,
    ]);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      expect(tool.title).toBeTruthy();
    }
  });

  it("marks the read-only tools with readOnlyHint", () => {
    const tools = createWebMcpTools(makeHost());
    expect(toolByName(tools, TOOL_NAMES.getImageStats).annotations?.readOnlyHint).toBe(true);
    expect(toolByName(tools, WEBMCP_TOOL_NAMES.getEditState).annotations?.readOnlyHint).toBe(true);
    expect(toolByName(tools, TOOL_NAMES.setOperations).annotations?.readOnlyHint).toBeUndefined();
  });

  it("applies set_operations to the host and reports the resulting pipeline", async () => {
    const host = makeHost();
    const tools = createWebMcpTools(host);
    const result = await call(toolByName(tools, TOOL_NAMES.setOperations), {
      operations: [{ op: "grain", params: { amount: 0.5 } }],
    });

    expect(result.isError).toBeUndefined();
    expect(text(result)).toContain("grain");
    expect(text(result)).toContain('"pipeline"');
    expect(host.opState.grain?.params.amount).toBe(0.5);
  });

  it("composes back-to-back calls instead of clobbering earlier ones", async () => {
    const host = makeHost();
    const tools = createWebMcpTools(host);
    const setOperations = toolByName(tools, TOOL_NAMES.setOperations);

    // Fired without awaiting in between, like one agent turn issuing two calls.
    const [first, second] = await Promise.all([
      call(setOperations, { operations: [{ op: "grain", params: { amount: 0.4 } }] }),
      call(setOperations, { operations: [{ op: "vignette", params: { amount: 0.3 } }] }),
    ]);

    expect(first.isError).toBeUndefined();
    expect(second.isError).toBeUndefined();
    expect(host.opState.grain?.params.amount).toBe(0.4);
    expect(host.opState.vignette?.params.amount).toBe(0.3);
  });

  it("returns validation failures as isError results without touching state", async () => {
    const host = makeHost();
    const tools = createWebMcpTools(host);
    const result = await call(toolByName(tools, TOOL_NAMES.setOperations), {
      operations: [{ op: "sharpen_everything" }],
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('unknown operation "sharpen_everything"');
    expect(host.opState).toEqual({});
  });

  it("refuses editing tools when no photo is open", async () => {
    const host = makeHost({ isPhotoOpen: () => false });
    const tools = createWebMcpTools(host);
    const result = await call(toolByName(tools, TOOL_NAMES.setOperations), {
      operations: [{ op: "grain" }],
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("No photo is open");
    expect(host.opState).toEqual({});
  });

  it("routes segment to the host and surfaces the mask id", async () => {
    const host = makeHost({
      segment: async (prompt) => ({ maskId: `mask_${prompt}`, coverage: 0.42 }),
    });
    const tools = createWebMcpTools(host);
    const result = await call(toolByName(tools, TOOL_NAMES.segment), { prompt: "sky" });

    expect(result.isError).toBeUndefined();
    expect(text(result)).toContain("mask_sky");
    expect(text(result)).toContain("42.0%");
  });

  it("routes set_frame subject crops through the host's mask bounds", async () => {
    const host = makeHost({
      getMaskBounds: async () => ({ bounds: { x: 0.5, y: 0.25, width: 0.25, height: 0.5 } }),
    });
    const tools = createWebMcpTools(host);
    const result = await call(toolByName(tools, TOOL_NAMES.setFrame), {
      subjectMaskId: "person",
      aspect: "4:5",
    });

    expect(result.isError).toBeUndefined();
    expect(text(result)).toContain("crop");
    const crop = host.opState.frame?.crop;
    expect(crop).toBeDefined();
    // Crop contains the subject.
    expect(crop!.x).toBeLessThanOrEqual(0.5);
    expect(crop!.x + crop!.width).toBeGreaterThanOrEqual(0.75);
  });

  it("reports the editor snapshot through get_edit_state", async () => {
    const tools = createWebMcpTools(makeHost());
    const result = await call(toolByName(tools, WEBMCP_TOOL_NAMES.getEditState));

    expect(result.isError).toBeUndefined();
    const body = text(result);
    expect(body).toContain('Photo "photo.jpg" (640x480) is open.');
    expect(body).toContain('{"version":1,"operations":[]}');
    expect(body).toContain('m1 (mask for "the dress", ~25.0% of frame)');
    expect(body).toContain("Undo available: true.");
  });

  it("keeps results JSON-serializable, as the spec marshals them", async () => {
    const tools = createWebMcpTools(makeHost());
    const result = await call(toolByName(tools, TOOL_NAMES.getImageStats));
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe("registerWebMcpTools", () => {
  function makeModelContext() {
    const registered = new Map<string, ModelContextTool>();
    const modelContext: ModelContext = {
      registerTool(tool: ModelContextTool, options?: ModelContextRegisterToolOptions) {
        if (registered.has(tool.name)) {
          return Promise.reject(new Error(`duplicate tool "${tool.name}"`));
        }
        registered.set(tool.name, tool);
        options?.signal?.addEventListener("abort", () => registered.delete(tool.name), {
          once: true,
        });
        return Promise.resolve(undefined);
      },
    };
    return { modelContext, registered };
  }

  it("registers all tools and unregisters them when the signal aborts", async () => {
    const { modelContext, registered } = makeModelContext();
    const controller = new AbortController();

    const result = await registerWebMcpTools(modelContext, makeHost(), {
      signal: controller.signal,
    });
    expect(result.registered).toHaveLength(9);
    expect(result.failed).toHaveLength(0);
    expect(registered.size).toBe(9);

    controller.abort();
    expect(registered.size).toBe(0);
  });

  it("collects per-tool failures instead of throwing", async () => {
    const { modelContext } = makeModelContext();
    await registerWebMcpTools(modelContext, makeHost());
    const second = await registerWebMcpTools(modelContext, makeHost());

    expect(second.registered).toHaveLength(0);
    expect(second.failed).toHaveLength(9);
  });
});
