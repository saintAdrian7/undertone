# Meeting Copilot

A local-only desktop copilot for live conversations. It floats a small capture-proof overlay over your screen, listens to both sides of a call, keeps a running transcript, and streams answers from Claude into the panel when you ask.

Audio capture, voice detection and transcription run on your machine. Two things leave it: when you ask a question, the recent transcript and (if the **Screen** toggle is on) a screenshot of your display are sent to Anthropic with your own API key; and the Whisper model is downloaded from Hugging Face the first time it is used. Nothing else is fetched at runtime; the voice-activity model and ONNX runtime are bundled from `node_modules`.

## Setup

Requirements: Node.js 22+, Windows 10/11 (macOS works for the overlay but system audio capture is Windows-only in this version).

```bash
npm install
copy .env.example .env
```

Pick a model in `.env`. Claude is the default when its key is set:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Any OpenAI-compatible server works too, which is the easy way to test with free or local models:

```
# OpenRouter free tier
LLM_PROVIDER=openai
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=sk-or-...
LLM_MODEL=meta-llama/llama-3.3-70b-instruct:free

# Ollama on this machine (no key)
LLM_PROVIDER=ollama
LLM_MODEL=llama3.2
```

Groq (`https://api.groq.com/openai/v1`), LM Studio (`http://localhost:1234/v1`) and vLLM use the same `openai` form. Screenshots are sent as image parts, so pick a vision-capable model if you keep the **Screen** toggle on; text-only models still work for the transcript.

Run in development:

```bash
npm run dev
```

Build a production bundle:

```bash
npm run build
```

Package an unpacked Windows app into `dist/win-unpacked` (electron-builder; the afterPack hook flips the Electron fuses so the shipped binary cannot run as Node, cannot be attached with `--inspect`, and only loads code from its asar):

```bash
npm run dist
```

## Using it

| Action | How |
|---|---|
| Start / stop listening | Click **Start** on the bar, or `Ctrl+Shift+\` |
| Show / hide the answer panel | Click **Ask** on the bar |
| Ask for an answer | Type in the panel and press Enter, or press `Ctrl+Enter` anywhere for "What should I say next?" |
| Hide from screen share | Click **Shown/Hidden** on the bar, or `Ctrl+\` |
| Move the bar | Drag it, or `Ctrl+Arrow keys`. Double-click to reset. |
| Scroll the transcript | `Ctrl+Shift+Up/Down` |
| Clear the answer | `Ctrl+R` |
| Tray icon | Click to show or hide the panel; right-click for listening, invisibility and Quit. The dot turns red while listening. |

When the panel is hidden from screen share it uses the operating system's content-protection flag, so screen recorders and meeting apps capture everything except the copilot windows.

Global shortcuts are first come, first served across the whole desktop. If another app already owns one (Cluely, for example, uses the same `Ctrl+Shift+\`), the log reports `Failed to register global shortcut` and that action stays available from the bar; the defaults live in `src/shared/state.ts`.

## How it works

```
mic (getUserMedia) ───┐
                      ├─ Silero VAD (per speaker) ─ utterance ─ Whisper (transformers.js, local)
system audio ─────────┘                                             │
(loopback via getDisplayMedia)                                      ▼
                                                        transcript in shared state
                                                                    │
Ctrl+Enter / Enter ─ screenshot (overlay hidden) ─ Claude API (main process) ─ streamed answer
```

- `src/main` is the Electron main process: window management, global shortcuts, screenshot capture, the Claude provider, and the IPC handlers. The API key never leaves this process.
- `src/renderer` is the React UI plus the audio pipeline. Transcription runs here with WebGPU when available, WASM otherwise.
- `src/shared` holds the state schema, the IPC contract, and the provider interfaces.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | | Selects Claude |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Claude model |
| `LLM_PROVIDER` | | `openai`, `ollama` or `anthropic` |
| `LLM_BASE_URL` | OpenAI or Ollama default | `/v1` base of an OpenAI-compatible server |
| `LLM_API_KEY` | | Key for that server (Ollama needs none) |
| `LLM_MODEL` | | Model name on that server |
| `VITE_WHISPER_MODEL` | `onnx-community/whisper-base` | Any Whisper model published for transformers.js |
| `VITE_VAD_ASSETS_URL` | jsDelivr | Where the VAD worklet and ONNX files are served from |
| `VITE_ORT_WASM_URL` | jsDelivr | Where onnxruntime-web's WASM files are served from |

## Development

```bash
npm test              # unit and component tests
npm run test:coverage
npm run typecheck
npm run lint
```

The main-process logic is written as pure modules with Electron injected at the edges, so the overlay, shortcut, capture and provider behaviour is covered by fast unit tests without launching Electron.
