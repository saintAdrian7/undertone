# Cluely-style UI for the copilot

Goal: the overlay should look and behave like Cluely 2.0.198's overlay, screen for screen, with our own colour palette, our own name and our own assets. Everything marked **observed** comes from reading Cluely's shipped renderer bundle (`dist/assets/control-DraBDQEm.js`, `route-DIvtSQaP.js`, `chat-CPovVDzB.js`, `chat-CQt3eiNv.js`, `index-BdVit3OX.css`, `dist-electron/main.js`; REA evidence `ev_7c100ec2…`). Everything marked **ours** is a choice for this project. No Cluely CSS, icons, fonts or images are copied; values are re-expressed in our own stylesheet.

## Non-goals and anti-goals

- No account, login, paywall, billing, onboarding or splash screens. Cluely has them; we do not need them.
- No remote renderer. Ours stays local.
- Not pixel-identical. Same structure, proportions, motion and behaviour; different accent colours, name and logo.
- Nothing from Cluely's bundle is shipped: not the Geist font files, not the logo, not the icon SVGs, not the CSS.

## Screen 1: control pill (window `/control`)

**Observed.** Window 163×50 (main.js), frameless, transparent, always on top. Body is `h-screen w-screen p-[2px]`; the pill is `main#control-window`, full size, `rounded-full`, `select-none`, with a ring drawn by `box-shadow: 0 0 0 1px rgba(207,226,255,0.24), 0 -0.5px 0 0 rgba(255,255,255,0.8)`. Layers inside, back to front:

1. A full-size transparent button ("Drag control window"): mouse-down starts a drag that sends window deltas to main; a click (movement ≤ 2 px) opens the dashboard; double-click resets the position.
2. Background `bg-[hsla(252,10%,10%,0.8)]`, `rounded-full`, brightens strongly on hover of the drag button (`peer-hover:brightness-300`, 75 ms).
3. Logo, 26×26, absolutely placed 12 px from the left, vertically centred, rendered white (`brightness-0 invert`).
4. Right-aligned button row, `gap-1.5`, `pr-[9px] pl-2`:
   - **Ask / Hide**: `h-8 w-[66px] rounded-full font-semibold text-white text-xs`, two cross-faded backgrounds (200 ms): blue gradient `linear-gradient(#0544a9,#022c70)` with ring `0 0 0 0.5px #0c44a1` and inset highlights `inset 0 -1px #022c70, inset 0 0.5px #81b6ff` when the chat is hidden; grey gradient `linear-gradient(#2e3039,#272a31)` with `inset 0 -1px #16171a, inset 0 0.5px #afb3c4` when the chat is shown. Both carry the same stacked drop shadow `0 85px 34px #00000005, 0 48px 29px #00000014, 0 21px 21px #00000021, 0 5px 12px #00000029`. Content: sparkles icon (12 px) + "Ask" when hidden; chevron-down (14 px) + "Hide" when shown (× when "hide chat hides widget" is on). While an answer streams, "Ask" gets a text shimmer. Hover: `scale-105 brightness-125`, 150 ms.
   - **Start / Stop session**: round `size-8`, grey gradient as above; mic icon (18 px) when idle, square icon (12 px) when a session runs, spinner while starting or stopping; `disabled:opacity-60`.
   - All buttons `tabIndex={-1}`; nothing in the overlay takes focus.

**Ours.** Same geometry and layering. Our pill carries one extra round button, "Auto", between Ask and Start, because automatic answers are a first-class feature here; it uses the grey gradient when off and the accent gradient when on. The invisibility and screen toggles move into the panel's "more" menu (which is where Cluely keeps "Undetectability" and "Use screen"). The Quit button leaves the pill; quitting is in the tray and the more menu. Width grows from 163 to fit the extra button (content-sized, as today). Logo: our own simple mark (see Branding).

## Screen 2: answer panel (window `/chat`)

**Observed.** Window 540 wide, 140 tall collapsed, grows to the content up to 500, anchored 6 px below the pill. `main#chat-window`: `absolute inset-[2px] overflow-hidden bg-transparent`, `rounded-2xl` collapsed and `rounded-[18px]` expanded (200 ms ease-out on inset and radius), the same 1 px light ring as the pill. Background layer: `bg-background/80` where background is the dark token `oklch(14.1% .005 285.823)` (near #18181b), so the panel is a translucent near-black sheet; the window itself has no blur. Font: Geist Variable, antialiased; everything `select-none` except message text.

Inside, a `section.group/chat-window` column (`flex h-full min-h-0 flex-col`):

- **Hide button** (expanded only): an 11×11 hit area in the top-left corner; a 28 px round grey-gradient button with a chevron that slides down 6 px and fades in when the pointer is over the panel.
- **Messages** (expanded): scroll area, `px-3 pt-0 pb-3.5`. User message: right-aligned bubble `max-w-[70%]`, `rounded-[11px] rounded-br-[4px]`, text `select-text`, background a soft blue/purple conic gradient (`#3e42be → #2cb8ff → #9b4dfa`) under a white radial sheen. Assistant message: plain markdown text (streamdown), `whitespace-pre-wrap break-words`, muted "Viewed screen" / "Viewed files" captions above it (`mb-1 text-muted-foreground text-xs`) that open a screenshot preview popover. While the answer is pending, a 2.5 px dot pulses.
- **Empty state** (expanded, no messages): a centred 34 px muted "message-circle-more" glyph and, when no session is running, a "Start Listening" pill (accent gradient, `px-4 py-2 text-xs font-semibold`) with a muted sentence under it.
- **Composer** (always): `px-2.5 pt-1.5 pb-2.5`, a textarea inside `rounded-md border-[0.5px] border-input/60`, placeholder text "Ask about your screen or conversation, or ⌘↵ for Assist" rendered at 13 px medium, muted, with the shortcut drawn as key caps (`rounded-sm border border-border/90 px-0.75 py-0.5`). Bottom-right: a 24 px round accent-gradient send button (arrow icon, 10 px); its tooltip reads "Submit using screen + audio". Next to it a 24 px transparent "more" button (ellipsis).
- **More menu**: Smart (extra reasoning) toggle, Undetectability toggle, "Hide Cluely hides widget" toggle, "avoid stealing focus" toggle, General, Keybinds.
- **Error strip**: slides up from the bottom over a red gradient, 13 px message, "Retry" and "Dismiss" pills.

**Ours.** Same column, same spacing and radii. Message list = our transcript plus answers: interviewer lines left-aligned muted, "Me" lines in the gradient bubble, the generated answer as the assistant message with a "Screenshot attached" caption instead of "Viewed screen". Composer placeholder: "Ask about your screen or conversation, or Ctrl+Enter for the next thing to say". More menu: Auto answers, Hidden from screen share, Use screen, Keep focus in my app, Resume…, Settings, Quit. Markdown rendering stays plain text (the prompt forbids markdown). The error strip replaces today's plain red paragraph.

## Screen 3: settings (window `/settings`, Cluely's `/dashboard`)

**Observed.** A normal 1100×720 window (min 800×600). `main#dashboard-window` on `bg-background`; a sidebar (`bg-muted/50`) with a search field placeholder "Search for meetings, people, and more…" and sections Overview, Modes, Settings; the content area in a `p-1` inset card. Settings pages observed: General (Open at login, Color Theme System/Light/Dark, Language, Output language), Audio Settings (Microphone Source, "Test your audio input before you hop into a call"), Keyboard shortcuts ("Click any of the keybinds to edit", "Type shortcut / click 2x to reset", per-action rows such as "Toggle visibility", "Start or stop a session", "Move the window position up"), Advanced (Hide widget when hiding, Use screen), Billing, Support, Cluely Version / Check for updates.

**Ours.** One `/settings` window, 900×620 (min 720×520), opened by clicking the pill or from the tray. Sidebar: General, Model, Profile, Audio, Shortcuts, About. Pages:

- General: theme (System/Light/Dark), open at login, automatic answers, send screenshots, hidden from screen share, keep focus in current app.
- Model: provider (Claude Code / Anthropic / OpenAI-compatible / Ollama), model, base URL, API key (stored in userData, never shown back), with a "Test" button that asks the model to say hello.
- Profile: upload / replace / remove resume, preview of the extracted text, display name.
- Audio: microphone source picker, level meter, Whisper model name.
- Shortcuts: one row per action, click to record, double-click to reset (same interaction as Cluely).
- About: name, version, licence, link to the repository.

Settings is the one place where our scope is larger than today's app (today's settings live in `.env`). It is built after the pill and panel, in its own commit series.

## Motion

**Observed.** Pill buttons: 150 ms scale/brightness on hover. Ask/Hide background cross-fade 200 ms. Panel radius/inset 200 ms ease-out. Panel content fades in 150–180 ms ease-out, error strip slides 12 px. Answer dot pulses. "Ask" label shimmers while streaming. Windows fade in from opacity 0 on first show (already implemented).

**Ours.** Same durations, implemented with CSS transitions and keyframes; no Framer Motion.

## Theme

**Observed.** Tailwind v4 tokens, dark theme on the overlay: background `oklch(14.1% .005 285.823)`, foreground `oklch(98.5% 0 0)`, muted `oklch(27.4% .006 286.033)`, muted-foreground `oklch(70.5% .015 286.067)`, border `white/10`, input `white/15`, primary (dark) `oklch(68% .15 237)` sky, radius `.625rem`. Accent gradients are hard-coded blues (`#0544a9 → #022c70`, ring `#0c44a1`, highlight `#81b6ff`), the neutral button gradient is `#2e3039 → #272a31`.

**Ours (proposal, to be confirmed).** Same neutrals (near-black glass, zinc greys). Accent family replaced with one of three candidates shown in the mockup: *Ember* (amber/orange gradient `#b45309 → #7c2d12`, highlight `#fdba74`), *Jade* (emerald `#047857 → #064e3b`, highlight `#6ee7b7`), *Violet* (`#6d28d9 → #4c1d95`, highlight `#c4b5fd`). The user-message bubble uses the matching conic gradient. Font: Inter (variable, bundled from `@fontsource-variable/inter`, OFL) rather than Geist.

## Branding

Name: chosen by the user from the shortlist in the conversation. Logo: a simple geometric mark drawn as inline SVG (two overlapping rounded speech shapes), white on the pill, accent in the settings window; app icon generated from the same SVG. Tray icon stays the runtime-rendered dot.

## Implementation notes (ours)

- Keep plain CSS with custom properties (`--accent-a`, `--accent-b`, `--accent-ring`, `--accent-hi`, `--glass`, `--fg`, `--muted`, `--muted-fg`, `--border`), one theme file; no Tailwind runtime.
- Icons: `lucide-react` (ISC): sparkles, chevron-down, x, mic, square, loader-circle, arrow-up, ellipsis, message-circle-more, rotate-cw, circle-alert, settings, file-text, eye-off, monitor.
- Window geometry constants: control 50 tall, content-sized width; chat 540 wide, 140 min, 500 max expanded (unchanged); settings 900×620.
- Pill drag stays native (`-webkit-app-region: drag`); click-vs-drag threshold 2 px as observed so a click opens settings.
- Tests: component tests for pill states (Ask/Hide swap, Auto on/off, Start/Stop, streaming shimmer class), panel states (collapsed composer only, expanded with transcript, empty state, error strip, hide button), settings pages (each control patches the right state field).
