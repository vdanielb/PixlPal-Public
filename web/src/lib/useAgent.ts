/**
 * Drives the editing agent for the chat panel.
 *
 * The hook deliberately does not own the edit: `App` does. The agent reports
 * each knob it turns through `onApplyEdit`, so the sliders and the preview
 * update while the model is still working, and a snapshot taken before every
 * turn makes the whole turn revertible.
 *
 * Every user turn attaches a JPEG of the current preview (edits applied) so
 * the model can see the photo. Older turns keep text only to avoid shipping
 * stale frames and to keep the request small.
 *
 * Transport: hosted `/api/agent` by default (product key + anonymous chat
 * quota, 1000-character messages, capped generated tokens). Configuring
 * Model settings switches to BYOK for local/mock use.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_MAX_STEPS,
  TOOL_LABELS,
  runAgent,
  withoutImages,
  type ChatMessage,
  type ImageStats,
  type InvertMaskHost,
  type MaskBoundsHost,
  type SegmentHost,
  type CreateMaskHost,
} from "@pixelcam/ai";
import type { OpState } from "./pipelineState";
import type { EditSnapshot } from "./useEditHistory";
import { createByokChatModel } from "./agent/byokChatModel";
import {
  createHostedChatModel,
  fetchHostedQuota,
  HostedAgentError,
  type ChatQuota,
  type HostedLimits,
} from "./agent/hostedChatModel";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_USER_MESSAGE_CHARS,
  isUserMessageWithinLimit,
} from "./agent/limits";
import { isAgentConfigured, type AgentSettings } from "./agent/settings";
import { newChatId, resolveAgentTransport } from "./agent/transport";
import { encodeImageForAgent } from "./image";

export type { EditSnapshot, ChatQuota, HostedLimits };

export type TranscriptEntry = {
  id: number;
  kind: "user" | "assistant" | "tool" | "notice" | "error";
  text: string;
  /** Tool entries only: whether the call succeeded. */
  failed?: boolean;
  /** Tool entries only: the model asked for this call and the host is still running it. */
  pending?: boolean;
  /** Tool entries only: pairs a start row with its later result. */
  toolCallId?: string;
  /** The edit as it was before this turn, when the turn changed something. */
  revert?: EditSnapshot;
  /** Wall time from Send to this turn finishing, stamped on the last entry. */
  elapsedMs?: number;
};

export interface UseAgentOptions {
  settings: AgentSettings;
  /** The edit right now, captured when a turn starts so it can be reverted. */
  getEditSnapshot: () => EditSnapshot;
  /** Statistics for the open photo, or null when none is open. */
  getImageStats: () => ImageStats | null;
  /** Current preview pixels (edits applied), or null when none is open. */
  getPreviewImage: () => ImageData | null;
  /** Host segmentation; keeps Florence-2 out of the ai package. */
  segment?: SegmentHost;
  /** Host mask invert; creates a selectable complement in MaskStore. */
  invertMask?: InvertMaskHost;
  /** Host parametric mask; engine-computed luminance/color/gradient masks. */
  createMask?: CreateMaskHost;
  /** Host mask bounding box; powers subject-centered set_frame crops. */
  getMaskBounds?: MaskBoundsHost;
  onApplyEdit: (opState: OpState) => void;
}

export interface AgentApi {
  entries: TranscriptEntry[];
  running: boolean;
  /** Hosted anonymous quota, or null when using BYOK / quota unknown. */
  quota: ChatQuota | null;
  /** Hosted message/runtime caps, or defaults when the Worker has not answered yet. */
  limits: HostedLimits;
  transport: "hosted" | "byok";
  send: (prompt: string) => void;
  cancel: () => void;
  clear: () => void;
  revertTo: (snapshot: EditSnapshot) => void;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function buildUserMessage(
  text: string,
  getPreviewImage: () => ImageData | null,
): Promise<ChatMessage> {
  const preview = getPreviewImage();
  if (!preview) {
    return { role: "user", content: text };
  }
  try {
    const encoded = await encodeImageForAgent(preview);
    return {
      role: "user",
      content: [
        { type: "text", text },
        { type: "image", mimeType: encoded.mimeType, dataBase64: encoded.dataBase64 },
      ],
    };
  } catch {
    // Still send the turn as text if encoding fails — better than blocking the chat.
    return { role: "user", content: text };
  }
}

export function useAgent(options: UseAgentOptions): AgentApi {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [quota, setQuota] = useState<ChatQuota | null>(null);
  const [limits, setLimits] = useState<HostedLimits>({
    maxUserMessageChars: DEFAULT_MAX_USER_MESSAGE_CHARS,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  });
  const history = useRef<ChatMessage[]>([]);
  const abort = useRef<AbortController | null>(null);
  const nextId = useRef(0);
  const chatId = useRef(newChatId());

  const transport = resolveAgentTransport(options.settings);

  useEffect(() => {
    if (transport !== "hosted") {
      setQuota(null);
      return;
    }
    const controller = new AbortController();
    void fetchHostedQuota(controller.signal).then((next) => {
      if (controller.signal.aborted || !next) return;
      setQuota(next.quota);
      setLimits(next.limits);
    });
    return () => controller.abort();
  }, [transport]);

  const push = useCallback((entry: Omit<TranscriptEntry, "id">) => {
    nextId.current += 1;
    setEntries((current) => [...current, { ...entry, id: nextId.current }]);
  }, []);

  /** Attach the pre-turn snapshot to the last entry, so it grows an Undo button. */
  const attachRevert = useCallback((snapshot: EditSnapshot) => {
    setEntries((current) =>
      current.map((entry, index) =>
        index === current.length - 1 ? { ...entry, revert: snapshot } : entry,
      ),
    );
  }, []);

  const send = useCallback(
    (prompt: string) => {
      const text = prompt.trim();
      if (!text || abort.current) return;

      const {
        settings,
        getEditSnapshot,
        getImageStats,
        getPreviewImage,
        onApplyEdit,
        segment,
        invertMask,
        createMask,
        getMaskBounds,
      } = optionsRef.current;
      const mode = resolveAgentTransport(settings);

      if (
        mode === "hosted" &&
        quota &&
        quota.remaining <= 0 &&
        history.current.length === 0
      ) {
        push({
          kind: "error",
          text: `Chat limit reached (${quota.limit} chats on this browser). Use your own API key in Model settings, or continue an existing chat.`,
        });
        return;
      }

      const maxChars = mode === "hosted" ? limits.maxUserMessageChars : Number.POSITIVE_INFINITY;
      if (!isUserMessageWithinLimit(text, maxChars)) {
        push({
          kind: "error",
          text: `Messages can be at most ${maxChars} characters on the hosted assistant.`,
        });
        return;
      }

      push({ kind: "user", text });

      if (mode === "byok" && !isAgentConfigured(settings)) {
        push({
          kind: "error",
          text: "No model configured yet. Open Model settings below and add an endpoint, a model name, and an API key.",
        });
        return;
      }

      const before = getEditSnapshot();
      const controller = new AbortController();
      abort.current = controller;
      setRunning(true);
      const startedAt = Date.now();
      let changed = false;

      void (async () => {
        try {
          const userMessage = await buildUserMessage(text, getPreviewImage);
          // Drop prior preview frames so only "how it looks now" crosses the wire.
          const prior = history.current.map(withoutImages);
          const messages: ChatMessage[] = [...prior, userMessage];
          history.current = messages;

          const model =
            mode === "hosted"
              ? createHostedChatModel({
                  chatId: chatId.current,
                  onQuota: setQuota,
                  onLimits: setLimits,
                })
              : createByokChatModel(settings);

          const result = await runAgent({
            model,
            messages,
            opState: before.opState,
            imageStats: getImageStats(),
            segment,
            invertMask,
            createMask,
            getMaskBounds,
            signal: controller.signal,
            onOpState: (opState) => {
              changed = true;
              onApplyEdit(opState);
            },
            onEvent: (event) => {
              if (event.type === "assistant") {
                push({ kind: "assistant", text: event.content });
              } else if (event.type === "tool_start") {
                const label = TOOL_LABELS[event.call.name] ?? event.call.name;
                push({ kind: "tool", pending: true, toolCallId: event.call.id, text: label });
              } else if (event.type === "tool") {
                const label = TOOL_LABELS[event.call.name] ?? event.call.name;
                const text = event.result.ok
                  ? `${label}: ${event.result.summary}`
                  : `${label} failed: ${event.result.error}`;
                const failed = !event.result.ok;
                setEntries((current) => {
                  const index = current.findIndex(
                    (entry) => entry.kind === "tool" && entry.toolCallId === event.call.id,
                  );
                  if (index < 0) {
                    return [
                      ...current,
                      {
                        id: (nextId.current += 1),
                        kind: "tool",
                        toolCallId: event.call.id,
                        failed,
                        text,
                      },
                    ];
                  }
                  return current.map((entry, entryIndex) =>
                    entryIndex === index
                      ? { ...entry, pending: false, failed, text }
                      : entry,
                  );
                });
              }
            },
          });

          history.current = [...messages, ...result.messages];

          if (result.truncated) {
            push({
              kind: "notice",
              text: `Stopped after ${DEFAULT_MAX_STEPS} tool calls to avoid running away. Ask again to keep going.`,
            });
          } else if (!result.reply) {
            push({ kind: "notice", text: "The model finished without saying anything." });
          }
          if (changed) attachRevert(before);
        } catch (error) {
          if (isAbort(error)) {
            push({ kind: "notice", text: "Cancelled." });
          } else if (error instanceof HostedAgentError) {
            if (error.quota) setQuota(error.quota);
            push({ kind: "error", text: error.message });
          } else {
            push({ kind: "error", text: error instanceof Error ? error.message : String(error) });
          }
          if (changed) attachRevert(before);
        } finally {
          const elapsedMs = Date.now() - startedAt;
          setEntries((current) => {
            if (current.length === 0) return current;
            return current.map((entry, index) =>
              index === current.length - 1 ? { ...entry, elapsedMs } : entry,
            );
          });
          abort.current = null;
          setRunning(false);
        }
      })();
    },
    [attachRevert, limits, push, quota],
  );

  const cancel = useCallback(() => {
    abort.current?.abort();
  }, []);

  const clear = useCallback(() => {
    abort.current?.abort();
    history.current = [];
    chatId.current = newChatId();
    setEntries([]);
  }, []);

  const revertTo = useCallback((snapshot: EditSnapshot) => {
    optionsRef.current.onApplyEdit(snapshot.opState);
  }, []);

  return { entries, running, quota, limits, transport, send, cancel, clear, revertTo };
}
