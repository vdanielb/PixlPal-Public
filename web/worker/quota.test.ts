import { describe, expect, it } from "vitest";
import {
  admitCompletion,
  isValidChatId,
  quotaFromRecord,
  readCookie,
  visitorCookieHeader,
  VISITOR_TTL_SECONDS,
  type VisitorRecord,
} from "./quota";

describe("isValidChatId", () => {
  it("accepts stable opaque ids", () => {
    expect(isValidChatId("chat_abc12345")).toBe(true);
    expect(isValidChatId("a".repeat(8))).toBe(true);
  });

  it("rejects short or decorated ids", () => {
    expect(isValidChatId("short")).toBe(false);
    expect(isValidChatId("has spaces!!")).toBe(false);
  });
});

describe("admitCompletion", () => {
  it("takes a quota slot only the first time a chat id is seen", () => {
    const first = admitCompletion(null, "chat_one___", 3, 60);
    expect(first.kind).toBe("admitted");
    if (first.kind !== "admitted") return;
    expect(first.isNewChat).toBe(true);
    expect(first.quota).toEqual({ used: 1, limit: 3, remaining: 2 });

    const again = admitCompletion(first.record, "chat_one___", 3, 60);
    expect(again.kind).toBe("admitted");
    if (again.kind !== "admitted") return;
    expect(again.isNewChat).toBe(false);
    expect(again.quota.used).toBe(1);
  });

  it("blocks a fourth distinct chat", () => {
    let record: VisitorRecord | null = null;
    for (const id of ["chat_aaa1", "chat_bbb2", "chat_ccc3"]) {
      const admitted = admitCompletion(record, id, 3, 60);
      expect(admitted.kind).toBe("admitted");
      if (admitted.kind !== "admitted") return;
      record = admitted.record;
    }
    expect(admitCompletion(record, "chat_ddd4", 3, 60).kind).toBe("chat_limit");
    expect(quotaFromRecord(record, 3).remaining).toBe(0);
  });

  it("charges every completion and cuts a chat off at its budget", () => {
    let record: VisitorRecord | null = null;
    for (let i = 0; i < 5; i += 1) {
      const admitted = admitCompletion(record, "chat_one___", 3, 5);
      expect(admitted.kind).toBe("admitted");
      if (admitted.kind !== "admitted") return;
      record = admitted.record;
    }
    expect(record?.chats).toEqual([{ id: "chat_one___", completions: 5 }]);

    const refused = admitCompletion(record, "chat_one___", 3, 5);
    expect(refused.kind).toBe("chat_exhausted");
    // An exhausted chat still occupies its quota slot.
    expect(quotaFromRecord(record, 3)).toEqual({ used: 1, limit: 3, remaining: 2 });
    // ...and other chats keep working.
    expect(admitCompletion(record, "chat_two___", 3, 5).kind).toBe("admitted");
  });
});

describe("readCookie", () => {
  it("finds the named cookie among others", () => {
    expect(readCookie("a=1; pixelcam_vid=abc123; b=2", "pixelcam_vid")).toBe("abc123");
    expect(readCookie(null, "pixelcam_vid")).toBeNull();
  });
});

describe("visitorCookieHeader", () => {
  it("matches the KV TTL and marks the cookie HttpOnly", () => {
    const header = visitorCookieHeader("abc", true);
    expect(header).toContain(`Max-Age=${VISITOR_TTL_SECONDS}`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
  });
});
