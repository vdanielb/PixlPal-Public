/**
 * The agent loop: ask the model, run whatever knobs it turns, hand the
 * resulting pipeline back, repeat until it stops calling tools.
 *
 * The loop is deliberately transport-free. It takes a `ChatModel`, so the same
 * code runs in the browser against a user-supplied key today and inside a
 * server endpoint later without changing a line.
 */

import type { OpState } from "@pixelcam/shared";
import { describeCurrentEdit, buildSystemPrompt } from "./prompt";
import { AGENT_TOOLS, executeTool } from "./tools";
import type { AgentEvent, ChatMessage, ChatModel, ImageStats } from "./types";
import { textFromContent } from "./types";

export const DEFAULT_MAX_STEPS = 8;

export interface RunAgentOptions {
  model: ChatModel;
  /** Conversation so far: user, assistant and tool messages. No system message. */
  messages: ChatMessage[];
  opState: OpState;
  imageStats?: ImageStats | null;
  /** Host segmentation callback; required for the segment tool to succeed. */
  segment?: import("./tools").SegmentHost;
  /** Host mask-invert callback; required for the invert_mask tool to succeed. */
  invertMask?: import("./tools").InvertMaskHost;
  /** Host mask-bounds callback; required for subject-centered set_frame crops. */
  getMaskBounds?: import("./tools").MaskBoundsHost;
  maxSteps?: number;
  signal?: AbortSignal;
  /** Called after every tool call that changed the edit, so the UI updates live. */
  onOpState?: (opState: OpState) => void;
  onEvent?: (event: AgentEvent) => void;
}

export interface RunAgentResult {
  /** Messages produced by this run, to append to the caller's history. */
  messages: ChatMessage[];
  opState: OpState;
  reply: string | null;
  changed: boolean;
  /** The model was still calling tools when it hit `maxSteps`. */
  truncated: boolean;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason: unknown = signal.reason;
  throw reason instanceof Error ? reason : new Error("The agent run was cancelled.");
}

function textOrNull(content: ChatMessage["content"]): string | null {
  const trimmed = textFromContent(content).trim();
  return trimmed ? trimmed : null;
}

export async function runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const systemPrompt: ChatMessage = { role: "system", content: buildSystemPrompt() };

  let opState = options.opState;
  let changed = false;
  let reply: string | null = null;
  const produced: ChatMessage[] = [];

  for (let step = 1; step <= maxSteps; step += 1) {
    throwIfAborted(options.signal);
    options.onEvent?.({ type: "step", step });

    const response = await options.model.complete({
      messages: [
        systemPrompt,
        { role: "system", content: describeCurrentEdit(opState) },
        ...options.messages,
        ...produced,
      ],
      tools: AGENT_TOOLS,
      signal: options.signal,
    });

    const content = textOrNull(response.content);
    const toolCalls = response.toolCalls ?? [];
    if (content) {
      reply = content;
      options.onEvent?.({ type: "assistant", content });
    }

    produced.push({
      role: "assistant",
      content,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    });

    if (toolCalls.length === 0) {
      return { messages: produced, opState, reply, changed, truncated: false };
    }

    // Announce every call as soon as the model asks, so the UI can show
    // "Finding subject…" before Florence-2 (or any other host work) returns.
    for (const call of toolCalls) {
      options.onEvent?.({ type: "tool_start", call });
    }

    for (const call of toolCalls) {
      const outcome = await executeTool(call.name, call.arguments, {
        opState,
        imageStats: options.imageStats,
        segment: options.segment,
        invertMask: options.invertMask,
        getMaskBounds: options.getMaskBounds,
        signal: options.signal,
      });
      opState = outcome.opState;
      if (outcome.changed) {
        changed = true;
        options.onOpState?.(opState);
      }
      options.onEvent?.({ type: "tool", call, result: outcome.result });
      produced.push({
        role: "tool",
        toolCallId: call.id,
        toolName: call.name,
        content: JSON.stringify(outcome.result),
      });
    }
  }

  // Out of steps with tools still in flight. Ask once more, without tools, so
  // the user gets a real answer instead of a dangling transcript.
  throwIfAborted(options.signal);
  const wrapUp = await options.model.complete({
    messages: [
      systemPrompt,
      { role: "system", content: describeCurrentEdit(opState) },
      ...options.messages,
      ...produced,
      {
        role: "system",
        content:
          "You have reached the limit on tool calls for this turn. Do not call any more tools. Tell the user what you changed in one or two short sentences.",
      },
    ],
    tools: [],
    signal: options.signal,
  });

  const wrapUpText = textOrNull(wrapUp.content);
  if (wrapUpText) {
    reply = wrapUpText;
    options.onEvent?.({ type: "assistant", content: wrapUpText });
    produced.push({ role: "assistant", content: wrapUpText });
  }

  return { messages: produced, opState, reply, changed, truncated: true };
}
