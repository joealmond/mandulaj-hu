#!/usr/bin/env bash
#
# Publish wrapper for the Obsidian "Shell commands" plugin.
#
# Obsidian runs shell commands with a minimal environment and an arbitrary
# working directory, so this resolves both explicitly and puts a Node on PATH.
# Bind it to a ribbon button or a hotkey — see README.
#
# Exits non-zero with a readable message if anything fails, so the Shell
# commands plugin surfaces it as an error notice instead of failing silently.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# Obsidian's PATH usually lacks Homebrew and any version manager.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
fi

if ! command -v node >/dev/null 2>&1; then
  echo "✗ node not found on PATH. Set the interpreter path in the Shell commands plugin." >&2
  exit 1
fi

# Load .env if present so Umami / webmention credentials are available.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

exec npm run publish
