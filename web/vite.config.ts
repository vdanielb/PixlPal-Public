import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  worker: {
    format: "es",
  },
  build: {
    target: "es2022",
  },
  // Forward /api to `wrangler dev` when testing the hosted assistant locally.
  // Vite alone has no Worker; run `pnpm --filter @pixelcam/web cf:preview` or
  // start wrangler on :8787 alongside `pnpm dev:web`.
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
