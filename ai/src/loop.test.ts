import { describe, expect, it, vi } from "vitest";
import type { OpState } from "@pixelcam/shared";
import { runAgent } from "./loop";
import { TOOL_NAMES } from "./tools";
import type {
  AgentEvent,
  ChatMessage,
  ChatModel,
  CompletionRequest,
  CompletionResponse,
  ImageStats,
} from "./types";

const STATS: ImageStats = {
  width: 800,
  height: 600,
  meanLuma: 0.24,
  blackPoint: 0.01,
  whitePoint: 0.72,
  clippedShadows: 0.06,
  clippedHighlights: 0.001,
  meanSaturation: 0.1,
  colorCast: -0.3,
};

let nextCallId = 0;
function toolCall(name: string, args: unknown) {
  nextCallId += 1;
  return { id: `call_${nextCallId}`, name, arguments: JSON.stringify(args) };
}

/** A model that replays a fixed script and records what it was asked. */
function scriptedModel(script: CompletionResponse[]) {
  const requests: CompletionRequest[] = [];
  let index = 0;
  const model: ChatModel = {
    async complete(request) {
      requests.push(request);
      const response = script[index];
      index += 1;
      if (!response) throw new Error(`model called ${index} times, script has ${script.length}`);
      return response;
    },
  };
  return { model, requests, calls: () => index };
}

function userTurn(content: string): ChatMessage[] {
  return [{ role: "user", content }];
}

describe("runAgent", () => {
  it("turns the knobs the model asks for and returns its reply", async () => {
    const { model, requests } = scriptedModel([
      { toolCalls: [toolCall(TOOL_NAMES.setOperations, { operations: [{ op: "color_balance", params: { temperature: 0.25 } }] })] },
      { content: "Warmed it up with a touch of temperature." },
    ]);

    const seen: OpState[] = [];
    const result = await runAgent({
      model,
      messages: userTurn("make it warmer"),
      opState: {},
      onOpState: (opState) => seen.push(opState),
    });

    expect(result.opState.color_balance).toEqual({ params: { temperature: 0.25, tint: 0 } });
    expect(result.reply).toBe("Warmed it up with a touch of temperature.");
    expect(result.changed).toBe(true);
    expect(result.truncated).toBe(false);
    // The UI is updated as each tool lands, not only at the end.
    expect(seen).toHaveLength(1);
    expect(requests).toHaveLength(2);
  });

  it("sends the system prompt, the current edit, and the tool schemas on every call", async () => {
    const { model, requests } = scriptedModel([{ content: "Nothing to do." }]);
    await runAgent({
      model,
      messages: userTurn("hello"),
      opState: { grain: { params: { amount: 0.65, size: 1.4 } } },
    });

    const [request] = requests;
    expect(request.messages[0].role).toBe("system");
    expect(request.messages[0].content).toContain("PixlPal");
    expect(request.messages[1].content).toContain("grain: amount=0.65, size=1.4");
    expect(request.messages[2]).toEqual({ role: "user", content: "hello" });
    expect(request.tools.map((tool) => tool.name)).toContain(TOOL_NAMES.setOperations);
  });

  it("produces a transcript the next turn can replay: assistant tool calls paired with tool results", async () => {
    const call = toolCall(TOOL_NAMES.setOperations, { operations: [{ op: "contrast", params: { amount: 0.2 } }] });
    const { model } = scriptedModel([{ toolCalls: [call] }, { content: "Added contrast." }]);

    const result = await runAgent({ model, messages: userTurn("punchier"), opState: {} });

    expect(result.messages).toHaveLength(3);
    expect(result.messages[0]).toMatchObject({ role: "assistant", toolCalls: [call] });
    expect(result.messages[1]).toMatchObject({
      role: "tool",
      toolCallId: call.id,
      toolName: TOOL_NAMES.setOperations,
    });
    expect(JSON.parse(result.messages[1].content as string).ok).toBe(true);
    expect(result.messages[2]).toMatchObject({ role: "assistant", content: "Added contrast." });
  });

  it("lets the model measure the photo before deciding", async () => {
    const { model, requests } = scriptedModel([
      { toolCalls: [toolCall(TOOL_NAMES.getImageStats, {})] },
      { toolCalls: [toolCall(TOOL_NAMES.setOperations, { operations: [{ op: "exposure", params: { amount: 0.3 } }] })] },
      { content: "It was underexposed and cool, so I lifted the exposure." },
    ]);

    const result = await runAgent({
      model,
      messages: userTurn("fix the exposure"),
      opState: {},
      imageStats: STATS,
    });

    // The stats reached the model as a tool result before it chose a value.
    const statsResult = requests[1].messages.find((message) => message.role === "tool");
    expect(statsResult?.content).toContain("dark");
    expect(result.opState.exposure).toEqual({ params: { amount: 0.3 } });
  });

  it("feeds tool errors back so the model can correct itself", async () => {
    const { model, requests } = scriptedModel([
      { toolCalls: [toolCall(TOOL_NAMES.setOperations, { operations: [{ op: "warmth", params: { amount: 0.3 } }] })] },
      { toolCalls: [toolCall(TOOL_NAMES.setOperations, { operations: [{ op: "color_balance", params: { temperature: 0.3 } }] })] },
      { content: "Warmed it up." },
    ]);

    const result = await runAgent({ model, messages: userTurn("warmer"), opState: {} });

    const errorResult = requests[1].messages.find((message) => message.role === "tool");
    expect(JSON.parse(errorResult?.content as string)).toMatchObject({ ok: false });
    expect(result.opState.color_balance).toEqual({ params: { temperature: 0.3, tint: 0 } });
    expect(result.changed).toBe(true);
  });

  it("keeps refining across steps on a relative follow-up", async () => {
    const { model } = scriptedModel([
      { toolCalls: [toolCall(TOOL_NAMES.setOperations, { operations: [{ op: "grain", params: { amount: 0.3 } }] })] },
      { content: "Eased the grain back." },
    ]);

    const result = await runAgent({
      model,
      messages: [
        { role: "user", content: "give it a moody film look" },
        { role: "assistant", content: "Done." },
        { role: "user", content: "less grain" },
      ],
      opState: { grain: { params: { amount: 0.65, size: 1.4 } }, vignette: { params: { amount: 0.4, size: 0.5 } } },
    });

    // Merge semantics mean the size and the unrelated vignette survive.
    expect(result.opState.grain).toEqual({ params: { amount: 0.3, size: 1.4 } });
    expect(result.opState.vignette).toEqual({ params: { amount: 0.4, size: 0.5 } });
  });

  it("stops at maxSteps and asks for a summary without tools", async () => {
    const looping: CompletionResponse = {
      toolCalls: [toolCall(TOOL_NAMES.setOperations, { operations: [{ op: "exposure", params: { amount: 0.1 } }] })],
    };
    const { model, requests, calls } = scriptedModel([
      looping,
      looping,
      looping,
      { content: "I nudged the exposure a few times." },
    ]);

    const result = await runAgent({
      model,
      messages: userTurn("brighten"),
      opState: {},
      maxSteps: 3,
    });

    expect(calls()).toBe(4);
    expect(result.truncated).toBe(true);
    expect(requests[3].tools).toEqual([]);
    expect(requests[3].messages.at(-1)?.content).toContain("Do not call any more tools");
    expect(result.reply).toBe("I nudged the exposure a few times.");
  });

  it("does not call the model at all when already aborted", async () => {
    const complete = vi.fn();
    const controller = new AbortController();
    controller.abort();

    await expect(
      runAgent({
        model: { complete },
        messages: userTurn("warmer"),
        opState: {},
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();
  });

  it("stops between steps once cancelled, keeping the edits already applied", async () => {
    const controller = new AbortController();
    const { model } = scriptedModel([
      { toolCalls: [toolCall(TOOL_NAMES.setOperations, { operations: [{ op: "saturation", params: { amount: -0.3 } }] })] },
      { content: "unreachable" },
    ]);

    const applied: OpState[] = [];
    await expect(
      runAgent({
        model,
        messages: userTurn("desaturate"),
        opState: {},
        signal: controller.signal,
        onOpState: (opState) => {
          applied.push(opState);
          controller.abort();
        },
      }),
    ).rejects.toThrow();

    expect(applied[0].saturation).toEqual({ params: { amount: -0.3 } });
  });

  it("reports progress as events for the chat transcript", async () => {
    const { model } = scriptedModel([
      { toolCalls: [toolCall(TOOL_NAMES.setOperations, { operations: [{ op: "vignette", params: { amount: 0.3 } }] })] },
      { content: "Added a vignette." },
    ]);

    const events: AgentEvent[] = [];
    await runAgent({
      model,
      messages: userTurn("vignette please"),
      opState: {},
      onEvent: (event) => events.push(event),
    });

    expect(events.map((event) => event.type)).toEqual([
      "step",
      "tool_start",
      "tool",
      "step",
      "assistant",
    ]);
  });
});
