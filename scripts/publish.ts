#!/usr/bin/env tsx
/**
 * One-command publish: sync → verify → build → deploy → commit.
 *
 * On a Git-capable desktop this deploys straight to Cloudflare with wrangler.
 * Other devices push the private vault repo and use deploy/vault-publish.yml;
 * both paths run the same sync and audit boundary.
 *
 * Git is no longer the deploy trigger. It is version history and rollback, and
 * the commit happens AFTER a successful deploy so the repo never records a
 * publish that did not actually ship.
 *
 * Ordering matters. Every gate runs BEFORE anything leaves the machine: a
 * failed audit stops the run with nothing deployed and nothing committed.
 */
import { execFileSync } from "node:child_process"
import path from "node:path"
import { c } from "./lib.js"
import {
  hasPublishChanges,
  parsePublishPlan,
  PUBLISH_PATHS,
  publishSummary,
  type PublishPlan,
} from "./publish-plan.js"

const REPO = path.resolve(import.meta.dirname, "..")
const DRY = process.argv.includes("--dry")

function run(cmd: string, args: string[], opts: { quiet?: boolean } = {}) {
  return execFileSync(cmd, args, {
    cwd: REPO,
    stdio: opts.quiet ? "pipe" : "inherit",
    encoding: "utf8",
  })
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim()
}

function step(n: number, total: number, label: string) {
  console.log(c.bold(`\n[${n}/${total}] ${label}`))
}

const TOTAL = 5
const SKIP_GIT = process.argv.includes("--no-commit")
let deployed = false

function printPlan(plan: PublishPlan) {
  const groups: [string, string[]][] = [
    ["publish", plan.added],
    ["update", plan.changed],
    ["remove", plan.removed],
    ["generated", plan.generated],
  ]
  for (const [label, entries] of groups) {
    if (entries.length) console.log(`  ${label.padEnd(9)} ${entries.join(", ")}`)
  }
  if (!hasPublishChanges(plan)) console.log(c.dim("  no generated publishing changes"))
}

try {
  // 1 ─ Pull the vault's published notes into content/
  step(1, TOTAL, "Sync from vault")
  run("npx", ["tsx", "scripts/sync.ts"])

  // 2 ─ Build. This runs both audits internally; a leak aborts here.
  step(2, TOTAL, "Build and verify")
  run("npm", ["run", "build"])

  // 3 ─ Show exactly what the private/public boundary produced.
  step(3, TOTAL, "Review publish plan")
  const status = git("status", "--porcelain", "--untracked-files=all", "--", ...PUBLISH_PATHS)
  const plan = parsePublishPlan(status)
  printPlan(plan)

  if (DRY) {
    console.log(c.yellow("\n--dry: stopping before deploy and commit."))
    process.exit(0)
  }

  // 4 ─ Ship it. Static assets are uploaded and swapped atomically.
  step(4, TOTAL, "Deploy to Cloudflare")
  run("npx", ["wrangler", "deploy"])
  deployed = true

  // 5 ─ Record only generated publish artifacts, never nearby source work.
  step(5, TOTAL, "Record publish")
  if (SKIP_GIT || !hasPublishChanges(plan)) {
    console.log(
      c.dim(
        SKIP_GIT
          ? "  --no-commit: skipping git."
          : "  no generated changes to commit — deployed current site code.",
      ),
    )
  } else {
    git("add", "--", ...PUBLISH_PATHS)
    const summary = publishSummary(plan)
    git("commit", "-m", summary, "--", ...PUBLISH_PATHS)
    console.log(c.dim(`  ${summary}`))

    // Push is best-effort: the site is already live, so a git failure here is
    // an inconvenience, not a failed publish.
    try {
      const branch = git("rev-parse", "--abbrev-ref", "HEAD")
      run("git", ["push", "origin", branch], { quiet: true })
      console.log(c.dim("  pushed"))
    } catch {
      console.log(c.yellow("  push failed — site is live, commit is local only"))
    }
  }

  console.log(c.green(c.bold("\n✓ Published and live.\n")))

  // Courtesy, after the fact. Never gates the publish.
  run("npx", ["tsx", "scripts/webmention-send.ts"])
} catch (err) {
  console.error(c.red(c.bold(`\n✗ Publish aborted: ${(err as Error).message}`)))
  console.error(
    deployed
      ? c.yellow("  The deployment completed, but its local Git record did not.")
      : c.dim("  Nothing was deployed or pushed."),
  )
  process.exit(1)
}
