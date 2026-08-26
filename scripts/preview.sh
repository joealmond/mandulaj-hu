#!/usr/bin/env bash
#
# Full-stack local preview: the real Worker serving the real site, with likes
# and comments backed by a local D1.
#
# `npm run dev` is Quartz's own server — fast for theme work, but it has no
# /api, so the likes and comments section stays hidden there. This is the one
# that shows the whole thing.
#
# Data lives in .wrangler/state (gitignored) and is local-only. Nothing here
# touches your Cloudflare account or the production database.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PORT="${PORT:-8799}"

# Cloudflare's documented ALWAYS-PASS Turnstile test keys. Local use only —
# the real keys live in .env and in `wrangler secret`. Without a site key the
# comment form hides itself, which would defeat the point of a preview.
export TURNSTILE_SITE_KEY="${TURNSTILE_SITE_KEY:-1x00000000000000000000AA}"

echo "→ applying local D1 migrations"
npx wrangler d1 migrations apply mandulaj --local >/dev/null 2>&1 || true

# Sync first: the whole point of a local preview is to see what is in the vault
# right now. `npm run build` alone only rebuilds whatever content/ already held.
echo "→ syncing from vault"
npm run sync

echo "→ building"
npm run build

# Build must finish BEFORE wrangler starts: `build` wipes public/, and a
# watching wrangler will serve 500s if the asset directory vanishes underneath
# it.
echo
echo "→ http://localhost:${PORT}"
echo "  likes and comments are live against a LOCAL database"
echo "  Turnstile is in test mode and always passes"
echo
exec npx wrangler dev --local --port "$PORT"
