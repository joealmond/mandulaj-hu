# Legacy `api/` directory

API routes live in `worker/` and are served by the same Cloudflare Worker that
serves the site: `/api/*` invokes the script and everything else is a static
asset. See [`worker/index.ts`](../../worker/index.ts) and
[`wrangler.jsonc`](../../wrangler.jsonc).

The former top-level `api/` directory contained only this note and was removed
during the documentation reorganization.
