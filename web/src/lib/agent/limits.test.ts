import { describe, expect, it } from "vitest";
import {
  applyOutputTokenLimit,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_USER_MESSAGE_CHARS,
  formatDuration,
  isUserMessageWithinLimit,
  oversizedUserMessageChars,
  userTextCharCount,
} from "./limits";

describe("userTextCharCount", () => {
  it("counts a plain string", () => {
    expect(userTextCharCount("hello")).toBe(5);
  });

  it("sums text parts and ignores images", () => {
    expect(
      userTextCharCount([
        { type: "text", text: "abc" },
        { type: "image", mimeType: "image/jpeg", dataBase64: "aaaa" },
        { type: "text", text: "de" },
      ]),
    ).toBe(5);
  });

  it("treats missing or odd content as empty", () => {
    expect(userTextCharCount(null)).toBe(0);
    expect(userTextCharCount({ type: "text", text: "nope" })).toBe(0);
  });
});

describe("oversizedUserMessageChars", () => {
  it("ignores system and assistant turns", () => {
    expect(
      oversizedUserMessageChars(
        [
          { role: "system", content: "x".repeat(DEFAULT_MAX_USER_MESSAGE_CHARS + 1) },
          { role: "assistant", content: "y".repeat(DEFAULT_MAX_USER_MESSAGE_CHARS + 1) },
          { role: "user", content: "short" },
        ],
        DEFAULT_MAX_USER_MESSAGE_CHARS,
      ),
    ).toBeNull();
  });

  it("returns the offending length for a too-long user turn", () => {
    const length = DEFAULT_MAX_USER_MESSAGE_CHARS + 12;
    expect(
      oversizedUserMessageChars(
        [{ role: "user", content: "z".repeat(length) }],
        DEFAULT_MAX_USER_MESSAGE_CHARS,
      ),
    ).toBe(length);
  });

  it("allows a message that is exactly the cap", () => {
    expect(
      oversizedUserMessageChars(
        [{ role: "user", content: "a".repeat(DEFAULT_MAX_USER_MESSAGE_CHARS) }],
        DEFAULT_MAX_USER_MESSAGE_CHARS,
      ),
    ).toBeNull();
  });
});

describe("isUserMessageWithinLimit", () => {
  it("accepts the cap and rejects one character over", () => {
    expect(isUserMessageWithinLimit("a".repeat(1000), 1000)).toBe(true);
    expect(isUserMessageWithinLimit("a".repeat(1001), 1000)).toBe(false);
  });
});

describe("formatDuration", () => {
  it("prefers whole minutes", () => {
    expect(formatDuration(90_000)).toBe("90 seconds");
    expect(formatDuration(60_000)).toBe("1 minute");
  });

  it("falls back to seconds", () => {
    expect(formatDuration(1500)).toBe("2 seconds");
    expect(formatDuration(1000)).toBe("1 second");
  });
});

describe("applyOutputTokenLimit", () => {
  it("sets max_output_tokens on the Responses body", () => {
    expect(applyOutputTokenLimit({ model: "gpt-5.6-luna" }, true, DEFAULT_MAX_OUTPUT_TOKENS)).toEqual({
      model: "gpt-5.6-luna",
      max_output_tokens: 4096,
    });
  });

  it("sets max_tokens on Chat Completions", () => {
    expect(applyOutputTokenLimit({ model: "gpt-4o-mini" }, false, 512)).toEqual({
      model: "gpt-4o-mini",
      max_tokens: 512,
    });
  });

  it("leaves the body alone when the cap is missing or non-positive", () => {
    const body = { model: "x" };
    expect(applyOutputTokenLimit(body, true)).toBe(body);
    expect(applyOutputTokenLimit(body, true, 0)).toBe(body);
  });
});
