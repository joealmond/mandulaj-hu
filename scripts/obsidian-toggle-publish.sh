#!/usr/bin/env bash
#
# Wrapper for the Obsidian "Shell commands" plugin.
#
# Obsidian runs commands with a minimal environment, so PATH is resolved here
# the same way scripts/publish-from-obsidian.sh does.
#
# Configure the command as:
#   /path/to/myblog/scripts/obsidian-toggle-publish.sh "{{file_path:absolute}}"
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true; fi

if ! command -v node >/dev/null 2>&1; then
  echo "✗ node not found on PATH. Set the interpreter in the Shell commands plugin." >&2
  exit 1
fi

exec npx tsx scripts/toggle-publish.ts "$@"
