/**
 * End-to-end test of the publish boundary against a throwaway vault.
 *
 * The unit tests cover the individual rules; this proves they compose — that a
 * real sync over a real directory copies only what it should. It is the closest
 * thing to a regression test for "a private note cannot reach the site".
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const REPO = path.resolve(import.meta.dirname, "..")

function buildVault(root: string) {
  const w = (rel: string, body: string) => {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, body, "utf8")
  }

  w(
    "Public/Published note.md",
    `---
publish: true
client: ACME Confidential
secret: do-not-ship
---

#topic

Body text that is long enough to generate a description from.

Links: [[Private note]] and [[Published sibling]].
![[shot.png]]

### Links:
[[Journal/2026-08-27|2026-08-27]]
[[Published sibling]]

202608271230
`,
  )
  w("Public/Published sibling.md", "---\npublish: true\n---\n\nSibling body.\n")
  w("Private/Private note.md", "This note has no publish flag at all.\n")
  w("Private/Also private.md", "---\npublish: false\n---\n\nExplicitly not published.\n")
  w("Private/Drafted.md", "---\npublish: true\ndraft: true\n---\n\nPulled back.\n")

  // Two DIFFERENT images sharing a basename: only the referenced one ships.
  fs.mkdirSync(path.join(root, "Public/img"), { recursive: true })
  fs.mkdirSync(path.join(root, "Private/img"), { recursive: true })
  fs.writeFileSync(path.join(root, "Public/img/shot.png"), "PUBLIC-IMAGE")
  fs.writeFileSync(path.join(root, "Private/img/shot.png"), "PRIVATE-IMAGE")
}

test("sync publishes only flagged notes, and nothing else leaks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-boundary-"))
  const vault = path.join(root, "vault")
  const artifacts = path.join(root, "artifacts")
  const out = path.join(artifacts, "content")

  try {
    buildVault(vault)
    execFileSync("npx", ["tsx", "scripts/sync.ts"], {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, VAULT_PATH: vault, PUBLISH_ARTIFACT_ROOT: artifacts },
    })

    const files = fs
      .readdirSync(out)
      .filter((f) => f.endsWith(".md"))
      .sort()

    // Only the two flagged notes, plus repo-owned pages.
    assert.ok(files.includes("published-note.md"), "flagged note published")
    assert.ok(files.includes("published-sibling.md"), "flagged sibling published")
    for (const leaked of ["private-note.md", "also-private.md", "drafted.md"]) {
      assert.ok(!files.includes(leaked), `${leaked} must NOT be published`)
    }

    const note = fs.readFileSync(path.join(out, "published-note.md"), "utf8")

    // Private frontmatter never crosses the boundary.
    assert.ok(!note.includes("ACME Confidential"), "private property stripped")
    assert.ok(!note.includes("do-not-ship"), "private property stripped")

    // A link to an unpublished note keeps its text but loses its link.
    assert.ok(!/\[\[Private note\]\]/.test(note), "unpublished link not left as a wikilink")
    assert.ok(note.includes("Private note"), "its text is preserved")

    // A link to a published note becomes a real slug link.
    assert.match(note, /\[\[published-sibling\|/, "published link rewritten to its slug")

    // Template-only Obsidian navigation and the Zettel ID are not article prose.
    assert.doesNotMatch(note, /^### Links:$/m, "Obsidian Links footer stripped")
    assert.ok(!note.includes("202608271230"), "Obsidian note ID stripped")

    // Only the referenced image ships, and it is the PUBLIC one.
    const attachDir = path.join(out, "attachments")
    const shipped = fs.readdirSync(attachDir)
    assert.equal(shipped.length, 1, "exactly one attachment traced")
    assert.equal(
      fs.readFileSync(path.join(attachDir, shipped[0]), "utf8"),
      "PUBLIC-IMAGE",
      "the private image of the same name must never be the one copied",
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
