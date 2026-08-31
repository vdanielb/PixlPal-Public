/**
 * Where Florence-2 weights come from.
 *
 * Preferred: same-origin files under `/models/florence-2-base-ft` (see
 * `pnpm fetch:florence2`). Those cannot ship in the Cloudflare Worker bundle —
 * individual ONNX files exceed the 25 MiB static-asset limit — so production
 * falls back to the Hugging Face Hub. Photos still never leave the device;
 * only model weights are downloaded.
 */

export const LOCAL_MODEL_PATH = "/models/florence-2-base-ft";
export const REMOTE_MODEL_ID = "onnx-community/Florence-2-base-ft";

export type ModelSource =
  | { mode: "local"; path: typeof LOCAL_MODEL_PATH }
  | { mode: "remote"; path: typeof REMOTE_MODEL_ID };

/**
 * Fetch wrapper for Hub downloads.
 *
 * Hugging Face/CloudFront returns 404 HTML for `/resolve/...` when the request
 * carries a cross-site `Referer` (our `strict-origin-when-cross-origin` policy
 * sends the workers.dev origin). That HTML then makes Transformers.js fail with
 * either a DOCTYPE JSON parse error or `Cannot read properties of undefined
 * (reading 'tokenizer_class')` when tokenizer files look missing. Omitting the
 * referrer avoids the hotlink block; model weights are still public Hub files.
 */
export function hubFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Build a fresh Request instead of relying only on the second `fetch`
  // argument. Transformers.js often gives us a Request whose referrer was
  // inherited from the Worker; setting both values here makes the no-referrer
  // policy survive that path and every Hub redirect.
  const request = new Request(input, {
    ...init,
    referrer: "",
    referrerPolicy: "no-referrer",
  });
  return fetch(request);
}

/**
 * True when a response body looks like a real model `config.json`, not the
 * SPA HTML shell Vite/Cloudflare return for missing `/models/*` paths.
 */
export function looksLikeModelConfig(body: string, contentType: string | null): boolean {
  if (contentType && /text\/html/i.test(contentType)) return false;
  const trimmed = body.trimStart();
  if (!trimmed.startsWith("{")) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/** Probe same-origin weights; fall back to the Hub when they are missing. */
export async function resolveModelSource(
  fetchImpl: typeof fetch = fetch,
): Promise<ModelSource> {
  try {
    const response = await fetchImpl(`${LOCAL_MODEL_PATH}/config.json`, {
      method: "GET",
      // Revalidate so a previously cached SPA HTML shell for this URL does not
      // stick after the user runs `pnpm fetch:florence2`.
      cache: "no-cache",
    });
    if (!response.ok) return { mode: "remote", path: REMOTE_MODEL_ID };
    const contentType = response.headers.get("content-type");
    const body = await response.text();
    if (!looksLikeModelConfig(body, contentType)) {
      return { mode: "remote", path: REMOTE_MODEL_ID };
    }
    return { mode: "local", path: LOCAL_MODEL_PATH };
  } catch {
    return { mode: "remote", path: REMOTE_MODEL_ID };
  }
}

/**
 * Rewrite cryptic Transformers.js / Hub load failures into something actionable.
 */
export function explainSegmentationLoadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /unexpected token\s*['"`]?</i.test(message) ||
    /<!doctype/i.test(message) ||
    /is not valid JSON/i.test(message) ||
    /tokenizer_class/i.test(message) ||
    /failed to fetch/i.test(message) ||
    /content security policy/i.test(message) ||
    /cdn\.jsdelivr\.net/i.test(message)
  ) {
    return [
      "segmentation model failed to load.",
      "For local development run `pnpm fetch:florence2`.",
      "In production the browser downloads weights from Hugging Face on first use",
      "(photos still never leave the device).",
      `Details: ${message}`,
    ].join(" ");
  }
  return message;
}
