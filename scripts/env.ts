/**
 * Loads `.env` into `process.env`, as a side effect of importing this module.
 *
 * The README documents `.env` as the place for `TURNSTILE_SITE_KEY`, `UMAMI_*`,
 * `WEBMENTION_*` and `VAULT_PATH`, and every script reads those through
 * `process.env` — but nothing ever read the file, so all of them were silently
 * inert. A configured `TURNSTILE_SITE_KEY` produced a build with the comment
 * form still hidden and no warning anywhere.
 *
 * Import this FIRST in any entry point that reads the environment. It must run
 * before module-level `process.env` reads such as the one in publish.config.ts,
 * and ES modules evaluate imports in source order, so position matters.
 *
 * Two properties worth keeping:
 *
 *  - A real environment variable always wins over the file. `loadEnvFile` skips
 *    keys that are already set, so CI and one-off `FOO=bar npm run …` overrides
 *    stay authoritative and a stale local `.env` cannot silently clobber them.
 *  - A missing `.env` is not an error. A clean checkout has none, and the build
 *    is supposed to succeed there with every optional feature simply off.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** Repo root, derived from this file rather than cwd, so `tsx scripts/x.ts`
 *  finds the same `.env` no matter where it is invoked from. */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export const envFile = path.join(repoRoot, ".env")

/** True when a `.env` was found and applied — exported for diagnostics. */
export const envFileLoaded = ((): boolean => {
  if (!fs.existsSync(envFile)) return false
  try {
    process.loadEnvFile(envFile)
    return true
  } catch (err) {
    // A malformed .env must not take the build down: every value in it is
    // optional by design. Say so loudly instead, because the symptom otherwise
    // is a feature that stays mysteriously off.
    console.warn(`⚠ could not read ${path.relative(repoRoot, envFile)}: ${(err as Error).message}`)
    return false
  }
})()
