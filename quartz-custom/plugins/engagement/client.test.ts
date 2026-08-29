/**
 * Guards on the engagement client script.
 *
 * The script is browser JS living inside a template literal, so it cannot be
 * imported and exercised directly without a DOM harness. These assert its
 * SOURCE instead, which is enough to catch the regression that actually
 * matters: rendering a stranger's comment as markup.
 *
 * A DOM-level test would be better. This is the honest 80% until then.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const SRC = fs.readFileSync(path.resolve(import.meta.dirname, "src/index.tsx"), "utf8")

test("comment name and body are rendered as text, never as markup", () => {
  // The two fields an attacker controls.
  assert.match(SRC, /who\.textContent\s*=\s*c\.name/, "author name via textContent")
  assert.match(SRC, /body\.textContent\s*=\s*c\.body/, "comment body via textContent")

  assert.ok(
    !/\.innerHTML\s*=\s*c\./.test(SRC),
    "no comment field may ever be assigned to innerHTML",
  )
})

test("the client never uses innerHTML at all", () => {
  const uses = [...SRC.matchAll(/\.innerHTML\s*=/g)]
  assert.equal(
    uses.length,
    0,
    "engagement renders only via textContent/createElement; found an innerHTML assignment",
  )
})

test("the like toggle is optimistic and reconciles", () => {
  // Reflects the click immediately...
  assert.match(SRC, /liked\s*=\s*!liked/, "optimistic flip")
  assert.match(SRC, /localStorage/, "own state persisted locally")
  // ...then trusts the server's answer.
  assert.match(SRC, /count\s*=\s*d\.count/, "server count wins after the request")
})

test("the section stays hidden when the API does not answer", () => {
  assert.match(
    SRC,
    /if \(ok\.some\(Boolean\)\) root\.hidden = false/,
    "a dead API must leave the section hidden rather than showing a broken box",
  )
})

test("Turnstile loads only on interaction, not on page load", () => {
  /*
   * The contract is that an ordinary reader — someone who never opens the
   * composer — makes zero third-party requests. So loadTurnstile() must only be
   * reachable from a user action: opening the composer, or submitting.
   *
   * It is deliberately NOT asserting a particular listener. An earlier version
   * of this test pinned a `focusin` handler that the progressive-disclosure
   * rework replaced, and failed while the behaviour was still correct.
   */
  const callSites = [...SRC.matchAll(/^[ \t]*loadTurnstile\(\);?$/gm)]
  assert.ok(callSites.length > 0, "it has to be called somewhere")

  // Every call must sit inside openComposer() or the submit handler.
  const openComposer = SRC.slice(
    SRC.indexOf("function openComposer()"),
    SRC.indexOf("toggle.addEventListener"),
  )
  const submit = SRC.slice(SRC.indexOf('form.addEventListener("submit"'))
  const guarded = callSites.filter(
    (m) => openComposer.includes(m[0].trim()) || submit.includes(m[0].trim()),
  )
  assert.equal(
    guarded.length,
    callSites.length,
    "every loadTurnstile() call must be behind a user action",
  )

  // And openComposer itself only runs from a click.
  assert.match(SRC, /toggle\.addEventListener\("click"/)
  assert.match(SRC, /firstBtn\.addEventListener\("click", openComposer\)/)
})

test("Turnstile retains and resets the exact widget after every request attempt", () => {
  assert.match(
    SRC,
    /tsWidgetId\s*=\s*window\.turnstile\.render/,
    "retain the ID returned by explicit rendering",
  )
  assert.match(
    SRC,
    /turnstile\?\.reset\(tsWidgetId\)/,
    "reset the same widget instead of relying on an implicit first widget",
  )
  assert.ok(!/turnstile\?\.reset\(\)/.test(SRC), "never use an unscoped reset")

  const finallyBlock = SRC.slice(
    SRC.lastIndexOf("} finally {"),
    SRC.lastIndexOf("btn.disabled = false"),
  )
  assert.match(finallyBlock, /tsToken\s*=\s*null/, "consume the token on every request outcome")
  assert.match(
    finallyBlock,
    /reset\(tsWidgetId\)/,
    "reset on success, rejection, and network error",
  )
})

test("Turnstile reports expiration and widget errors without retaining a token", () => {
  assert.match(SRC, /"expired-callback"\s*:\s*\(\)\s*=>\s*\{\s*tsToken\s*=\s*null/)
  assert.match(SRC, /"error-callback"\s*:\s*\(\)\s*=>\s*\{\s*tsToken\s*=\s*null/)
})

test("engagement rewires after Quartz client-side navigation", () => {
  assert.match(SRC, /document\.addEventListener\("nav", wireEngagement\)/)
  assert.match(SRC, /function wireEngagement\(\)/)
  assert.match(SRC, /if \(!root \|\| root\.dataset\.wired\) return/)
  assert.match(SRC, /wireEngagement\(\);\s*\n\s*\}\)\(\);/)
})
