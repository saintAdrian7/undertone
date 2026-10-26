# Undertone

**Version:** 0.1.0 | **Stack:** Electron 44, electron-vite 6, React 19, TypeScript (strict), zod 4, Vitest | **Runtime:** Node 22+

Desktop app, no fixed network port (the dev renderer is served by the electron-vite dev server).

## What

An open-source interview and meeting copilot: a capture-proof overlay that listens to both sides of a call (microphone and system audio), transcribes locally with Whisper, and whispers what to say next. Answers come from the Claude API, the Claude Code CLI, or any OpenAI-compatible server.

## Commands

```bash
./setup.sh                  # First-time setup: Node check, npm install, creates .env
npm install                 # Install dependencies
npm run dev                 # Run the app in development (predev copies the VAD and ONNX assets first)
npm run build               # Production build into out/ (prebuild copies assets first)
npm run dist                # Build, then an unpacked Windows app in dist/ (electron-builder --win --dir)

npm test                    # Vitest, single run
npx vitest run src/main/answer/auto-answer.test.ts   # One test file
npm run test:coverage       # Coverage; thresholds are 80% in vitest.config.ts
npm run test:watch          # Vitest in watch mode

npm run typecheck           # tsc for the main/preload and renderer projects
npm run lint                # oxlint over src/
npm run assets              # Copy the VAD model and ONNX runtime WASM into src/renderer/public/vendor
```

CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm run typecheck`, `npm run lint` and `npm test` on Windows and Ubuntu.

## Architecture

```
src/main/        Electron main process. Pure modules; only index.ts imports "electron".
  answer/        answer service (a new ask aborts the one in flight), auto-answer scheduler
  llm/           providers: claude-provider, openai-compatible-provider, claude-code-provider; prompt
  config.ts      env vars -> one LLM config (resolveConfig); config-store.ts holds Settings choices
  state/         store that owns AppState
  overlay/ shortcuts/ tray/ capture/ profile/
src/preload/     Sandboxed bridge exposing window.ipc, allowlisted channels only
src/renderer/    React UI, sandboxed (no Node access)
  audio/         microphone (getUserMedia) and loopback (getDisplayMedia) capture, VAD per speaker
  vad/           segmenter: speech turns from VAD frames
  stt/           WhisperProvider: transformers.js, runs on this machine
  answer/        useAnswer: asks main, streams chunks into the panel
  settings/      Settings window, routed at /settings
src/shared/      Used by all three sides: state.ts, ipc-channels.ts, ipc.ts, providers.ts
```

Data flow: the renderer's audio pipeline cuts speech into turns, Whisper transcribes them, and each entry goes to the main store through `transcriptApply`. When the interviewer finishes a question and goes quiet, the auto-answer scheduler broadcasts `chatSubmit`. The renderer then calls `answer:ask`, the answer service runs the active provider, and `answer:chunk` events stream the reply back.

## Key Files

- `src/main/index.ts`: app wiring, windows, IPC handlers, `.env` loading
- `src/main/answer/auto-answer.ts`: when to answer without being asked
- `src/main/answer/service.ts`: runs one answer and streams it
- `src/main/llm/claude-code-provider.ts`: keeps one `claude -p` session alive
- `src/main/config.ts`: maps environment variables to a provider and model
- `src/shared/state.ts`: AppState schema and `RendererPatchSchema` (what the renderer may change)
- `src/shared/ipc-channels.ts` and `src/shared/ipc.ts`: channel names and payload schemas
- `src/preload/index.ts`: the typed bridge and its allowlists
- `src/renderer/audio/listening.ts`: microphone and system-audio capture
- `src/renderer/stt/whisper-provider.ts`: local Whisper transcription
- `scripts/copy-assets.mjs`: copies VAD and ONNX assets from node_modules

## Configuration

Settings chosen in the app (Settings > Model, saved as `llm.json` in the user-data folder) override `.env`. Otherwise `.env` decides. Copy `.env.example` to `.env` to start.

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | One model setup | Claude API key. On its own it selects Claude. |
| `ANTHROPIC_MODEL` | No | Claude model; default `claude-sonnet-5-5` |
| `LLM_PROVIDER` | No | `anthropic` (default when a key is set), `openai`, `ollama`, or `claude-code` |
| `LLM_MODEL` | With `LLM_PROVIDER` | Model name; for `claude-code`, `sonnet` (default) or `haiku` |
| `LLM_BASE_URL` | No | OpenAI-compatible endpoint, e.g. `http://localhost:1234/v1` |
| `LLM_API_KEY` | No | Key for the OpenAI-compatible endpoint |
| `VITE_WHISPER_MODEL` | No | Whisper model id; default `onnx-community/whisper-base` |
| `VITE_VAD_ASSETS_URL`, `VITE_ORT_WASM_URL`, `VITE_TRANSFORMERS_ORT_WASM_URL` | No | Override where the VAD and ONNX runtime assets load from |

`CLAUDE_CODE_COMMAND` (default `claude`) sets the Claude Code CLI binary. The app reads it from the real process environment, not from `.env`.

## Gotchas

- The sandboxed preload must be CommonJS (`electron.vite.config.ts` forces `format: 'cjs'`) and cannot load anything from node_modules. `src/shared/ipc-channels.ts` must stay dependency-free for this reason.
- `.env` location: in development the app reads `.env` from the project root, then from the app path. A packaged app reads only `.env` in its user-data folder. Real environment variables override the file.
- The Claude Code provider is spawned with `child_process.spawn` and no `shell` option. Keep it that way on Windows: the system prompt travels as a command-line argument, and a shell would mangle it.
- `childEnvironment` strips the markers of an enclosing Claude Code session (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SSE_PORT`, `CLAUDE_CODE_SESSION_ID`) and the app's own `ANTHROPIC_*`/`LLM_*` keys and endpoints; login tokens and `CLAUDE_CONFIG_DIR` are kept. The CLI runs in `userData/claude-cwd`, an empty folder, and the provider refuses the session if the init event lists any tool or MCP server.
- Keys never leave the main process. The renderer receives `PublicLlmSettings`, which carries `hasApiKey` and never the key. Do not add key fields to any payload.
- The renderer cannot change main-owned state. `RendererPatchSchema` is a strict object with no shortcuts, capture flags or `isAnswering`.
- The renderer CSP lives in `src/renderer/index.html`. The dev server adds extra sources through `VITE_CSP_EXTRA` only while serving; do not widen the production policy.
- `out/`, `dist/`, `coverage/`, and `src/renderer/public/vendor/` are generated and git-ignored. `npm run assets` runs before `dev` and `build`, and fails if `npm install` has not run.

## Conventions

- Test first. Commit the failing test as `test: ... (RED)`, then the change that makes it pass as `feat:` or `fix:` with `(GREEN)` (see `git log`).
- TypeScript strict with `noUncheckedIndexedAccess`. No `any`.
- Validate every IPC payload with zod. Add new schemas to `src/shared/ipc.ts`. Every handler calls `guard(event)` to check the sender.
- Keep main-process logic in pure modules. Inject Electron, the file system and child processes; tests use fakes and never launch Electron.
- Renderer component tests opt into jsdom with `// @vitest-environment jsdom`.
- No new runtime dependency without a sentence on why in the PR.
- No assets from other products. Lucide icons and the Inter font are the only third-party visual assets.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
