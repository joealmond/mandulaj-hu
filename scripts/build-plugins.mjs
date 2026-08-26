/**
 * Rebuilds every local plugin under quartz-custom/plugins/.
 *
 * `quartz plugin install` only builds a local plugin the first time it is
 * linked, so editing a component's source would otherwise leave the old dist/
 * in place and the change would silently not appear. This runs on every build.
 */
import { readdirSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
const DIR = path.join(ROOT, "quartz-custom", "plugins")

if (!existsSync(DIR)) process.exit(0)

for (const name of readdirSync(DIR)) {
  const dir = path.join(DIR, name)
  if (!existsSync(path.join(dir, "package.json"))) continue
  if (!existsSync(path.join(dir, "node_modules"))) {
    execFileSync("npm", ["install", "--no-audit", "--no-fund", "--silent"], {
      cwd: dir,
      stdio: "inherit",
    })
  }
  execFileSync("npm", ["run", "build", "--silent"], { cwd: dir, stdio: "inherit" })
}
