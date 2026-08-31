import { describe, expect, it } from "vitest";
import { textFromContent, withoutImages, type ChatMessage } from "./types";

describe("textFromContent", () => {
  it("returns strings as-is and joins multimodal text parts", () => {
    expect(textFromContent("hello")).toBe("hello");
    expect(textFromContent(null)).toBe("");
    expect(
      textFromContent([
        { type: "text", text: "Warm it up." },
        { type: "image", mimeType: "image/jpeg", dataBase64: "abc" },
      ]),
    ).toBe("Warm it up.");
  });
});

describe("withoutImages", () => {
  it("strips image parts from user messages and leaves others alone", () => {
    const withImage: ChatMessage = {
      role: "user",
      content: [
        { type: "text", text: "Less grain" },
        { type: "image", mimeType: "image/jpeg", dataBase64: "abc" },
      ],
    };
    expect(withoutImages(withImage)).toEqual({ role: "user", content: "Less grain" });
    expect(withoutImages({ role: "assistant", content: "Done." })).toEqual({
      role: "assistant",
      content: "Done.",
    });
  });
});
