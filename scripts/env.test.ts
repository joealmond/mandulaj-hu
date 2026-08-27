import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * Runs the REAL env.ts inside a throwaway repo root.
 *
 * env.ts resolves `.env` from its own location rather than cwd, so a copy at
 * `<root>/scripts/env.ts` reads `<root>/.env`. It imports only node builtins,
 * so the copy behaves identically to the original.
 */
function runWithEnvFile(
  envFileContents: string | null,
  read: string[],
  extraEnv: Record<string, string> = {},
): { loaded: boolean; values: Record<string, string | undefined> } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "env-test-"))
  try {
    fs.mkdirSync(path.join(root, "scripts"))
    fs.copyFileSync(path.join(here, "env.ts"), path.join(root, "scripts", "env.ts"))
    if (envFileContents !== null) fs.writeFileSync(path.join(root, ".env"), envFileContents)

    const probe = path.join(root, "scripts", "probe.ts")
    fs.writeFileSync(
      probe,
      `import { envFileLoaded } from "./env.js"\n` +
        `const keys = ${JSON.stringify(read)}\n` +
        `const values = Object.fromEntries(keys.map((k) => [k, process.env[k]]))\n` +
        `console.log(JSON.stringify({ loaded: envFileLoaded, values }))\n`,
    )

    const res = spawnSync("npx", ["tsx", probe], {
      encoding: "utf8",
      env: { ...process.env, ...extraEnv },
    })
    assert.equal(res.status, 0, `probe failed:\n${res.stdout}\n${res.stderr}`)
    return JSON.parse(res.stdout.trim().split("\n").at(-1)!)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test("env: values in .env reach process.env", () => {
  const { loaded, values } = runWithEnvFile("TURNSTILE_SITE_KEY=from_file\n", [
    "TURNSTILE_SITE_KEY",
  ])
  assert.equal(loaded, true)
  assert.equal(values.TURNSTILE_SITE_KEY, "from_file")
})

test("env: a real environment variable wins over .env", () => {
  // CI sets real variables; a stale local .env must never clobber them.
  const { values } = runWithEnvFile("TURNSTILE_SITE_KEY=from_file\n", ["TURNSTILE_SITE_KEY"], {
    TURNSTILE_SITE_KEY: "from_shell",
  })
  assert.equal(values.TURNSTILE_SITE_KEY, "from_shell")
})

test("env: a missing .env is not an error", () => {
  // A clean checkout has no .env and must still build, features simply off.
  const { loaded, values } = runWithEnvFile(null, ["TURNSTILE_SITE_KEY"])
  assert.equal(loaded, false)
  assert.equal(values.TURNSTILE_SITE_KEY, undefined)
})

test("env: every script reading process.env imports ./env.js first", () => {
  // The original bug: postbuild.ts read process.env.TURNSTILE_SITE_KEY while
  // nothing loaded .env, so a configured key produced a build with the comment
  // form still hidden and no warning. This catches the next such script.
  const exempt = new Set(["env.ts"])
  const offenders: string[] = []

  for (const name of fs.readdirSync(here)) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts") || exempt.has(name)) continue
    const src = fs.readFileSync(path.join(here, name), "utf8")
    // Only variables actually configured through .env matter here; PATH and
    // friends are read straight from the real environment.
    if (!/process\.env\.(UMAMI_|WEBMENTION_|TURNSTILE_|VAULT_PATH|CONTENT_DIR)/.test(src)) continue

    const imports = src.split("\n").filter((l) => /^import\b/.test(l))
    if (imports[0] !== 'import "./env.js"') offenders.push(name)
  }

  assert.deepEqual(
    offenders,
    [],
    `these read .env-configured variables but do not import "./env.js" first: ${offenders.join(", ")}`,
  )
})

test("turnstile: an API token in TURNSTILE_SITE_KEY fails the build", async () => {
  // A cfut_ Cloudflare API token was once pasted here and published as a meta
  // tag on every page. Unset stays supported; a real site key still passes.
  const { assertTurnstileSiteKey } = await import("./postbuild.js")

  assert.doesNotThrow(() => assertTurnstileSiteKey(""))
  assert.doesNotThrow(() => assertTurnstileSiteKey("1x00000000000000000000AA"))
  assert.doesNotThrow(() => assertTurnstileSiteKey("0x4AAAAAAABkMYinukE8nzYS"))

  for (const bad of [
    "cfut_example-invalid-token", // Cloudflare API token
    "v1.0-abcdef0123456789abcdef0123456789", // Cloudflare global-key style
    "not-a-key",
  ]) {
    assert.throws(
      () => assertTurnstileSiteKey(bad),
      /does not look like a Turnstile site key/,
      `expected ${bad.slice(0, 8)}… to be rejected`,
    )
  }
})

test("postbuild: importing the module does not run the build", () => {
  // An import used to execute postbuild immediately. That failed in a clean CI
  // checkout because `public/` does not exist until after Quartz builds it.
  // An invalid key makes this probe fail before any files are touched if the
  // direct-execution guard is ever removed.
  const probe = spawnSync("npx", ["tsx", "--eval", 'import("./scripts/postbuild.ts")'], {
    cwd: path.resolve(here, ".."),
    encoding: "utf8",
    env: { ...process.env, TURNSTILE_SITE_KEY: "not-a-key" },
  })

  assert.equal(probe.status, 0, `import ran postbuild:\n${probe.stdout}\n${probe.stderr}`)
})
