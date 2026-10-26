#!/usr/bin/env bash
# Undertone: first-time setup.
# Works in Git Bash on Windows and in bash on macOS and Linux.
# Usage: ./setup.sh
set -euo pipefail

cd "$(dirname "$0")"

echo "=== Undertone setup ==="

# Check prerequisites with clear messages.
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js 22 or newer is required. Install it from https://nodejs.org/ and run ./setup.sh again." >&2
  exit 1
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 22 ]; then
  echo "Error: Node.js 22 or newer is required, but $(node -v) is installed." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm was not found. It normally comes with Node.js." >&2
  exit 1
fi

# Configuration: .env is git-ignored, so your keys stay local.
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
else
  echo ".env already exists; leaving it unchanged"
fi

# Dependencies (Electron is downloaded here, so the first run can take a few minutes).
echo "Installing dependencies (npm install)..."
npm install

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. Choose a model. Either open Settings > Model in the app, or edit .env:"
echo "     ANTHROPIC_API_KEY, or LLM_PROVIDER / LLM_MODEL / LLM_BASE_URL / LLM_API_KEY"
echo "  2. Start the app: npm run dev"
echo "  3. Run the tests: npm test"
echo "  4. Using Claude Code? CLAUDE.md has the commands and architecture."
