# Security policy

Undertone listens to your microphone and system audio, takes screenshots and sends text to a model you configure. That makes some bugs more serious than others.

## Reporting

Please use GitHub's private vulnerability reporting on this repository ("Report a vulnerability" under the Security tab) rather than a public issue for anything that could:

- expose audio, transcripts, screenshots, resume text or API keys to anyone other than the configured model;
- let a renderer, a transcript, a screenshot or a model response run code, reach IPC channels it should not, or change settings the user did not ask for;
- let the packaged app load code from outside its bundle.

Say what you found, how to reproduce it and which version or commit you tested. You will get an acknowledgement within a few days.

## Scope notes

- The renderer runs sandboxed with context isolation; the preload exposes an allowlist of typed IPC channels and the main process validates every payload with schemas.
- API keys live only in the main process. A key saved in Settings is stored in the user-data folder encrypted with Electron's `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret on Linux; on a Linux desktop without a key store it falls back to plain text and logs a warning). The interface only ever learns whether a key is set, and a stored key is reused only for the same provider and server it was saved for. Base URLs must be https unless they point at localhost.
- The resume text (`profile.json`) is stored in plain text in the user-data folder, which the operating system restricts to your user account.
- The Claude Code CLI is started without a shell, with tools, MCP servers, skills and user settings disabled, in an empty working directory of the app's own; the session is refused if the CLI reports any tool at start-up.
- The packaged build flips Electron's fuses so it cannot run as Node, cannot be attached with `--inspect`, and loads code only from its asar.

Reports about the behaviour of third-party models are out of scope.
