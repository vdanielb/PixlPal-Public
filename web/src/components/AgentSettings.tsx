import {
  DEFAULT_AGENT_SETTINGS,
  isAgentConfigured,
  isLocalEndpoint,
  type AgentSettings as Settings,
} from "../lib/agent/settings";

export function AgentSettings({
  settings,
  onChange,
  hosted,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
  /** When true, the product Worker is the default path and BYOK is optional. */
  hosted?: boolean;
}) {
  const configured = isAgentConfigured(settings);
  const local = isLocalEndpoint(settings.baseUrl);

  return (
    <details className="agent-settings" open={hosted ? configured : !configured}>
      <summary>
        {hosted ? "Use your own API key" : "Model settings"}
        <small data-ok={configured || undefined}>
          {hosted
            ? configured
              ? `BYOK · ${settings.model}`
              : "optional"
            : configured
              ? settings.model
              : "not configured"}
        </small>
      </summary>

      <fieldset>
        <label>
          Endpoint
          <input
            type="url"
            value={settings.baseUrl}
            placeholder={DEFAULT_AGENT_SETTINGS.baseUrl}
            onChange={(event) => onChange({ ...settings, baseUrl: event.target.value })}
          />
        </label>
        <label>
          Model
          <input
            type="text"
            value={settings.model}
            placeholder={DEFAULT_AGENT_SETTINGS.model}
            onChange={(event) => onChange({ ...settings, model: event.target.value })}
          />
        </label>
        <label>
          API key
          <input
            type="password"
            value={settings.apiKey}
            autoComplete="off"
            placeholder={local ? "not needed for a local server" : "sk-…"}
            onChange={(event) => onChange({ ...settings, apiKey: event.target.value })}
          />
        </label>
      </fieldset>

      <p className="hint">
        {hosted
          ? "Leave this empty to use the built-in assistant (limited free chats). Fill it in to talk to your own OpenAI-compatible endpoint instead — useful for local mocks or unlimited personal use. Your key stays in this browser only."
          : "OpenAI GPT-5.6+ models use the Responses API automatically; other OpenAI-compatible endpoints (Ollama, LM Studio, Groq, …) keep using Chat Completions. Your key is stored in this browser only and sent straight to that endpoint."}{" "}
        Each turn includes a downscaled JPEG preview of the current look plus the pipeline and
        measurements — full-resolution pixels stay on this device.
      </p>
    </details>
  );
}
