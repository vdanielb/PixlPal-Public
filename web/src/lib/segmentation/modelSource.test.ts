import { describe, expect, it, vi } from "vitest";
import {
  LOCAL_MODEL_PATH,
  REMOTE_MODEL_ID,
  explainSegmentationLoadError,
  hubFetch,
  looksLikeModelConfig,
  resolveModelSource,
} from "./modelSource";

describe("looksLikeModelConfig", () => {
  it("accepts a JSON object body", () => {
    expect(looksLikeModelConfig('{"model_type":"florence2"}', "application/json")).toBe(true);
  });

  it("rejects the SPA HTML shell that caused the DOCTYPE JSON error", () => {
    expect(
      looksLikeModelConfig("<!doctype html><html><body>PixelCam</body></html>", "text/html"),
    ).toBe(false);
  });

  it("rejects HTML even when the content-type lies", () => {
    expect(looksLikeModelConfig("<!DOCTYPE html>", "application/json")).toBe(false);
  });
});

describe("resolveModelSource", () => {
  it("uses local weights when config.json is real JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('{"model_type":"florence2"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(resolveModelSource(fetchImpl)).resolves.toEqual({
      mode: "local",
      path: LOCAL_MODEL_PATH,
    });
  });

  it("falls back to Hugging Face when the SPA shell is returned", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("<!doctype html><html></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    await expect(resolveModelSource(fetchImpl)).resolves.toEqual({
      mode: "remote",
      path: REMOTE_MODEL_ID,
    });
  });

  it("falls back to Hugging Face on HTTP errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("missing", { status: 404 }));
    await expect(resolveModelSource(fetchImpl)).resolves.toEqual({
      mode: "remote",
      path: REMOTE_MODEL_ID,
    });
  });
});

describe("explainSegmentationLoadError", () => {
  it("rewrites the DOCTYPE / invalid JSON failure into a clear message", () => {
    const explained = explainSegmentationLoadError(
      new Error(`Unexpected token '<', "<!doctype "... is not valid JSON`),
    );
    expect(explained).toContain("segmentation model failed to load");
    expect(explained).toContain("pnpm fetch:florence2");
    expect(explained).toContain("Unexpected token");
  });

  it("rewrites the tokenizer_class failure from a blocked Hub download", () => {
    const explained = explainSegmentationLoadError(
      new Error("Cannot read properties of undefined (reading 'tokenizer_class')"),
    );
    expect(explained).toContain("segmentation model failed to load");
    expect(explained).toContain("Hugging Face");
    expect(explained).toContain("tokenizer_class");
  });

  it("rewrites CSP / jsdelivr ORT loader failures", () => {
    const explained = explainSegmentationLoadError(
      new Error(
        "Loading the script 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs' violates Content Security Policy",
      ),
    );
    expect(explained).toContain("segmentation model failed to load");
  });


  it("passes through unrelated errors", () => {
    expect(explainSegmentationLoadError(new Error("could not find \"person\""))).toBe(
      'could not find "person"',
    );
  });
});

describe("hubFetch", () => {
  it("forces referrerPolicy no-referrer so HF does not hotlink-404", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await hubFetch(
      "https://huggingface.co/onnx-community/Florence-2-base-ft/resolve/main/config.json",
    );
    const request = fetchSpy.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    expect((request as Request).url).toBe(
      "https://huggingface.co/onnx-community/Florence-2-base-ft/resolve/main/config.json",
    );
    expect((request as Request).referrer).toBe("");
    expect((request as Request).referrerPolicy).toBe("no-referrer");
    fetchSpy.mockRestore();
  });
});
