/**
 * Local development loop.
 *
 * Starts Quartz's dev server and watches the VAULT, re-syncing whenever a note
 * changes. Quartz already watches `content/`, so a sync makes the browser
 * reload — edit in Obsidian, see it immediately.
 *
 * This is the missing half of `npm run dev`: Quartz watches content/, but
 * nothing was watching the thing that *produces* content/.
 *
 * Not included: OG cards, font conversion, the Pagefind index, and the API.
 * That keeps the loop fast. Use `npm run preview` when you need those.
 */
import { spawn, execFileSync } from "node:child_process"
import { watch } from "node:fs"
import path from "node:path"
import process from "node:process"
import config from "./publish.config.js"

const REPO = path.resolve(import.meta.dirname, "..")
const run = (cmd: string, args: string[]) =>
  execFileSync(cmd, args, { cwd: REPO, stdio: "inherit", encoding: "utf8" })

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`

// Local plugin sources are compiled to dist/ and Quartz imports the built file,
// so a component edit is invisible until they are rebuilt.
console.log(dim("→ building local plugins"))
run("node", ["scripts/build-plugins.mjs"])

console.log(dim("→ initial sync from vault"))
try {
  run("npx", ["tsx", "scripts/sync.ts"])
} catch {
  console.log(yellow("  sync failed — starting the server anyway"))
}

const vault = path.resolve(config.vaultPath)

const server = spawn("npx", ["quartz", "build", "--serve"], {
  cwd: REPO,
  stdio: "inherit",
})

let timer: NodeJS.Timeout | null = null
let syncing = false

function resync(reason: string) {
  if (timer) clearTimeout(timer)
  // Obsidian writes a file several times in quick succession; one sync per
  // burst is enough.
  timer = setTimeout(() => {
    if (syncing) return
    syncing = true
    console.log(dim(`\n→ ${reason} — syncing`))
    try {
      run("npx", ["tsx", "scripts/sync.ts"])
      console.log(green("✓ synced; the browser should reload"))
    } catch {
      console.log(yellow("✗ sync failed — fix the note and save again"))
    } finally {
      syncing = false
    }
  }, 400)
}

try {
  watch(vault, { recursive: true }, (_event, filename: string | Buffer | null) => {
    filename = typeof filename === "string" ? filename : (filename?.toString() ?? null)
    if (!filename || !filename.endsWith(".md")) return
    if (filename.includes(".obsidian") || filename.includes(".trash")) return
    resync(path.basename(filename))
  })
  console.log(green(`\n✓ watching ${vault} for note changes`))
  console.log(dim("  edit a note in Obsidian and the site reloads\n"))
} catch (err) {
  console.log(yellow(`\n⚠ could not watch the vault: ${(err as Error).message}`))
  console.log(dim("  run `npm run sync` by hand after editing a note\n"))
}

const stop = () => {
  server.kill()
  process.exit(0)
}
process.on("SIGINT", stop)
process.on("SIGTERM", stop)
server.on("exit", (code) => process.exit(code ?? 0))
