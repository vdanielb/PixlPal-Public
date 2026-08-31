/**
 * Dev-only stand-in for the browser's WebMCP `ModelContext`.
 *
 * Real WebMCP needs Chrome with the WebMCP flag or an agentic browser. To
 * exercise the bridge locally without either, load the app with
 * `?webmcp-stub` in dev mode: this installs a spec-shaped
 * `document.modelContext` before React mounts and exposes a console driver:
 *
 *   __webmcp.listTools()
 *   __webmcp.callTool("set_operations", { operations: [{ op: "grain" }] })
 *
 * Inputs and results are JSON round-tripped, matching how the spec marshals
 * tool calls, so behavior under the stub matches a real agent's view.
 */

import type {
  ModelContext,
  ModelContextRegisterToolOptions,
  ModelContextTool,
} from "./modelContext";

export interface WebMcpStubDriver {
  listTools(): Array<{ name: string; title?: string; description: string }>;
  describeTool(name: string): ModelContextTool | undefined;
  callTool(name: string, input?: Record<string, unknown>): Promise<unknown>;
}

declare global {
  // eslint-disable-next-line no-var
  var __webmcp: WebMcpStubDriver | undefined;
}

export function installWebMcpStub(): WebMcpStubDriver {
  const tools = new Map<string, ModelContextTool>();

  const modelContext: ModelContext = {
    registerTool(tool: ModelContextTool, options?: ModelContextRegisterToolOptions) {
      if (!tool.name || !tool.description) {
        return Promise.reject(new TypeError("tool name and description must be non-empty"));
      }
      if (tools.has(tool.name)) {
        return Promise.reject(new Error(`a tool named "${tool.name}" is already registered`));
      }
      tools.set(tool.name, tool);
      options?.signal?.addEventListener("abort", () => tools.delete(tool.name), { once: true });
      return Promise.resolve(undefined);
    },
  };

  Object.defineProperty(document, "modelContext", { value: modelContext, configurable: true });

  const driver: WebMcpStubDriver = {
    listTools: () =>
      [...tools.values()].map(({ name, title, description }) => ({ name, title, description })),
    describeTool: (name) => tools.get(name),
    callTool: async (name, input = {}) => {
      const tool = tools.get(name);
      if (!tool) {
        throw new Error(`no tool named "${name}". Registered: ${[...tools.keys()].join(", ")}`);
      }
      const marshalled = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
      const result = await tool.execute(marshalled, { signal: new AbortController().signal });
      return JSON.parse(JSON.stringify(result ?? null)) as unknown;
    },
  };

  globalThis.__webmcp = driver;
  console.info(
    "[webmcp] dev stub installed on document.modelContext — drive it with __webmcp.listTools() and __webmcp.callTool(name, input)",
  );
  return driver;
}
