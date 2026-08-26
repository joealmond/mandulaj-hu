#!/usr/bin/env tsx
/** Run Quartz with bounded retries for the external font service only. */
import "./env.js"
import { spawnSync } from "node:child_process"
import { c } from "./lib.js"
import { isTransientBuildFailure } from "./build-retry.js"

const MAX_ATTEMPTS = 3
const npx = process.platform === "win32" ? "npx.cmd" : "npx"

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const result = spawnSync(npx, ["quartz", "build"], {
    encoding: "utf8",
    env: process.env,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)

  if (result.status === 0) process.exit(0)

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
  const retry = attempt < MAX_ATTEMPTS && isTransientBuildFailure(output)
  if (!retry) process.exit(result.status ?? 1)

  const waitMs = attempt * 1000
  console.warn(
    c.yellow(
      `Quartz hit a transient network error; retrying in ${waitMs / 1000}s ` +
        `(${attempt + 1}/${MAX_ATTEMPTS}).`,
    ),
  )
  await new Promise((resolve) => setTimeout(resolve, waitMs))
}
