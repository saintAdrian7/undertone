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
- API keys live only in the main process and the user-data folder; the interface only ever learns whether a key is set.
- The packaged build flips Electron's fuses so it cannot run as Node, cannot be attached with `--inspect`, and loads code only from its asar.

Reports about the behaviour of third-party models are out of scope.
