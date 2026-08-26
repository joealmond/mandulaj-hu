import { test } from "node:test"
import assert from "node:assert/strict"
import { hasPublishChanges, parsePublishPlan, publishSummary } from "./publish-plan.ts"

test("publish plan separates note additions, changes, removals, and generated data", () => {
  const plan = parsePublishPlan(
    [
      "?? content/new-note.md",
      " M content/changed-note.md",
      "D  content/old-note.md",
      " M .publish-manifest.json",
      " M quartz-custom/theme/_accents.generated.scss",
    ].join("\n"),
  )

  assert.deepEqual(plan, {
    added: ["new-note"],
    changed: ["changed-note"],
    removed: ["old-note"],
    generated: [".publish-manifest.json", "quartz-custom/theme/_accents.generated.scss"],
  })
  assert.equal(hasPublishChanges(plan), true)
  assert.equal(publishSummary(plan), "publish: new-note, changed-note, old-note")
})

test("empty publish plan is explicit", () => {
  const plan = parsePublishPlan("")
  assert.equal(hasPublishChanges(plan), false)
  assert.equal(publishSummary(plan), "publish: update generated site data")
})
