# AGENTS.md

## Cursor Cloud specific instructions

PixlPal (formerly PixelCamAI) is a **fully client-side** monorepo (no backend, no database, no network services). It has a Rust image engine (`engine/`) consumed by a React + Vite **web** app (`web/`, WASM) and an Expo **mobile** app (`mobile/`, UniFFI turbo module). See `README.md` for architecture and the full command list.

### Toolchain caveats (already applied in the VM snapshot)
- **Rust must be ≥ 1.85.** A transitive dependency (`moxcms`) requires edition 2024, so the older default (1.83) fails `pnpm build:wasm`/`pnpm test:engine`. The snapshot's default `rustup` toolchain has been updated to current `stable`.
- **`wasm-pack`** is required for the web engine build and is installed globally (`/usr/local/cargo/bin/wasm-pack`).

### Web app (the runnable product here)
- **You must run `pnpm build:wasm` once before `pnpm dev:web`.** It compiles the Rust engine to WASM into `web/src/engine/` (gitignored). Without it the web app fails to load.
- **Re-run `pnpm build:wasm` after editing any Rust in `engine/`** — Vite does NOT rebuild the WASM automatically; the dev server only hot-reloads TS/React.
- Run the dev server with `pnpm dev:web` (Vite, http://localhost:5173). Hosted `/api/agent` is not available under Vite alone — either fill in *Use your own API key* (e.g. `pnpm mock:llm` on `:3939`) or run `pnpm --filter @pixelcam/web cf:preview` / `wrangler dev` for the Worker.
- Typecheck with `pnpm --filter @pixelcam/web typecheck`. There is **no ESLint** configured in this repo.
- Production deploy: `pnpm deploy:web`. Hosted assistant needs the `OPENAI_API_KEY` Worker secret (`cd web && pnpm exec wrangler secret put OPENAI_API_KEY`). Anonymous visitors get `CHAT_LIMIT` chats (default 3) via cookie + KV — no accounts. Hosted prompts are also capped by `MAX_USER_MESSAGE_CHARS` (default 1000) and each completion by `MAX_OUTPUT_TOKENS` (default 4096, includes reasoning tokens). `AGENT_COMPLETION_TIMEOUT_MS` (default 90s) is only a hung-request guard.

### Engine
- Tests: `pnpm test:engine` (`cargo test`, ~38 tests).

### Mobile
- The Expo app needs native toolchains (Xcode for iOS, or Android SDK + NDK + `cargo-ndk`) and a development build; it **cannot run in this headless cloud VM**. Binding-only regeneration (`pnpm --filter react-native-pixelcam-engine ubrn:bindings`) does not need a mobile toolchain.
