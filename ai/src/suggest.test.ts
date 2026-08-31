import { describe, expect, it } from "vitest";
import { MAX_SUGGESTIONS, buildSuggestionMessages, parseSuggestions } from "./suggest";
import type { ImageContentPart } from "./types";

describe("buildSuggestionMessages", () => {
  it("asks for a JSON array and attaches the photo", () => {
    const image: ImageContentPart = { type: "image", mimeType: "image/jpeg", dataBase64: "abc" };
    const messages = buildSuggestionMessages(image);

    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("JSON array");
    expect(messages[1].role).toBe("user");
    expect(Array.isArray(messages[1].content)).toBe(true);
    const parts = messages[1].content as ImageContentPart[];
    expect(parts.some((part) => part.type === "image")).toBe(true);
  });

  it("degrades to a text-only user turn without a photo", () => {
    const messages = buildSuggestionMessages(null);
    expect(typeof messages[1].content).toBe("string");
  });
});

describe("parseSuggestions", () => {
  it("parses a strict JSON array", () => {
    expect(parseSuggestions('["Warm up the light", "Blur the background"]')).toEqual([
      "Warm up the light",
      "Blur the background",
    ]);
  });

  it("parses an array wrapped in prose or a code fence", () => {
    const reply = 'Sure! Here are ideas:\n```json\n["Make it moody", "Soften the skin tones"]\n```';
    expect(parseSuggestions(reply)).toEqual(["Make it moody", "Soften the skin tones"]);
  });

  it("falls back to bulleted lines when there is no JSON", () => {
    const reply = "- Warm up the sunset\n2. Add gentle film grain\n* Deepen the shadows";
    expect(parseSuggestions(reply)).toEqual([
      "Warm up the sunset",
      "Add gentle film grain",
      "Deepen the shadows",
    ]);
  });

  it("caps the list, dedupes, and drops junk entries", () => {
    const long = "x".repeat(100);
    const reply = JSON.stringify([
      "One",
      "one",
      "",
      long,
      "Two",
      "Three",
      "Four",
      "Five",
    ]);
    const parsed = parseSuggestions(reply);
    expect(parsed).toEqual(["One", "Two", "Three", "Four"]);
    expect(parsed.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
  });

  it("returns [] for empty replies and single-line refusals", () => {
    expect(parseSuggestions(null)).toEqual([]);
    expect(parseSuggestions("")).toEqual([]);
    expect(parseSuggestions("I cannot see the photo.")).toEqual([]);
  });
});
