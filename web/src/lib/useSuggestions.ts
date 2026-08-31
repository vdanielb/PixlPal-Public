/**
 * Model-generated suggestion chips for the first prompt on a photo.
 *
 * When a photo opens, one tool-free completion (with the preview attached)
 * asks the agent model for a few edits tailored to that photo. Hosted mode
 * uses the Worker's quota-free `/api/agent/suggest` route; BYOK talks to the
 * configured endpoint directly. While the request runs — or when it fails —
 * generic fallback chips keep the panel usable.
 */

import { useEffect, useState } from "react";
import { buildSuggestionMessages, parseSuggestions } from "@pixelcam/ai";
import { createByokChatModel } from "./agent/byokChatModel";
import { fetchHostedSuggestion } from "./agent/hostedChatModel";
import type { AgentSettings } from "./agent/settings";
import { resolveAgentTransport } from "./agent/transport";
import { encodeImageForAgent } from "./image";

export const FALLBACK_SUGGESTIONS = [
  "Make this feel like a warm summer evening",
  "Moody black and white",
  "Fix the exposure",
  "Blur the background behind the subject",
];

export interface SuggestionsState {
  /** Chips to show before the first prompt. */
  suggestions: string[];
  /** True while the model is being asked; the UI shows a subtle hint. */
  loading: boolean;
  /** True when `suggestions` came from the model rather than the fallback. */
  dynamic: boolean;
}

export function useSuggestions(
  settings: AgentSettings,
  image: ImageData | null,
  photoKey: string | null,
): SuggestionsState {
  const [state, setState] = useState<SuggestionsState>({
    suggestions: FALLBACK_SUGGESTIONS,
    loading: false,
    dynamic: false,
  });

  useEffect(() => {
    if (!image || !photoKey) {
      setState({ suggestions: FALLBACK_SUGGESTIONS, loading: false, dynamic: false });
      return;
    }

    const controller = new AbortController();
    setState({ suggestions: FALLBACK_SUGGESTIONS, loading: true, dynamic: false });

    void (async () => {
      try {
        const encoded = await encodeImageForAgent(image);
        const messages = buildSuggestionMessages({
          type: "image",
          mimeType: encoded.mimeType,
          dataBase64: encoded.dataBase64,
        });

        const transport = resolveAgentTransport(settings);
        const content =
          transport === "hosted"
            ? await fetchHostedSuggestion(messages, controller.signal)
            : (
                await createByokChatModel(settings).complete({
                  messages,
                  tools: [],
                  signal: controller.signal,
                })
              ).content ?? null;

        const parsed = parseSuggestions(content);
        if (controller.signal.aborted) return;
        if (parsed.length > 0) {
          setState({ suggestions: parsed, loading: false, dynamic: true });
        } else {
          setState({ suggestions: FALLBACK_SUGGESTIONS, loading: false, dynamic: false });
        }
      } catch {
        if (controller.signal.aborted) return;
        setState({ suggestions: FALLBACK_SUGGESTIONS, loading: false, dynamic: false });
      }
    })();

    return () => controller.abort();
    // Regenerate per photo, not per slider tweak: `image` identity follows
    // photoKey; settings changes retrigger so BYOK toggles take effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoKey, settings]);

  return state;
}
