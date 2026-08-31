/**
 * Thin agent backend for PixlPal.
 *
 * The editing loop, tools, and segmentation stay in the browser. This Worker
 * only (1) holds the product LLM key, (2) caps anonymous visitors to a small
 * number of chats via a cookie + KV, (3) rejects oversized user messages,
 * caps generated tokens, times out hung completions, and (4) proxies one
 * model completion per request. Static assets keep being served by the
 * assets binding.
 */

import type { CompletionRequest, CompletionResponse, ToolSchema } from "@pixelcam/ai";
import {
  completeAgainstEndpoint,
  type ResponsesOutputItem,
} from "../src/lib/agent/byokChatModel";
import type { AgentSettings } from "../src/lib/agent/settings";
import {
  DEFAULT_CHAT_LIMIT,
  VISITOR_COOKIE,
  VISITOR_TTL_SECONDS,
  admitChat,
  isValidChatId,
  newVisitorId,
  parseVisitorRecord,
  quotaFromRecord,
  readCookie,
  visitorCookieHeader,
  type ChatQuota,
  type VisitorRecord,
} from "./quota";
import {
  DEFAULT_COMPLETION_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_USER_MESSAGE_CHARS,
  formatDuration,
  oversizedUserMessageChars,
  type HostedLimits,
} from "../src/lib/agent/limits";

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  CHAT_QUOTA: KVNamespace;
  /** Abuse guard: completions per visitor per window. */
  AGENT_RATE_LIMITER: RateLimit;
  OPENAI_API_KEY: string;
  LLM_BASE_URL: string;
  LLM_MODEL: string;
  CHAT_LIMIT?: string;
  MAX_USER_MESSAGE_CHARS?: string;
  MAX_OUTPUT_TOKENS?: string;
  AGENT_COMPLETION_TIMEOUT_MS?: string;
}

interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface AgentRequestBody {
  chatId?: unknown;
  messages?: unknown;
  tools?: unknown;
  cachedOutput?: unknown;
}

interface SuggestRequestBody {
  messages?: unknown;
}

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function chatLimit(env: Env): number {
  return positiveInt(env.CHAT_LIMIT, DEFAULT_CHAT_LIMIT);
}

function maxUserMessageChars(env: Env): number {
  return positiveInt(env.MAX_USER_MESSAGE_CHARS, DEFAULT_MAX_USER_MESSAGE_CHARS);
}

function maxOutputTokens(env: Env): number {
  return positiveInt(env.MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS);
}

function completionTimeoutMs(env: Env): number {
  return positiveInt(env.AGENT_COMPLETION_TIMEOUT_MS, DEFAULT_COMPLETION_TIMEOUT_MS);
}

function hostedLimits(env: Env): HostedLimits {
  return {
    maxUserMessageChars: maxUserMessageChars(env),
    maxOutputTokens: maxOutputTokens(env),
  };
}

function llmSettings(env: Env): AgentSettings | null {
  const apiKey = env.OPENAI_API_KEY?.trim() ?? "";
  if (!apiKey) return null;
  return {
    baseUrl: (env.LLM_BASE_URL || "https://api.openai.com/v1").trim(),
    model: (env.LLM_MODEL || "gpt-5.6-luna").trim(),
    apiKey,
  };
}

function visitorKey(visitorId: string): string {
  return `visitor:${visitorId}`;
}

async function loadVisitor(env: Env, visitorId: string): Promise<VisitorRecord | null> {
  return parseVisitorRecord(await env.CHAT_QUOTA.get(visitorKey(visitorId)));
}

async function saveVisitor(env: Env, visitorId: string, record: VisitorRecord): Promise<void> {
  await env.CHAT_QUOTA.put(visitorKey(visitorId), JSON.stringify(record), {
    expirationTtl: VISITOR_TTL_SECONDS,
  });
}

function resolveVisitor(request: Request): { visitorId: string; setCookie: string | null } {
  const existing = readCookie(request.headers.get("Cookie"), VISITOR_COOKIE);
  if (existing && /^[a-zA-Z0-9_-]{16,64}$/.test(existing)) {
    return { visitorId: existing, setCookie: null };
  }
  const visitorId = newVisitorId();
  const secure = new URL(request.url).protocol === "https:";
  return { visitorId, setCookie: visitorCookieHeader(visitorId, secure) };
}

function withVisitorCookie(response: Response, setCookie: string | null): Response {
  if (!setCookie) return response;
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", setCookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function isToolSchema(value: unknown): value is ToolSchema {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === "string" &&
    typeof record.description === "string" &&
    !!record.parameters &&
    typeof record.parameters === "object"
  );
}

function parseAgentBody(raw: unknown): {
  chatId: string;
  request: CompletionRequest;
  cachedOutput: ResponsesOutputItem[] | null;
} | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Request body must be a JSON object." };
  const body = raw as AgentRequestBody;
  if (typeof body.chatId !== "string" || !isValidChatId(body.chatId)) {
    return { error: "chatId must be an opaque id (8–80 letters, digits, _ or -)." };
  }
  if (!Array.isArray(body.messages)) {
    return { error: "messages must be an array." };
  }
  if (!Array.isArray(body.tools) || !body.tools.every(isToolSchema)) {
    return { error: "tools must be an array of tool schemas." };
  }
  const cachedOutput = Array.isArray(body.cachedOutput)
    ? (body.cachedOutput as ResponsesOutputItem[])
    : null;
  return {
    chatId: body.chatId,
    request: {
      messages: body.messages as CompletionRequest["messages"],
      tools: body.tools,
    },
    cachedOutput,
  };
}

/**
 * One tool-free completion for first-prompt suggestion chips. Does not admit a
 * chat (no quota slot is consumed) but is rate-limited per visitor so it
 * cannot be farmed as a free general-purpose model proxy.
 */
async function handleSuggest(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, { status: 405 });
  }

  const settings = llmSettings(env);
  if (!settings) {
    return json(
      { error: "Hosted assistant is not configured. Set the OPENAI_API_KEY Worker secret." },
      { status: 503 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const body = (raw ?? {}) as SuggestRequestBody;
  // Suggestions are a single system + user turn; anything bigger is misuse.
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 4) {
    return json({ error: "messages must be a short array of chat messages." }, { status: 400 });
  }

  const { visitorId, setCookie } = resolveVisitor(request);
  const rate = await env.AGENT_RATE_LIMITER.limit({ key: `suggest:${visitorId}` });
  if (!rate.success) {
    return withVisitorCookie(
      json({ error: "Too many suggestion requests. Wait a moment and try again." }, { status: 429 }),
      setCookie,
    );
  }

  const limits = hostedLimits(env);
  let completion: CompletionResponse;
  try {
    completion = await completeAgainstEndpoint(
      settings,
      {
        messages: body.messages as CompletionRequest["messages"],
        tools: [],
        signal: AbortSignal.timeout(completionTimeoutMs(env)),
      },
      { current: null },
      { maxOutputTokens: limits.maxOutputTokens },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return withVisitorCookie(json({ error: message }, { status: 502 }), setCookie);
  }

  return withVisitorCookie(json({ content: completion.content ?? null }), setCookie);
}

async function handleQuota(request: Request, env: Env): Promise<Response> {
  const { visitorId, setCookie } = resolveVisitor(request);
  const record = await loadVisitor(env, visitorId);
  const quota = quotaFromRecord(record, chatLimit(env));
  return withVisitorCookie(json({ quota, limits: hostedLimits(env) }), setCookie);
}

async function handleComplete(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, { status: 405 });
  }

  const settings = llmSettings(env);
  if (!settings) {
    return json(
      { error: "Hosted assistant is not configured. Set the OPENAI_API_KEY Worker secret." },
      { status: 503 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parseAgentBody(raw);
  if ("error" in parsed) {
    return json({ error: parsed.error }, { status: 400 });
  }

  const limits = hostedLimits(env);
  const oversized = oversizedUserMessageChars(parsed.request.messages, limits.maxUserMessageChars);
  if (oversized !== null) {
    return json(
      {
        error: `Each message must be at most ${limits.maxUserMessageChars} characters (this one is ${oversized}).`,
        limits,
      },
      { status: 400 },
    );
  }

  const { visitorId, setCookie } = resolveVisitor(request);
  const limit = chatLimit(env);

  const rate = await env.AGENT_RATE_LIMITER.limit({ key: `visitor:${visitorId}` });
  if (!rate.success) {
    return withVisitorCookie(
      json({ error: "Too many assistant requests. Wait a moment and try again." }, { status: 429 }),
      setCookie,
    );
  }

  const record = await loadVisitor(env, visitorId);
  const admitted = admitChat(record, parsed.chatId, limit);
  if (!admitted) {
    const quota = quotaFromRecord(record, limit);
    return withVisitorCookie(
      json(
        {
          error: `Chat limit reached (${quota.limit} chats). Start over in a new browser profile, or use your own API key in Model settings.`,
          quota,
          limits,
        },
        { status: 403 },
      ),
      setCookie,
    );
  }

  if (admitted.isNew) {
    await saveVisitor(env, visitorId, admitted.record);
  }

  const cachedOutput = { current: parsed.cachedOutput };
  let completion: CompletionResponse;
  try {
    completion = await completeAgainstEndpoint(
      settings,
      { ...parsed.request, signal: AbortSignal.timeout(completionTimeoutMs(env)) },
      cachedOutput,
      { maxOutputTokens: limits.maxOutputTokens },
    );
  } catch (error) {
    if (isTimeoutError(error)) {
      return withVisitorCookie(
        json(
          {
            error: `The model took longer than ${formatDuration(completionTimeoutMs(env))}. Try again, or use your own API key in Model settings.`,
            limits,
          },
          { status: 504 },
        ),
        setCookie,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return withVisitorCookie(json({ error: message }, { status: 502 }), setCookie);
  }

  const quota: ChatQuota = admitted.quota;
  return withVisitorCookie(
    json({
      content: completion.content ?? null,
      toolCalls: completion.toolCalls ?? [],
      cachedOutput: cachedOutput.current,
      quota,
      limits,
    }),
    setCookie,
  );
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || /timed? ?out/i.test(error.message));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/agent/quota" && request.method === "GET") {
      return handleQuota(request, env);
    }
    if (url.pathname === "/api/agent/suggest") {
      return handleSuggest(request, env);
    }
    if (url.pathname === "/api/agent") {
      return handleComplete(request, env);
    }

    // Asset requests should not normally reach here when run_worker_first is
    // limited to /api/*, but fall through safely if they do.
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not found", { status: 404 });
  },
};
