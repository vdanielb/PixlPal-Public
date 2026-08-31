/**
 * Hosted-assistant spend caps beyond the anonymous chat quota.
 *
 * A 5-minute *turn* timer is the wrong spend lever: a reasoning model can
 * burn its output budget in seconds, and a slow first-time Florence-2 load
 * (on-device, free) would get blamed for "running too long." Cap the thing
 * we pay for instead — generated tokens, including hidden reasoning tokens
 * on GPT-5.6 — and keep a short per-completion hang timeout on the Worker.
 *
 * User-visible input is still a character cap: tokenizers differ, vision
 * tokens from the preview JPEG are already bounded by downscaling, and the
 * composer can show "n / 1000."
 */

export const DEFAULT_MAX_USER_MESSAGE_CHARS = 1000;
/** Includes reasoning + tool JSON + the short reply. Tight enough to stop a dump. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
/** Hang guard for one Worker → model HTTP call, not a product-facing turn cap. */
export const DEFAULT_COMPLETION_TIMEOUT_MS = 90_000;

export interface HostedLimits {
  maxUserMessageChars: number;
  maxOutputTokens: number;
}

export function defaultHostedLimits(): HostedLimits {
  return {
    maxUserMessageChars: DEFAULT_MAX_USER_MESSAGE_CHARS,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  };
}

/** Flatten untrusted message content to a user-visible character count. */
export function userTextCharCount(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  let total = 0;
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const record = part as { type?: unknown; text?: unknown };
    if (record.type === "text" && typeof record.text === "string") {
      total += record.text.length;
    }
  }
  return total;
}

/**
 * Length of the first user message that exceeds `maxChars`, or null when
 * every user turn is within the cap. Images do not count.
 */
export function oversizedUserMessageChars(messages: unknown, maxChars: number): number | null {
  if (!Array.isArray(messages)) return null;
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const record = message as { role?: unknown; content?: unknown };
    if (record.role !== "user") continue;
    const count = userTextCharCount(record.content);
    if (count > maxChars) return count;
  }
  return null;
}

export function isUserMessageWithinLimit(text: string, maxChars: number): boolean {
  return text.length <= maxChars;
}

/** "90 seconds", "1 minute" — for hang-timeout error copy. */
export function formatDuration(ms: number): string {
  if (ms <= 0) return "0 seconds";
  if (ms % 60_000 === 0) {
    const minutes = ms / 60_000;
    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  }
  const seconds = Math.round(ms / 1000);
  return seconds === 1 ? "1 second" : `${seconds} seconds`;
}

/**
 * Attach a generated-token cap to an OpenAI-compatible request body.
 * Responses uses `max_output_tokens`; Chat Completions uses `max_tokens`.
 */
export function applyOutputTokenLimit(
  body: Record<string, unknown>,
  usesResponses: boolean,
  maxOutputTokens?: number,
): Record<string, unknown> {
  if (!maxOutputTokens || maxOutputTokens <= 0) return body;
  if (usesResponses) {
    body.max_output_tokens = maxOutputTokens;
  } else {
    body.max_tokens = maxOutputTokens;
  }
  return body;
}
