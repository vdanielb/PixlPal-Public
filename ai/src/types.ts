/**
 * Transport-agnostic types for the editing agent.
 *
 * Nothing in this package knows how a model is reached. Everything goes
 * through the one-method `ChatModel` seam, so the same agent runs against a
 * key in the browser today and behind a server endpoint later.
 */

/** A tool call exactly as the model emitted it — arguments stay unparsed. */
export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string. Malformed JSON is a tool error, not a crash. */
  arguments: string;
}

export type ChatRole = "system" | "user" | "assistant" | "tool";

/** Plain text part of a multimodal user message. */
export interface TextContentPart {
  type: "text";
  text: string;
}

/**
 * Preview frame attached to a user turn. `dataBase64` is raw base64 (no data-URL
 * prefix); the transport wraps it for the provider wire format.
 */
export interface ImageContentPart {
  type: "image";
  mimeType: string;
  dataBase64: string;
}

export type ContentPart = TextContentPart | ImageContentPart;

export type MessageContent = string | ContentPart[];

export interface ChatMessage {
  role: ChatRole;
  /** String for most roles; user turns may include an image of the current preview. */
  content?: MessageContent | null;
  /** Assistant messages only. */
  toolCalls?: ToolCall[];
  /** Tool messages only: which call this is answering. */
  toolCallId?: string;
  /** Tool messages only: kept for rendering, ignored by the transport. */
  toolName?: string;
}

/** Flatten message content to plain text (images become empty). */
export function textFromContent(content: MessageContent | null | undefined): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return content
    .filter((part): part is TextContentPart => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

/** Drop image parts from a message, keeping only the text. */
export function withoutImages(message: ChatMessage): ChatMessage {
  if (message.role !== "user" || !Array.isArray(message.content)) return message;
  const text = textFromContent(message.content).trim();
  return { ...message, content: text };
}

/** JSON Schema description of one tool, in the shape every provider expects. */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  tools: ToolSchema[];
  signal?: AbortSignal;
}

export interface CompletionResponse {
  content?: string | null;
  toolCalls?: ToolCall[];
}

/**
 * The single seam between the agent and the outside world. Implementations
 * must reject with an `AbortError` when `request.signal` aborts.
 */
export interface ChatModel {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}

/**
 * Statistics computed from the photo on-device. These let the agent reason
 * about *this* image without any pixels leaving the device.
 */
export interface ImageStats {
  width: number;
  height: number;
  /** Mean relative luminance, 0..1. */
  meanLuma: number;
  /** 1st and 99th percentile luminance — the effective black and white points. */
  blackPoint: number;
  whitePoint: number;
  /** Fraction of pixels crushed to black / blown to white, 0..1. */
  clippedShadows: number;
  clippedHighlights: number;
  /** Mean HSV-style saturation, 0..1. */
  meanSaturation: number;
  /** Red-vs-blue cast: -1 very cool, 0 neutral, +1 very warm. */
  colorCast: number;
}

export interface ToolOk {
  ok: true;
  summary: string;
  data?: Record<string, unknown>;
  warnings?: string[];
}

export interface ToolErr {
  ok: false;
  error: string;
}

export type ToolResult = ToolOk | ToolErr;

export type AgentEvent =
  | { type: "step"; step: number }
  | { type: "tool_start"; call: ToolCall }
  | { type: "tool"; call: ToolCall; result: ToolResult }
  | { type: "assistant"; content: string };
