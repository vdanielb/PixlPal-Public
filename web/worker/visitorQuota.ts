/**
 * One Durable Object per anonymous visitor, holding that visitor's chat
 * quota: which chat ids they have opened and how many completions each chat
 * has consumed. All admissions for a visitor land on the same instance and
 * the read-modify-write happens entirely between storage operations, so the
 * object's input gate makes admission atomic — parallel first messages can
 * no longer race past the chat limit the way the KV version could.
 *
 * The Worker addresses the object with `idFromName(visitorId)` and speaks a
 * tiny internal HTTP protocol:
 *
 *   POST /admit  {chatId, limit, budget}  -> AdmitDecision
 *   GET  /quota?limit=n                   -> { quota: ChatQuota }
 *
 * Storage is reclaimed by an alarm one cookie-lifetime after the last
 * admission, mirroring the old KV record TTL.
 */

import {
  VISITOR_TTL_SECONDS,
  admitCompletion,
  quotaFromRecord,
  type AdmitDecision,
  type VisitorRecord,
} from "./quota";

/** Minimal Durable Object surface, in the spirit of the repo's hand-rolled Worker types. */
interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAll(): Promise<void>;
}

export interface DurableObjectState {
  storage: DurableObjectStorage;
}

const RECORD_KEY = "record";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

export class VisitorQuota {
  private readonly storage: DurableObjectStorage;

  constructor(state: DurableObjectState) {
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/admit") {
      return this.admit(request);
    }
    if (request.method === "GET" && url.pathname === "/quota") {
      const limit = positiveInt(Number.parseInt(url.searchParams.get("limit") ?? "", 10));
      if (!limit) return json({ error: "limit must be a positive integer." }, 400);
      const record = (await this.storage.get<VisitorRecord>(RECORD_KEY)) ?? null;
      return json({ quota: quotaFromRecord(record, limit) });
    }
    return json({ error: "No such route." }, 404);
  }

  private async admit(request: Request): Promise<Response> {
    let body: { chatId?: unknown; limit?: unknown; budget?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }
    const limit = positiveInt(body.limit);
    const budget = positiveInt(body.budget);
    if (typeof body.chatId !== "string" || !limit || !budget) {
      return json({ error: "admit needs a chatId, a limit, and a budget." }, 400);
    }

    const record = (await this.storage.get<VisitorRecord>(RECORD_KEY)) ?? null;
    const result = admitCompletion(record, body.chatId, limit, budget);
    if (result.kind === "admitted") {
      await this.storage.put(RECORD_KEY, result.record);
      // Reclaim storage one cookie-lifetime after the last activity.
      await this.storage.setAlarm(Date.now() + VISITOR_TTL_SECONDS * 1000);
    }

    const decision: AdmitDecision = { kind: result.kind, quota: result.quota };
    return json(decision);
  }

  async alarm(): Promise<void> {
    await this.storage.deleteAll();
  }
}
