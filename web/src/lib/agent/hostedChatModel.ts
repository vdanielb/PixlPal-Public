/**
 * ChatModel that talks to our Worker instead of a user-supplied key.
 *
 * The agent loop stays in the browser; each `complete()` call is one POST to
 * `/api/agent`. The Worker enforces the anonymous chat quota and holds the key.
 */

import type {
  ChatMessage,
  ChatModel,
  CompletionRequest,
  CompletionResponse,
  ToolCall,
} from "@pixelcam/ai";
import type { ResponsesOutputItem } from "./byokChatModel";
import { defaultHostedLimits, type HostedLimits } from "./limits";

export type { HostedLimits };

export interface ChatQuota {
  used: number;
  limit: number;
  remaining: number;
}

export interface HostedQuotaSnapshot {
  quota: ChatQuota;
  limits: HostedLimits;
}

export class HostedAgentError extends Error {
  readonly status: number;
  readonly quota: ChatQuota | null;

  constructor(message: string, status: number, quota: ChatQuota | null = null) {
    super(message);
    this.name = "HostedAgentError";
    this.status = status;
    this.quota = quota;
  }
}

export interface HostedChatModelOptions {
  /** Opaque id for the current conversation thread. */
  chatId: string;
  /** Called whenever the Worker returns a quota snapshot. */
  onQuota?: (quota: ChatQuota) => void;
  /** Called when the Worker reports the current message/output caps. */
  onLimits?: (limits: HostedLimits) => void;
}

interface HostedSuccessBody {
  content?: string | null;
  toolCalls?: ToolCall[];
  cachedOutput?: ResponsesOutputItem[] | null;
  quota?: ChatQuota;
  limits?: HostedLimits;
  error?: string;
}

interface HostedErrorBody {
  error?: string;
  quota?: ChatQuota;
  limits?: HostedLimits;
}

async function readError(response: Response): Promise<HostedAgentError> {
  let message = `Hosted assistant returned ${response.status}.`;
  let quota: ChatQuota | null = null;
  try {
    const body = (await response.json()) as HostedErrorBody;
    if (body.error) message = body.error;
    if (body.quota) quota = body.quota;
  } catch {
    // keep default message
  }
  return new HostedAgentError(message, response.status, quota);
}

function readLimits(body: { limits?: HostedLimits }): HostedLimits | null {
  const limits = body.limits;
  if (!limits) return null;
  if (typeof limits.maxUserMessageChars !== "number") return null;
  if (typeof limits.maxOutputTokens !== "number") return null;
  return limits;
}

export async function fetchHostedQuota(signal?: AbortSignal): Promise<HostedQuotaSnapshot | null> {
  try {
    const response = await fetch("/api/agent/quota", {
      method: "GET",
      credentials: "same-origin",
      signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { quota?: ChatQuota; limits?: HostedLimits };
    if (!body.quota) return null;
    return { quota: body.quota, limits: readLimits(body) ?? defaultHostedLimits() };
  } catch {
    return null;
  }
}

/**
 * One tool-free completion via the Worker's quota-free suggestion route.
 * Returns the raw reply text, or null on any failure — suggestions are a
 * nicety, so callers fall back instead of surfacing errors.
 */
export async function fetchHostedSuggestion(
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const response = await fetch("/api/agent/suggest", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({ messages }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { content?: string | null };
    return body.content ?? null;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return null;
  }
}

export function createHostedChatModel(options: HostedChatModelOptions): ChatModel {
  const cachedOutput: { current: ResponsesOutputItem[] | null } = { current: null };

  return {
    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      let response: Response;
      try {
        response = await fetch("/api/agent", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          signal: request.signal,
          body: JSON.stringify({
            chatId: options.chatId,
            messages: request.messages,
            tools: request.tools,
            cachedOutput: cachedOutput.current,
          }),
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new HostedAgentError(
          "Could not reach the hosted assistant. Is the app running behind the Cloudflare Worker?",
          0,
        );
      }

      if (!response.ok) {
        const err = await readError(response);
        if (err.quota) options.onQuota?.(err.quota);
        throw err;
      }

      const body = (await response.json()) as HostedSuccessBody;
      if (body.quota) options.onQuota?.(body.quota);
      const limits = readLimits(body);
      if (limits) options.onLimits?.(limits);
      cachedOutput.current = body.cachedOutput ?? null;

      return {
        content: body.content ?? null,
        toolCalls: body.toolCalls ?? [],
      };
    },
  };
}
