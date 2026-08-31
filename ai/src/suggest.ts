/**
 * First-prompt suggestions: one plain completion (no tools) that looks at the
 * freshly opened photo and proposes a few edits the user might ask for.
 *
 * Transport-agnostic like the rest of this package — the host decides whether
 * the messages go to the hosted Worker or a BYOK endpoint.
 */

import type { ChatMessage, ImageContentPart } from "./types";

export const MAX_SUGGESTIONS = 4;

const SUGGESTION_SYSTEM_PROMPT = [
  "You are the editing assistant inside PixlPal, a photo editor that edits",
  "photos by adjusting exposure, contrast, tone curves, color balance,",
  "saturation, grain, vignettes, bloom, halation, lens blur, and per-subject",
  "masked edits. You never generate pixels.",
  "",
  `Look at the user's photo and propose exactly ${MAX_SUGGESTIONS} edits they`,
  "might ask for. Each suggestion must:",
  "- be specific to what is visible in this photo (its subject, light, and mood),",
  "- describe a look or outcome in plain language, not slider names or numbers,",
  "- be a short imperative sentence of at most 8 words.",
  "",
  'Reply with only a JSON array of strings, e.g. ["Warm up the evening light",',
  '"Blur the busy background"]. No prose, no markdown, no numbering.',
].join("\n");

/** Build the one-shot conversation asking the model for suggestions. */
export function buildSuggestionMessages(image?: ImageContentPart | null): ChatMessage[] {
  const text = "Here is the photo I just opened. What edits would you suggest?";
  return [
    { role: "system", content: SUGGESTION_SYSTEM_PROMPT },
    {
      role: "user",
      content: image ? [{ type: "text", text }, image] : text,
    },
  ];
}

function cleanLine(line: string): string {
  return line
    .trim()
    // Bullets, numbering, and stray quotes models sometimes add around items.
    .replace(/^[-*\u2022]\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/^"(.*)"$/, "$1")
    .trim();
}

function normalize(items: unknown[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    const cleaned = cleanLine(item);
    // Too-long entries are usually prose that leaked in, not suggestions.
    if (cleaned.length === 0 || cleaned.length > 80) continue;
    if (out.some((existing) => existing.toLowerCase() === cleaned.toLowerCase())) continue;
    out.push(cleaned);
    if (out.length === MAX_SUGGESTIONS) break;
  }
  return out;
}

/**
 * Parse the model's reply into suggestion strings. Accepts a strict JSON
 * array, an array embedded in prose/markdown, or a plain bulleted list.
 * Returns [] when nothing usable is found — the caller falls back.
 */
export function parseSuggestions(content: string | null | undefined): string[] {
  if (!content) return [];
  const text = content.trim();
  if (!text) return [];

  // Preferred: a JSON array somewhere in the reply (possibly fenced).
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed)) {
        const items = normalize(parsed);
        if (items.length > 0) return items;
      }
    } catch {
      // fall through to line parsing
    }
  }

  // A single line is more likely a refusal or prose than a suggestion list.
  const fromLines = normalize(text.split("\n"));
  return fromLines.length >= 2 ? fromLines : [];
}
