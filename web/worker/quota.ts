/**
 * Anonymous chat quota without accounts.
 *
 * Each browser gets an HttpOnly visitor cookie. KV stores which chat ids that
 * visitor has already opened. A chat counts once when its id is first seen;
 * later turns and tool rounds for the same id are free. Clearing cookies (or
 * another device) starts a fresh quota — that is the trade-off of no login.
 */

export const VISITOR_COOKIE = "pixelcam_vid";
export const DEFAULT_CHAT_LIMIT = 3;
/** Cookie Max-Age and KV record TTL — keep them aligned. */
export const VISITOR_TTL_SECONDS = 60 * 60 * 24 * 365;

export interface ChatQuota {
  used: number;
  limit: number;
  remaining: number;
}

export interface VisitorRecord {
  chatIds: string[];
  updatedAt: number;
}

const CHAT_ID_RE = /^[a-zA-Z0-9_-]{8,80}$/;

export function isValidChatId(chatId: string): boolean {
  return CHAT_ID_RE.test(chatId);
}

export function quotaFromRecord(record: VisitorRecord | null, limit: number): ChatQuota {
  const used = record?.chatIds.length ?? 0;
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

export function parseVisitorRecord(raw: string | null): VisitorRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<VisitorRecord>;
    if (!Array.isArray(parsed.chatIds)) return null;
    const chatIds = parsed.chatIds.filter(
      (id): id is string => typeof id === "string" && isValidChatId(id),
    );
    return {
      chatIds,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Admit a chat for this visitor. Returns null when the limit is already full
 * and `chatId` is new. Idempotent for chats the visitor already opened.
 */
export function admitChat(
  record: VisitorRecord | null,
  chatId: string,
  limit: number,
): { record: VisitorRecord; quota: ChatQuota; isNew: boolean } | null {
  const existing = record ?? { chatIds: [], updatedAt: Date.now() };
  if (existing.chatIds.includes(chatId)) {
    return {
      record: existing,
      quota: quotaFromRecord(existing, limit),
      isNew: false,
    };
  }
  if (existing.chatIds.length >= limit) {
    return null;
  }
  const next: VisitorRecord = {
    chatIds: [...existing.chatIds, chatId],
    updatedAt: Date.now(),
  };
  return {
    record: next,
    quota: quotaFromRecord(next, limit),
    isNew: true,
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
