import { useEffect, useRef, useState } from "react";
import type { AgentApi } from "../lib/useAgent";
import type { AgentSettings as Settings } from "../lib/agent/settings";
import { formatTurnClock, formatTurnClockIso } from "../lib/formatTurnClock";
import type { SuggestionsState } from "../lib/useSuggestions";
import { AgentSettings } from "./AgentSettings";
import { ChatMessage } from "./ChatMessage";

export function ChatPanel({
  agent,
  settings,
  onSettingsChange,
  suggestions,
}: {
  agent: AgentApi;
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  /** First-prompt chips, generated from the open photo by the agent model. */
  suggestions: SuggestionsState;
}) {
  const [draft, setDraft] = useState("");
  const transcriptRef = useRef<HTMLOListElement>(null);
  const hosted = agent.transport === "hosted";
  const atChatLimit =
    hosted && !!agent.quota && agent.quota.remaining <= 0 && agent.entries.length === 0;
  const maxChars = hosted ? agent.limits.maxUserMessageChars : null;
  const overLimit = maxChars !== null && draft.length > maxChars;

  const [elapsedMs, setElapsedMs] = useState(0);
  const runStartedAt = useRef<number | null>(null);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [agent.entries, agent.running, elapsedMs]);

  useEffect(() => {
    if (!agent.running) {
      runStartedAt.current = null;
      return;
    }
    runStartedAt.current = Date.now();
    setElapsedMs(0);
    const id = window.setInterval(() => {
      const started = runStartedAt.current;
      if (started != null) setElapsedMs(Date.now() - started);
    }, 250);
    return () => window.clearInterval(id);
  }, [agent.running]);

  const submit = (prompt: string) => {
    if (agent.running || atChatLimit) return;
    if (maxChars !== null && prompt.trim().length > maxChars) return;
    agent.send(prompt);
    setDraft("");
  };

  return (
    <aside className="chat" aria-label="AI assistant">
      <header>
        <h2>Assistant</h2>
        <p className="chat-meta">
          {hosted && agent.quota ? (
            <small>
              {agent.quota.remaining} of {agent.quota.limit} chats left
            </small>
          ) : null}
          {agent.entries.length > 0 && (
            <button
              onClick={agent.clear}
              disabled={agent.running || (hosted && !!agent.quota && agent.quota.remaining <= 0)}
              title={
                hosted && agent.quota && agent.quota.remaining <= 0
                  ? "Chat limit reached — continue this chat or use your own API key"
                  : "Start a new chat"
              }
            >
              New chat
            </button>
          )}
        </p>
      </header>

      <ol className="transcript" ref={transcriptRef} aria-live="polite">
        {agent.entries.length === 0 ? (
          <li className="message intro">
            <article>
              <p>
                {atChatLimit
                  ? `You've used all ${agent.quota?.limit ?? 3} free chats in this browser. Open Model settings below to use your own API key, or keep editing with the sliders.`
                  : "Describe the look you want and I will work the controls on the left. Everything I do shows up on the sliders, and you can undo it."}
              </p>
            </article>
          </li>
        ) : (
          agent.entries.map((entry) => (
            <ChatMessage key={entry.id} entry={entry} onRevert={agent.revertTo} />
          ))
        )}
        {agent.running && (
          <li className="message working">
            <article>
              <p>Working on it…</p>
              <time dateTime={formatTurnClockIso(elapsedMs)}>{formatTurnClock(elapsedMs)}</time>
            </article>
          </li>
        )}
      </ol>

      {agent.entries.length === 0 && !atChatLimit && (
        <menu
          className="suggestions"
          aria-label="Suggested edits"
          data-loading={suggestions.loading || undefined}
        >
          {suggestions.suggestions.map((suggestion) => (
            <li key={suggestion}>
              <button onClick={() => submit(suggestion)} disabled={agent.running}>
                {suggestion}
              </button>
            </li>
          ))}
          {suggestions.loading && (
            <li className="suggestions-hint">
              <p>Looking at your photo for ideas…</p>
            </li>
          )}
        </menu>
      )}

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit(draft);
        }}
      >
        <textarea
          rows={2}
          value={draft}
          aria-label="Message the assistant"
          aria-describedby={maxChars !== null && !atChatLimit ? "composer-count" : undefined}
          placeholder={atChatLimit ? "Chat limit reached…" : "Make it feel like golden hour…"}
          disabled={atChatLimit}
          maxLength={maxChars ?? undefined}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit(draft);
            }
          }}
        />
        {maxChars !== null && !atChatLimit ? (
          <small id="composer-count" className="composer-count" data-over={overLimit || undefined}>
            {draft.length} / {maxChars}
          </small>
        ) : null}
        {agent.running ? (
          <button type="button" onClick={agent.cancel}>
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className="primary"
            disabled={atChatLimit || overLimit || draft.trim() === ""}
          >
            Send
          </button>
        )}
      </form>

      <AgentSettings settings={settings} onChange={onSettingsChange} hosted={hosted} />
    </aside>
  );
}
