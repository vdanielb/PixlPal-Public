/**
 * Registers the PixlPal editor's tools with the browser's WebMCP
 * `ModelContext` for the lifetime of the app.
 *
 * The host object is re-created by `App` on every render; a ref keeps the
 * registered tools pointing at the latest closures, so an external agent
 * always sees the live editor state without ever re-registering.
 */

import { useEffect, useRef, useState } from "react";
import { registerWebMcpTools, type WebMcpHost } from "./bridge";
import { getModelContext } from "./modelContext";

export type WebMcpStatus = "unavailable" | "registering" | "registered" | "error";

export function useWebMcp(host: WebMcpHost): WebMcpStatus {
  const hostRef = useRef(host);
  hostRef.current = host;

  const [status, setStatus] = useState<WebMcpStatus>("unavailable");

  useEffect(() => {
    const modelContext = getModelContext();
    if (!modelContext) return;

    const controller = new AbortController();
    setStatus("registering");

    const liveHost: WebMcpHost = {
      isPhotoOpen: () => hostRef.current.isPhotoOpen(),
      getOpState: () => hostRef.current.getOpState(),
      applyOpState: (next) => hostRef.current.applyOpState(next),
      getImageStats: () => hostRef.current.getImageStats(),
      getEditState: () => hostRef.current.getEditState(),
      segment: (prompt, signal) => {
        const segment = hostRef.current.segment;
        if (!segment) {
          return Promise.resolve({ error: "segmentation is not available in this session." });
        }
        return segment(prompt, signal);
      },
      invertMask: (maskId, signal) => {
        const invertMask = hostRef.current.invertMask;
        if (!invertMask) {
          return Promise.resolve({ error: "mask invert is not available in this session." });
        }
        return invertMask(maskId, signal);
      },
      getMaskBounds: (maskId, signal) => {
        const getMaskBounds = hostRef.current.getMaskBounds;
        if (!getMaskBounds) {
          return Promise.resolve({ error: "mask bounds are not available in this session." });
        }
        return getMaskBounds(maskId, signal);
      },
    };

    void registerWebMcpTools(modelContext, liveHost, { signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (result.failed.length > 0) {
          console.warn("[webmcp] some tools failed to register:", result.failed);
        }
        setStatus(result.registered.length > 0 ? "registered" : "error");
      },
    );

    // Aborting unregisters every tool (spec: ModelContextRegisterToolOptions.signal).
    return () => controller.abort();
  }, []);

  return status;
}
