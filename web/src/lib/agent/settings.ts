/**
 * Optional bring-your-own-key overrides for the agent's model.
 *
 * The product default is the hosted `/api/agent` Worker (server-held key +
 * anonymous chat quota). Filling these in switches the browser to talk to an
 * OpenAI-compatible endpoint directly — useful for local mocks (`pnpm mock:llm`)
 * or unlimited personal use. GPT-5.6+ models are routed to `/responses`;
 * everything else uses `/chat/completions`.
 */

export interface AgentSettings {
  /** OpenAI-compatible base, e.g. `https://api.openai.com/v1`. */
  baseUrl: string;
  model: string;
  /** Kept in localStorage. Local servers usually need no key at all. */
  apiKey: string;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5.6-luna",
  apiKey: "",
};

const STORAGE_KEY = "pixelcam.agent.settings";

export function loadAgentSettings(): AgentSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AGENT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AgentSettings>;
    return {
      baseUrl: parsed.baseUrl?.trim() || DEFAULT_AGENT_SETTINGS.baseUrl,
      model: parsed.model?.trim() || DEFAULT_AGENT_SETTINGS.model,
      apiKey: parsed.apiKey ?? "",
    };
  } catch {
    return DEFAULT_AGENT_SETTINGS;
  }
}

export function saveAgentSettings(settings: AgentSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing or a full quota: the session still works, it just
    // will not be remembered.
  }
}

/** A local endpoint needs no key; a remote one does. */
export function isAgentConfigured(settings: AgentSettings): boolean {
  if (!settings.baseUrl.trim() || !settings.model.trim()) return false;
  return settings.apiKey.trim() !== "" || isLocalEndpoint(settings.baseUrl);
}

export function isLocalEndpoint(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}
