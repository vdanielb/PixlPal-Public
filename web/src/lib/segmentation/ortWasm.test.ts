import { describe, expect, it } from "vitest";
import { resolveOrtWasmPaths } from "./ortWasm";

describe("resolveOrtWasmPaths", () => {
  it("uses the asyncify build for Chromium", () => {
    const paths = resolveOrtWasmPaths(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      "Google Inc.",
    );
    expect(paths.mjs).toMatch(/ort-wasm-simd-threaded\.asyncify\.mjs/);
    expect(paths.wasm).toMatch(/ort-wasm-simd-threaded\.asyncify\.wasm/);
    expect(paths.mjs).not.toMatch(/jsdelivr/);
    expect(paths.wasm).not.toMatch(/jsdelivr/);
  });

  it("uses the non-asyncify build for Safari", () => {
    const paths = resolveOrtWasmPaths(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      "Apple Computer, Inc.",
    );
    expect(paths.mjs).toMatch(/ort-wasm-simd-threaded\.mjs/);
    expect(paths.wasm).toMatch(/ort-wasm-simd-threaded\.wasm/);
    expect(paths.mjs).not.toMatch(/asyncify/);
  });
});
