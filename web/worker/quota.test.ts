import { describe, expect, it } from "vitest";
import {
  admitChat,
  isValidChatId,
  parseVisitorRecord,
  quotaFromRecord,
  readCookie,
  visitorCookieHeader,
  VISITOR_TTL_SECONDS,
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

describe("admitChat", () => {
  it("counts a chat only the first time it is seen", () => {
    const first = admitChat(null, "chat_one___", 3);
    expect(first?.isNew).toBe(true);
    expect(first?.quota).toEqual({ used: 1, limit: 3, remaining: 2 });

    const again = admitChat(first!.record, "chat_one___", 3);
    expect(again?.isNew).toBe(false);
    expect(again?.quota.used).toBe(1);
  });

  it("blocks a fourth distinct chat", () => {
    let record = null;
    for (const id of ["chat_aaa1", "chat_bbb2", "chat_ccc3"]) {
      const admitted = admitChat(record, id, 3);
      expect(admitted).not.toBeNull();
      record = admitted!.record;
    }
    expect(admitChat(record, "chat_ddd4", 3)).toBeNull();
    expect(quotaFromRecord(record, 3).remaining).toBe(0);
  });
});

describe("parseVisitorRecord", () => {
  it("drops malformed entries", () => {
    expect(parseVisitorRecord('{"chatIds":["ok_chat1","bad"],"updatedAt":1}')).toEqual({
      chatIds: ["ok_chat1"],
      updatedAt: 1,
    });
    expect(parseVisitorRecord("not-json")).toBeNull();
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
