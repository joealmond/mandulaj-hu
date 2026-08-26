import { test } from "node:test"
import assert from "node:assert/strict"
import { isTransientBuildFailure } from "./build-retry.ts"

test("only transient network failures are retried", () => {
  assert.equal(isTransientBuildFailure("TypeError: fetch failed for fonts.googleapis.com"), true)
  assert.equal(isTransientBuildFailure("connect ETIMEDOUT 142.250.0.1"), true)
  assert.equal(isTransientBuildFailure("Invalid Quartz configuration: baseUrl is missing"), false)
  assert.equal(isTransientBuildFailure("Markdown parse error in content/note.md"), false)
})
