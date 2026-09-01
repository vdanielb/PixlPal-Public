/**
 * A stand-in for an OpenAI-compatible model endpoint, for developing the
 * assistant panel without a key or a bill.
 *
 * It speaks both wire protocols the BYOK transport uses:
 *   - `/v1/responses` (GPT-5.6+ with function tools)
 *   - `/v1/chat/completions` (older OpenAI-compatible servers)
 *
 * Tool definitions go in, tool calls come out, and tool results are replayed
 * on the next request — so everything downstream of the network boundary
 * (tool-call parsing, argument validation, the agent loop, the sliders, the
 * engine) runs exactly as it does against a real model. The only thing faked
 * is the model's judgement: replies come from keyword-matched scripts below
 * instead of a language model.
 *
 *   pnpm mock:llm
 *   # then in the app's Model settings: http://localhost:3939/v1
 *   # use model "mock" (chat/completions) or "gpt-5.6-luna" (responses)
 *
 * Not part of the shipped app; nothing imports it.
 */

import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 3939);

const toolCall = (name, args) => ({
  id: `call_${Math.random().toString(36).slice(2, 10)}`,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

const setOperations = (...operations) => toolCall("set_operations", { operations });
const measure = () => toolCall("get_image_stats", {});

/**
 * Each script is the sequence of assistant turns for one intent. A turn is
 * either tool calls or the closing message, mirroring how a real model
 * alternates between acting and explaining.
 */
const SCRIPTS = [
  {
    match: /warm|golden|summer|sunset|cozy/,
    turns: [
      [measure()],
      [
        setOperations(
          { op: "color_balance", params: { temperature: 0.32, tint: 0.06 } },
          { op: "tone_curve", params: { preset: "soft" } },
          { op: "bloom", params: { strength: 0.28, threshold: 0.62, radius: 0.55 } },
          { op: "saturation", params: { amount: 0.12 } },
        ),
      ],
      "Pushed the white balance warm and softened the curve, with a little bloom in the highlights so the light feels like late afternoon.",
    ],
  },
  {
    match: /black and white|b&w|monochrome|mono/,
    turns: [
      [
        setOperations(
          { op: "saturation", params: { amount: -1 } },
          { op: "tone_curve", params: { preset: "hard" } },
          { op: "contrast", params: { amount: 0.28 } },
          { op: "grain", params: { amount: 0.55, size: 1.2 } },
        ),
      ],
      "Took it to black and white with a hard curve, extra contrast and some real grain for bite.",
    ],
  },
  {
    match: /moody|dark|melancholy|somber|grim/,
    turns: [
      [
        setOperations(
          { op: "tone_curve", params: { preset: "film" } },
          { op: "blacks_whites", params: { blacks: 0.32 } },
          { op: "saturation", params: { amount: -0.35 } },
          { op: "vignette", params: { amount: 0.42, size: 0.45 } },
          { op: "grain", params: { amount: 0.4, size: 1.2 } },
        ),
      ],
      "Faded the blacks, pulled the color back and closed the frame in with a vignette and some grain. Moody without going murky.",
    ],
  },
  {
    match: /vintage|retro|old photo/,
    turns: [
      // Deliberately wrong first: the tool rejects "sepia", the error comes
      // back, and the next turn uses real operations. This exercises the
      // self-correction path end to end.
      [setOperations({ op: "sepia", params: { amount: 0.5 } })],
      [
        setOperations(
          { op: "color_balance", params: { temperature: 0.22, tint: 0.1 } },
          { op: "saturation", params: { amount: -0.28 } },
          { op: "blacks_whites", params: { blacks: 0.38 } },
          { op: "grain", params: { amount: 0.5, size: 1.5 } },
        ),
      ],
      "There is no sepia control, so I built the look out of the knobs that exist: warm balance, muted color, lifted blacks and coarse grain.",
    ],
  },
  {
    match: /exposure|brighter|brighten|underexposed|too dark|pop|flat/,
    turns: [
      [measure()],
      [
        setOperations(
          { op: "exposure", params: { amount: 0.34 } },
          { op: "contrast", params: { amount: 0.18 } },
        ),
      ],
      "It measured dark with the highlights nowhere near the top, so I opened up the exposure and added contrast to give it some snap.",
    ],
  },
  {
    match: /less|dial it back|softer|subtle|too much|reduce|ease/,
    turns: [
      [
        setOperations(
          { op: "grain", params: { amount: 0.18 } },
          { op: "vignette", params: { amount: 0.18 } },
        ),
      ],
      "Eased off the grain and the vignette. The rest of the look is untouched.",
    ],
  },
  {
    match: /reset|start over|undo everything|original/,
    turns: [[toolCall("reset_edits", {})], "Cleared everything — back to the original photo."],
  },
  {
    // "crop to portrait, center on the person" — segment then subject-fit crop.
    match: /crop.*(portrait|person|subject)|portrait.*crop|reframe/,
    turns: [
      [toolCall("segment", { prompt: "the person" })],
      [toolCall("set_frame", { aspect: "4:5", subjectMaskId: "person", padding: 0.2 })],
      "Cropped to a 4:5 portrait centered on the person. The dimmed part of the preview stays out of the export — drag the frame if you want to reframe.",
    ],
  },
  {
    match: /crop.*(square|wide|16)|square crop/,
    turns: [
      [toolCall("set_frame", { aspect: "square" })],
      "Cropped to the largest centered square. Everything outside the frame is dimmed, not deleted — export applies the trim.",
    ],
  },
  {
    match: /rotate|sideways|turn it/,
    turns: [
      [toolCall("set_frame", { rotate: 90 })],
      "Rotated the photo 90° clockwise. Ask again to keep turning, or say 'rotate 0' to reset.",
    ],
  },
  {
    match: /blur.*(background|except)|everything except|de-emphasize|emphasize.*(object|person|subject)/,
    turns: [
      [toolCall("segment", { prompt: "the person" })],
      [toolCall("invert_mask", { maskId: "person" })],
      [
        setOperations(
          { op: "dodge_burn", params: { amount: 0.28, range: "midtones" }, mask: "person" },
          { op: "saturation", params: { amount: 0.18 }, mask: "person" },
          { op: "lens_blur", params: { radius: 0.22 }, mask: "not_person" },
          { op: "contrast", params: { amount: -0.12 }, mask: "not_person" },
        ),
      ],
      "Selected the person, then the rest of the frame, and pushed the subject forward while softening everything around them.",
    ],
  },
];

const FALLBACK = {
  turns: [
    [measure()],
    [
      setOperations(
        { op: "tone_curve", params: { preset: "soft" } },
        { op: "contrast", params: { amount: 0.14 } },
        { op: "saturation", params: { amount: 0.1 } },
      ),
    ],
    "Gave it a gentle all-round lift: softer curve, a touch more contrast and slightly richer color.",
  ],
};

function pickScript(prompt) {
  return SCRIPTS.find((script) => script.match.test(prompt)) ?? FALLBACK;
}

function chatMessages(body) {
  return Array.isArray(body.messages) ? body.messages : [];
}

/** Flatten Responses `input` (+ instructions) into chat-style messages for scripting. */
function responsesAsChatMessages(body) {
  const messages = [];
  if (typeof body.instructions === "string" && body.instructions.trim()) {
    messages.push({ role: "system", content: body.instructions });
  }
  const input = Array.isArray(body.input) ? body.input : [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "function_call") {
      const existing = messages[messages.length - 1];
      const call = {
        id: item.call_id ?? item.id,
        type: "function",
        function: { name: item.name, arguments: item.arguments },
      };
      if (existing?.role === "assistant" && Array.isArray(existing.tool_calls)) {
        existing.tool_calls.push(call);
      } else {
        messages.push({ role: "assistant", content: null, tool_calls: [call] });
      }
      continue;
    }
    if (item.type === "function_call_output") {
      messages.push({
        role: "tool",
        tool_call_id: item.call_id,
        content: typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? ""),
      });
      continue;
    }
    if (item.role === "user" || item.role === "assistant" || item.role === "system") {
      const content =
        typeof item.content === "string"
          ? item.content
          : Array.isArray(item.content)
            ? item.content
                .map((part) => {
                  if (typeof part?.text === "string") return part.text;
                  if (part?.type === "input_text" && typeof part.text === "string") return part.text;
                  return "";
                })
                .join("")
            : "";
      messages.push({ role: item.role, content });
    }
  }
  return messages;
}

/** The turn index is how many assistant replies came after the last user message. */
function turnIndex(messages) {
  const lastUser = messages.map((message) => message.role).lastIndexOf("user");
  return messages.slice(lastUser + 1).filter((message) => message.role === "assistant").length;
}

function lastUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== "user") continue;
    const content = messages[index].content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part?.text === "string") return part.text;
          if (typeof part?.input_text === "string") return part.input_text;
          return "";
        })
        .join("");
    }
    return String(content ?? "");
  }
  return "";
}

/** First-prompt suggestion requests are tool-free and ask for a JSON array. */
function isSuggestionRequest(messages, toolsOffered) {
  if (toolsOffered) return false;
  return messages.some(
    (message) =>
      message.role === "system" &&
      typeof message.content === "string" &&
      message.content.includes("JSON array of strings"),
  );
}

const MOCK_SUGGESTIONS = [
  "Warm up the golden light",
  "Give it a moody film look",
  "Blur the background behind the subject",
  "Fix the exposure",
];

function decideTurn(messages, toolsOffered) {
  const prompt = lastUserText(messages).toLowerCase();

  if (isSuggestionRequest(messages, toolsOffered)) {
    console.log(`[mock-llm] suggestion request -> ${MOCK_SUGGESTIONS.length} chips`);
    return { kind: "message", text: JSON.stringify(MOCK_SUGGESTIONS), prompt, step: 0 };
  }

  const script = pickScript(prompt);
  const step = turnIndex(messages);
  const turn = toolsOffered ? script.turns[step] : null;

  if (typeof turn === "string" || turn === undefined || turn === null) {
    const text =
      typeof turn === "string"
        ? turn
        : (script.turns.find((entry) => typeof entry === "string") ??
          "Done — have a look at the sliders on the left.");
    console.log(`[mock-llm] "${prompt}" step ${step} -> message`);
    return { kind: "message", text, prompt, step };
  }

  console.log(
    `[mock-llm] "${prompt}" step ${step} -> ${turn.map((call) => call.function.name).join(", ")}`,
  );
  return { kind: "tools", calls: turn, prompt, step };
}

function chatCompletionBody(payload, decision) {
  const message =
    decision.kind === "message"
      ? { role: "assistant", content: decision.text }
      : { role: "assistant", content: null, tool_calls: decision.calls };

  return {
    id: `chatcmpl-mock-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: payload.model ?? "mock",
    choices: [{ index: 0, message, finish_reason: decision.kind === "tools" ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function responsesBody(payload, decision) {
  const output =
    decision.kind === "message"
      ? [
          {
            type: "message",
            id: `msg_mock_${Date.now()}`,
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: decision.text }],
          },
        ]
      : decision.calls.map((call, index) => ({
          type: "function_call",
          id: `fc_mock_${Date.now()}_${index}`,
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
          status: "completed",
        }));

  return {
    id: `resp_mock_${Date.now()}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model: payload.model ?? "mock",
    status: "completed",
    output,
    output_text: decision.kind === "message" ? decision.text : "",
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  };
}

function toolsOffered(body) {
  return Array.isArray(body.tools) && body.tools.length > 0;
}

const server = createServer((request, response) => {
  const cors = {
    "Access-Control-Allow-Origin": request.headers.origin ?? "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (request.method === "OPTIONS") {
    response.writeHead(204, cors).end();
    return;
  }

  const path = request.url?.split("?")[0] ?? "";
  const isChat = path.endsWith("/chat/completions");
  const isResponses = path.endsWith("/responses");
  if ((!isChat && !isResponses) || request.method !== "POST") {
    response
      .writeHead(404, { ...cors, "Content-Type": "application/json" })
      .end(JSON.stringify({ error: { message: `no route for ${request.method} ${request.url}` } }));
    return;
  }

  let raw = "";
  request.on("data", (chunk) => {
    raw += chunk;
  });
  request.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(raw || "{}");
    } catch {
      response
        .writeHead(400, { ...cors, "Content-Type": "application/json" })
        .end(JSON.stringify({ error: { message: "request body was not valid JSON" } }));
      return;
    }

    const messages = isResponses ? responsesAsChatMessages(payload) : chatMessages(payload);
    const decision = decideTurn(messages, toolsOffered(payload));
    const body = isResponses ? responsesBody(payload, decision) : chatCompletionBody(payload, decision);

    // A beat of latency so the "Working on it…" state is actually visible.
    const delayMs = Number.parseInt(process.env.MOCK_LLM_DELAY_MS ?? "400", 10);
    setTimeout(() => {
      response.writeHead(200, { ...cors, "Content-Type": "application/json" }).end(JSON.stringify(body));
    }, Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 400);
  });
});

server.listen(PORT, () => {
  console.log(`[mock-llm] OpenAI-compatible mock listening on http://localhost:${PORT}/v1`);
  console.log(`[mock-llm] routes: POST /v1/responses , POST /v1/chat/completions`);
});
