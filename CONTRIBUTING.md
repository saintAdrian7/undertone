# Contributing to Undertone

Thanks for helping. Bug reports, small fixes and bigger features are all welcome. This page says how the project works so your change lands smoothly.

## Before you start

- Look through the open issues. Ones labelled `good first issue` are scoped to be finished in an evening; `help wanted` ones are bigger but well defined.
- For anything beyond a small fix, open an issue first (or comment on the existing one) and say what you plan to do. It avoids two people building the same thing and lets us agree on the approach before you spend time on it.

## Setting up

Requirements: Node.js 22+, and Windows 10/11 if you want to test system-audio capture (the overlay itself also runs on macOS).

```bash
git clone https://github.com/saintAdrian7/undertone.git
cd undertone
npm install
npm run dev
```

Pick a model in Settings or in `.env` (see the README). The Claude Code CLI provider needs no key if you are signed in; Ollama is the easiest way to work fully offline.

## How the code is laid out

- `src/main`: the Electron main process. Windows, global shortcuts, screenshot capture, model providers, the answer service and auto-answer scheduler, IPC handlers. Keys never leave this process.
- `src/renderer`: the React UI (control pill, answer panel, settings window) and the audio pipeline (voice detection, local Whisper transcription).
- `src/shared`: the state schema, the IPC contract, provider interfaces, brand constants.
- `docs/superpowers/specs`: design notes, including the UI spec the overlay follows.

Main-process logic is written as pure modules with Electron injected at the edges, so almost everything is covered by fast tests that never launch Electron.

## Making a change

1. Create a branch from `main`.
2. Write a failing test first, then make it pass. That is how every feature in the repo landed, and it keeps the suite meaningful. Component tests use Testing Library; main-process tests inject fakes for Electron, the file system and child processes.
3. Keep the checks green:

   ```bash
   npm test
   npm run typecheck
   npm run lint
   ```

4. Open a pull request. The template asks what changed, why, and how you tested it in the running app.

## What happens on a pull request

Three things run automatically, then a maintainer reads the result and approves or asks for changes by hand:

- **PR checks** runs typecheck, lint and the tests with coverage. Lint findings show up as inline annotations in the Files tab, and a summary comment (or, for pull requests from forks, the job summary in the Checks tab) lists the results.
- **CI** runs the same checks on Windows and Ubuntu plus `npm audit`.
- **Claude review** reads the diff and leaves inline comments with findings and a summary. It never runs your code and cannot approve; treat its comments as a first pass, not a verdict. Maintainers: this job needs the `ANTHROPIC_API_KEY` repository secret (`gh secret set ANTHROPIC_API_KEY`).

Merging into `main` requires the checks to pass and one approving review from a maintainer. Keep your branch rebased on `main`; a pull request that includes commits already on `main` cannot be merged.

Style: TypeScript strict, no `any`, small pure functions, comments only where the code cannot say it. `npm run lint` tells you if something is off.

## What makes a good pull request

- One change per PR. A refactor and a feature are two PRs.
- Tests for the behaviour you add or fix.
- No new runtime dependencies without a sentence on why in the PR; the app deliberately bundles everything it needs and fetches nothing at runtime except the Whisper model.
- Nothing from other products' bundles. The UI follows Cluely's layout, but every line of CSS, every icon and every asset here is ours (Lucide icons and the Inter font are the only third-party visual assets, both under permissive licences). Please keep it that way.

## Security and privacy

If you find a way for a renderer, a transcript, a screenshot or a model response to do something the user did not ask for, report it privately as described in [SECURITY.md](SECURITY.md) rather than in a public issue.

## Code of conduct

Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).
