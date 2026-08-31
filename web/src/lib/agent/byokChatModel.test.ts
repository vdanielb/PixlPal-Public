import { describe, expect, it } from "vitest";
import { toResponsesPayload, usesResponsesApi } from "./byokChatModel";

describe("usesResponsesApi", () => {
  it("routes GPT-5.6 family models to Responses", () => {
    expect(usesResponsesApi("gpt-5.6")).toBe(true);
    expect(usesResponsesApi("gpt-5.6-luna")).toBe(true);
    expect(usesResponsesApi("gpt-5.6-sol")).toBe(true);
    expect(usesResponsesApi("gpt-5.6-terra")).toBe(true);
    expect(usesResponsesApi("GPT-5.7")).toBe(true);
  });

  it("keeps older models on Chat Completions", () => {
    expect(usesResponsesApi("gpt-4o-mini")).toBe(false);
    expect(usesResponsesApi("gpt-5")).toBe(false);
    expect(usesResponsesApi("gpt-5.5")).toBe(false);
    expect(usesResponsesApi("llama3.2")).toBe(false);
  });
});

describe("toResponsesPayload", () => {
  it("lifts system messages into instructions and maps tool rounds", () => {
    const { instructions, input } = toResponsesPayload(
      [
        { role: "system", content: "You are an editor." },
        { role: "system", content: "Current edit: none." },
        { role: "user", content: "Warm it up." },
        {
          role: "assistant",
          content: null,
          toolCalls: [{ id: "call_1", name: "get_image_stats", arguments: "{}" }],
        },
        {
          role: "tool",
          toolCallId: "call_1",
          toolName: "get_image_stats",
          content: '{"ok":true}',
        },
      ],
      null,
    );

    expect(instructions).toBe("You are an editor.\n\nCurrent edit: none.");
    expect(input).toEqual([
      { role: "user", content: "Warm it up." },
      {
        type: "function_call",
        call_id: "call_1",
        name: "get_image_stats",
        arguments: "{}",
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: '{"ok":true}',
      },
    ]);
  });

  it("maps multimodal user content to Responses input_image parts", () => {
    const { input } = toResponsesPayload(
      [
        {
          role: "user",
          content: [
            { type: "text", text: "Warm it up." },
            { type: "image", mimeType: "image/jpeg", dataBase64: "abc123" },
          ],
        },
      ],
      null,
    );

    expect(input).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "Warm it up." },
          { type: "input_image", image_url: "data:image/jpeg;base64,abc123" },
        ],
      },
    ]);
  });

  it("replays cached reasoning + function_call items for the latest tool round", () => {
    const cached = [
      {
        type: "reasoning",
        id: "rs_1",
        summary: [],
        encrypted_content: "enc",
      },
      {
        type: "function_call",
        id: "fc_1",
        call_id: "call_9",
        name: "set_operations",
        arguments: '{"operations":[]}',
        status: "completed",
      },
    ];

    const { input } = toResponsesPayload(
      [
        { role: "user", content: "More contrast." },
        {
          role: "assistant",
          toolCalls: [{ id: "call_9", name: "set_operations", arguments: '{"operations":[]}' }],
        },
        {
          role: "tool",
          toolCallId: "call_9",
          content: '{"ok":true}',
        },
      ],
      cached,
    );

    expect(input[0]).toEqual({ role: "user", content: "More contrast." });
    expect(input[1]).toMatchObject({ type: "reasoning", id: "rs_1", encrypted_content: "enc" });
    expect(input[2]).toMatchObject({ type: "function_call", call_id: "call_9" });
    expect(input[3]).toEqual({
      type: "function_call_output",
      call_id: "call_9",
      output: '{"ok":true}',
    });
  });
});
