/**
 * ONNX Runtime WASM asset paths for the segmentation worker.
 *
 * Transformers.js defaults `env.backends.onnx.wasm.wasmPaths` to
 * `cdn.jsdelivr.net`. Our production CSP only allows `script-src 'self'
 * 'wasm-unsafe-eval'`, so those CDN loads are blocked and Florence-2 never
 * finishes initializing. Point ORT at the files Vite emits into `/assets`
 * instead — same origin, content-hashed, already under the CF 25 MiB limit.
 */

import { env } from "@huggingface/transformers";
import ortAsyncifyMjs from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortAsyncifyWasm from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import ortMjs from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import ortWasm from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

export type OrtWasmPaths = { mjs: string; wasm: string };

/** Match Transformers.js: Safari uses the non-asyncify build. */
export function resolveOrtWasmPaths(
  userAgent: string,
  vendor = "",
): OrtWasmPaths {
  if (isSafari(userAgent, vendor)) {
    return { mjs: ortMjs, wasm: ortWasm };
  }
  return { mjs: ortAsyncifyMjs, wasm: ortAsyncifyWasm };
}

/**
 * Override Transformers.js CDN defaults with same-origin Vite asset URLs.
 * Call once before `from_pretrained`.
 */
export function configureOrtWasmPaths(
  nav: Pick<Navigator, "userAgent" | "vendor"> = self.navigator,
): OrtWasmPaths {
  const paths = resolveOrtWasmPaths(nav.userAgent, nav.vendor ?? "");
  const wasmEnv = env.backends.onnx.wasm;
  if (wasmEnv) {
    wasmEnv.wasmPaths = paths;
  }
  // Transformers.js otherwise fetches the .mjs and re-hosts it as a blob URL,
  // which needs `script-src blob:`. Loading the same-origin module directly
  // keeps the CSP tight.
  env.useWasmCache = false;
  return paths;
}

function isSafari(userAgent: string, vendor: string): boolean {
  const isAppleVendor = vendor.includes("Apple");
  const notOtherBrowser =
    !/CriOS|FxiOS|EdgiOS|OPiOS|mercury|brave/i.test(userAgent) &&
    !userAgent.includes("Chrome") &&
    !userAgent.includes("Android");
  return isAppleVendor && notOtherBrowser;
}
