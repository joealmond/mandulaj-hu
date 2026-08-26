# Not used

API routes live in `worker/` and are served by the same Cloudflare Worker that
serves the site — `/api/*` invokes the script, everything else is served as a
static asset. See `worker/index.ts` and `wrangler.jsonc`.

This directory is kept only so old links to it don't 404 in your notes. It can
be deleted.
