/**
 * Guards on the API's input validation. These are pure functions, so they can
 * be tested without a Worker runtime or a database.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { isValidSlug } from "./lib.ts"

test("slug validation rejects traversal and junk", () => {
  for (const ok of ["algorithms", "a", "a-b-c", "note-2026"]) {
    assert.equal(isValidSlug(ok), true, ok)
  }
  for (const bad of [
    "../../etc/passwd",
    "/absolute",
    "Has Spaces",
    "UPPER",
    "-leading-dash",
    "trailing/slash",
    "",
    "x".repeat(200),
    null,
    42,
    {},
  ]) {
    assert.equal(isValidSlug(bad as never), false, JSON.stringify(bad))
  }
})
