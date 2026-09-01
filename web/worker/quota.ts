/**
 * Anonymous chat quota without accounts.
 *
 * Each browser gets an HttpOnly visitor cookie, and a Durable Object per
 * visitor (see visitorQuota.ts) stores which chat ids that visitor has
 * already opened and how many model completions each of those chats has
 * consumed. A chat takes a quota slot when its id is first seen; after that
 * every completion (user turns and tool rounds alike) is charged against
 * that chat's finite budget, so one admitted id cannot be replayed with
 * fresh transcripts forever — the Worker never sees more than
 * `limit × budget` completions per visitor. Clearing cookies (or another
 * device) starts a fresh quota — that is the trade-off of no login.
 *
 * This module is the pure decision logic, kept free of Workers runtime
 * types so it unit-tests in plain Node.
 */

export const VISITOR_COOKIE = "pixelcam_vid";
export const DEFAULT_CHAT_LIMIT = 3;
/**
 * Completions one chat may consume. A turn costs 1 + one per tool round
 * (at most ~9 with the loop's 8-step cap), so 60 is roomy for honest chats
 * while still bounding a spoofed transcript to a finite spend.
 */
export const DEFAULT_MAX_COMPLETIONS_PER_CHAT = 60;
/** Cookie Max-Age and KV record TTL — keep them aligned. */
export const VISITOR_TTL_SECONDS = 60 * 60 * 24 * 365;

export interface ChatQuota {
  used: number;
  limit: number;
  remaining: number;
}

export interface ChatUsage {
  id: string;
  /** Completions this chat has consumed so far. */
  completions: number;
}

export interface VisitorRecord {
  chats: ChatUsage[];
  updatedAt: number;
}

const CHAT_ID_RE = /^[a-zA-Z0-9_-]{8,80}$/;

export function isValidChatId(chatId: string): boolean {
  return CHAT_ID_RE.test(chatId);
}

export function quotaFromRecord(record: VisitorRecord | null, limit: number): ChatQuota {
  const used = record?.chats.length ?? 0;
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

export type AdmitResult =
  | {
      kind: "admitted";
      /** The record with this completion already charged; persist it. */
      record: VisitorRecord;
      quota: ChatQuota;
      isNewChat: boolean;
    }
  /** A new chat id, but the visitor's chat slots are full. */
  | { kind: "chat_limit"; quota: ChatQuota }
  /** A known chat id whose completion budget is spent. */
  | { kind: "chat_exhausted"; quota: ChatQuota };

/** What the visitor's Durable Object reports back to the Worker. */
export interface AdmitDecision {
  kind: AdmitResult["kind"];
  quota: ChatQuota;
}

/**
 * Admit one model completion for this visitor's chat. New chat ids take a
 * quota slot (or are refused when the limit is full); known ids are charged
 * against their per-chat completion budget.
 */
export function admitCompletion(
  record: VisitorRecord | null,
  chatId: string,
  limit: number,
  completionBudget: number,
): AdmitResult {
  const existing = record ?? { chats: [], updatedAt: Date.now() };
  const quota = quotaFromRecord(existing, limit);
  const known = existing.chats.find((chat) => chat.id === chatId);

  if (known) {
    if (known.completions >= completionBudget) {
      return { kind: "chat_exhausted", quota };
    }
    const next: VisitorRecord = {
      chats: existing.chats.map((chat) =>
        chat.id === chatId ? { ...chat, completions: chat.completions + 1 } : chat,
      ),
      updatedAt: Date.now(),
    };
    return { kind: "admitted", record: next, quota, isNewChat: false };
  }

  if (existing.chats.length >= limit) {
    return { kind: "chat_limit", quota };
  }
  const next: VisitorRecord = {
    chats: [...existing.chats, { id: chatId, completions: 1 }],
    updatedAt: Date.now(),
  };
  return {
    kind: "admitted",
    record: next,
    quota: quotaFromRecord(next, limit),
    isNewChat: true,
  };
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) === name) {
      return decodeURIComponent(trimmed.slice(eq + 1));
    }
  }
  return null;
}

export function newVisitorId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function visitorCookieHeader(visitorId: string, secure: boolean): string {
  const parts = [
    `${VISITOR_COOKIE}=${encodeURIComponent(visitorId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    // One year — long enough that casual returning visitors keep their quota.
    `Max-Age=${VISITOR_TTL_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
