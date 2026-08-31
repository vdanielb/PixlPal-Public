/**
 * The only part of the agent that knows about the network.
 *
 * This is the bring-your-own-key transport: the browser posts straight to an
 * OpenAI-compatible endpoint. GPT-5.6+ models with function tools must use
 * `/responses` (Chat Completions rejects them once the server applies a default
 * `reasoning_effort`). Older OpenAI-compatible servers (Ollama, LM Studio,
 * Groq, …) still speak `/chat/completions`, so we pick the wire protocol from
 * the model name.
 *
 * Swapping this for the backend in PLAN.md phase 5 means writing a second
 * `ChatModel` that posts to our own endpoint — no tool, prompt, or UI code
 * changes.
 *
 * Each user turn may include a JPEG preview of how the photo currently looks,
 * plus the prompt, current pipeline, and optional `get_image_stats` numbers.
 */

import type {
  ChatMessage,
  ChatModel,
  CompletionRequest,
  CompletionResponse,
  ContentPart,
  ToolCall,
  ToolSchema,
} from "@pixelcam/ai";
import { textFromContent } from "@pixelcam/ai";
import { applyOutputTokenLimit } from "./limits";
import { isLocalEndpoint, type AgentSettings } from "./settings";

export interface CompleteAgainstEndpointOptions {
  /** Hard cap on generated tokens, including reasoning tokens on GPT-5.6. */
  maxOutputTokens?: number;
}

interface WireToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: unknown };
}

interface ChatWireMessage {
  content?: string | null;
  tool_calls?: WireToolCall[];
}

interface ChatWireResponse {
  choices?: { message?: ChatWireMessage }[];
  error?: { message?: string };
}

export interface ResponsesOutputItem {
  type?: string;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: unknown;
  role?: string;
  status?: string;
  content?: unknown;
  summary?: unknown;
  encrypted_content?: string;
  [key: string]: unknown;
}

interface ResponsesWireResponse {
  output?: ResponsesOutputItem[];
  output_text?: string;
  status?: string;
  incomplete_details?: { reason?: string };
  error?: { message?: string };
}

/** GPT-5.6+ needs `/responses` for function tools (default reasoning effort). */
export function usesResponsesApi(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  // gpt-5.6, gpt-5.6-luna, gpt-5.6-sol, gpt-5.7, …
  return /^gpt-5\.([6-9]\b|\d{2,})/.test(normalized);
}

/** Reasoning models reject temperature / top_p unless effort is explicitly none. */
function supportsSamplingParams(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  if (normalized.includes("gpt-5")) return false;
  if (/^o[1-9]/.test(normalized)) return false;
  return true;
}

function chatEndpoint(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, "")}/chat/completions`;
}

function responsesEndpoint(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, "")}/responses`;
}

function imageDataUrl(part: Extract<ContentPart, { type: "image" }>): string {
  return `data:${part.mimeType};base64,${part.dataBase64}`;
}

/** Chat Completions multimodal user content. */
function toChatUserContent(content: ChatMessage["content"]): string | Record<string, unknown>[] {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (part.type === "text") {
      return { type: "text", text: part.text };
    }
    return {
      type: "image_url",
      image_url: { url: imageDataUrl(part) },
    };
  });
}

/** Responses API multimodal user content. */
function toResponsesUserContent(content: ChatMessage["content"]): string | Record<string, unknown>[] {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (part.type === "text") {
      return { type: "input_text", text: part.text };
    }
    return {
      type: "input_image",
      image_url: imageDataUrl(part),
    };
  });
}

function toChatWireMessage(message: ChatMessage): Record<string, unknown> {
  switch (message.role) {
    case "assistant":
      return {
        role: "assistant",
        content: typeof message.content === "string" ? message.content : textFromContent(message.content) || null,
        ...(message.toolCalls && message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      };
    case "tool":
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: textFromContent(message.content),
      };
    case "user":
      return { role: "user", content: toChatUserContent(message.content) };
    default:
      return { role: message.role, content: textFromContent(message.content) };
  }
}

function fromChatWireToolCalls(calls: WireToolCall[] | undefined): ToolCall[] {
  if (!calls) return [];
  const parsed: ToolCall[] = [];
  calls.forEach((call, index) => {
    const name = call.function?.name;
    if (!name) return;
    const rawArguments = call.function?.arguments;
    parsed.push({
      id: call.id ?? `call_${index}`,
      name,
      // Most providers send a JSON string; a few send an object.
      arguments: typeof rawArguments === "string" ? rawArguments : JSON.stringify(rawArguments ?? {}),
    });
  });
  return parsed;
}

function toResponsesTools(tools: ToolSchema[]): Record<string, unknown>[] {
  // Explicit non-strict: Responses defaults toward strict schemas, and our
  // tool definitions are not all strict-compatible (optional fields).
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: false,
  }));
}

function extractOutputText(item: ResponsesOutputItem): string {
  if (typeof item.content === "string") return item.content;
  if (!Array.isArray(item.content)) return "";
  const parts: string[] = [];
  for (const part of item.content) {
    if (!part || typeof part !== "object") continue;
    const record = part as { type?: string; text?: string };
    if ((record.type === "output_text" || record.type === "text") && typeof record.text === "string") {
      parts.push(record.text);
    }
  }
  return parts.join("");
}

function fromResponsesOutput(output: ResponsesOutputItem[] | undefined): CompletionResponse {
  if (!output || output.length === 0) {
    return { content: null, toolCalls: [] };
  }

  const toolCalls: ToolCall[] = [];
  const textParts: string[] = [];

  output.forEach((item, index) => {
    if (item.type === "function_call") {
      const name = item.name;
      if (!name) return;
      const rawArguments = item.arguments;
      toolCalls.push({
        id: item.call_id ?? item.id ?? `call_${index}`,
        name,
        arguments: typeof rawArguments === "string" ? rawArguments : JSON.stringify(rawArguments ?? {}),
      });
      return;
    }
    if (item.type === "message" || item.role === "assistant") {
      const text = extractOutputText(item);
      if (text) textParts.push(text);
    }
  });

  return {
    content: textParts.length > 0 ? textParts.join("\n") : null,
    toolCalls,
  };
}

function callIdsMatchCache(toolCalls: ToolCall[], cached: ResponsesOutputItem[]): boolean {
  const cachedIds = new Set(
    cached
      .filter((item) => item.type === "function_call")
      .map((item) => item.call_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  if (cachedIds.size === 0) return false;
  return toolCalls.every((call) => cachedIds.has(call.id));
}

/**
 * Map the transport-agnostic transcript onto Responses `instructions` + `input`.
 *
 * When the model previously returned reasoning items alongside function calls,
 * replay that exact `output` array for the matching tool round so reasoning
 * context survives `store: false`.
 */
export function toResponsesPayload(
  messages: ChatMessage[],
  cachedOutput: ResponsesOutputItem[] | null,
): { instructions?: string; input: Record<string, unknown>[] } {
  const instructions: string[] = [];
  const input: Record<string, unknown>[] = [];

  let lastAssistantWithTools = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
      lastAssistantWithTools = index;
      break;
    }
  }

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) continue;

    if (message.role === "system") {
      const text = textFromContent(message.content).trim();
      if (text) instructions.push(text);
      continue;
    }

    if (message.role === "user") {
      input.push({ role: "user", content: toResponsesUserContent(message.content) });
      continue;
    }

    if (message.role === "assistant") {
      const toolCalls = message.toolCalls ?? [];
      const replayCache =
        index === lastAssistantWithTools &&
        cachedOutput &&
        toolCalls.length > 0 &&
        callIdsMatchCache(toolCalls, cachedOutput);

      if (replayCache) {
        for (const item of cachedOutput) {
          input.push({ ...item });
        }
        continue;
      }

      const assistantText =
        typeof message.content === "string" ? message.content : textFromContent(message.content);
      if (assistantText) {
        input.push({ role: "assistant", content: assistantText });
      }
      for (const call of toolCalls) {
        input.push({
          type: "function_call",
          call_id: call.id,
          name: call.name,
          arguments: call.arguments,
        });
      }
      continue;
    }

    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.toolCallId,
        output: textFromContent(message.content),
      });
    }
  }

  return {
    ...(instructions.length > 0 ? { instructions: instructions.join("\n\n") } : {}),
    input,
  };
}

async function describeFailure(response: Response, settings: AgentSettings): Promise<string> {
  let detail = "";
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    detail = body.error?.message ?? "";
  } catch {
    detail = "";
  }

  if (response.status === 401 || response.status === 403) {
    return `The endpoint rejected the API key (${response.status}). ${detail}`.trim();
  }
  if (response.status === 404) {
    return `No such model or endpoint (404). Check that "${settings.model}" exists at ${settings.baseUrl}. ${detail}`.trim();
  }
  if (response.status === 429) {
    return `Rate limited or out of quota (429). ${detail}`.trim();
  }
  return `The model endpoint returned ${response.status}. ${detail}`.trim();
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
  settings: AgentSettings,
): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    const hint = isLocalEndpoint(settings.baseUrl)
      ? "Is the local server running?"
      : "Check the base URL, your connection, and whether the provider allows browser requests (CORS).";
    throw new Error(`Could not reach ${settings.baseUrl}. ${hint}`);
  }
}

async function completeWithChatCompletions(
  settings: AgentSettings,
  request: CompletionRequest,
  headers: Record<string, string>,
  options: CompleteAgainstEndpointOptions = {},
): Promise<CompletionResponse> {
  const body: Record<string, unknown> = {
    model: settings.model.trim(),
    messages: request.messages.map(toChatWireMessage),
  };
  applyOutputTokenLimit(body, false, options.maxOutputTokens);
  if (supportsSamplingParams(settings.model)) {
    // Low but not zero: deterministic enough to be predictable, loose
    // enough that "surprise me" is not the same edit every time.
    body.temperature = 0.3;
  }
  if (request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
    body.tool_choice = "auto";
  }

  const response = await postJson(chatEndpoint(settings.baseUrl), headers, body, request.signal, settings);
  if (!response.ok) {
    throw new Error(await describeFailure(response, settings));
  }

  const payload = (await response.json()) as ChatWireResponse;
  const message = payload.choices?.[0]?.message;
  if (!message) {
    throw new Error("The model endpoint returned no choices.");
  }

  return {
    content: message.content ?? null,
    toolCalls: fromChatWireToolCalls(message.tool_calls),
  };
}

async function completeWithResponses(
  settings: AgentSettings,
  request: CompletionRequest,
  headers: Record<string, string>,
  cachedOutput: { current: ResponsesOutputItem[] | null },
  options: CompleteAgainstEndpointOptions = {},
): Promise<CompletionResponse> {
  const { instructions, input } = toResponsesPayload(request.messages, cachedOutput.current);
  const body: Record<string, unknown> = {
    model: settings.model.trim(),
    input,
    // Browser BYOK should not leave conversation state on OpenAI's servers.
    store: false,
  };
  applyOutputTokenLimit(body, true, options.maxOutputTokens);
  if (instructions) body.instructions = instructions;
  if (supportsSamplingParams(settings.model)) {
    body.temperature = 0.3;
  }
  if (request.tools.length > 0) {
    body.tools = toResponsesTools(request.tools);
    body.tool_choice = "auto";
  }

  const response = await postJson(responsesEndpoint(settings.baseUrl), headers, body, request.signal, settings);
  if (!response.ok) {
    throw new Error(await describeFailure(response, settings));
  }

  const payload = (await response.json()) as ResponsesWireResponse;
  if (payload.status === "incomplete" && payload.incomplete_details?.reason === "max_output_tokens") {
    throw new Error(
      "The model hit the output-token limit before it finished. Try a simpler request, or use your own API key in Model settings.",
    );
  }
  if (!payload.output && typeof payload.output_text !== "string") {
    throw new Error("The model endpoint returned no output.");
  }

  const parsed = fromResponsesOutput(payload.output);
  if ((!parsed.content || parsed.content.length === 0) && typeof payload.output_text === "string") {
    parsed.content = payload.output_text;
  }

  // Keep reasoning + function_call items so the next tool round can replay them.
  cachedOutput.current = parsed.toolCalls && parsed.toolCalls.length > 0 ? (payload.output ?? null) : null;

  return parsed;
}

/**
 * One model turn against an OpenAI-compatible endpoint. Shared by the browser
 * BYOK transport and the Cloudflare Worker that holds the product key.
 */
export async function completeAgainstEndpoint(
  settings: AgentSettings,
  request: CompletionRequest,
  cachedOutput: { current: ResponsesOutputItem[] | null } = { current: null },
  options: CompleteAgainstEndpointOptions = {},
): Promise<CompletionResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = settings.apiKey.trim();
  if (key) headers.Authorization = `Bearer ${key}`;

  if (usesResponsesApi(settings.model)) {
    return completeWithResponses(settings, request, headers, cachedOutput, options);
  }
  return completeWithChatCompletions(settings, request, headers, options);
}

export function createByokChatModel(settings: AgentSettings): ChatModel {
  const cachedOutput: { current: ResponsesOutputItem[] | null } = { current: null };

  return {
    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      return completeAgainstEndpoint(settings, request, cachedOutput);
    },
  };
}
