/**
 * Whether the browser should talk to `/api/agent` (product key) or straight to
 * a user-configured OpenAI-compatible endpoint (BYOK / local mock).
 *
 * Hosted is the default launch path. Filling in Model settings opts into BYOK
 * so local development with `pnpm mock:llm` still works without a Worker.
 */

import { isAgentConfigured, type AgentSettings } from "./settings";

export type AgentTransport = "hosted" | "byok";

export function resolveAgentTransport(settings: AgentSettings): AgentTransport {
  return isAgentConfigured(settings) ? "byok" : "hosted";
}

export function newChatId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `chat_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `chat_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
