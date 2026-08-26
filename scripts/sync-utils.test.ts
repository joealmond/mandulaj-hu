import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  attachmentName,
  claimAttachment,
  publicFrontmatter,
  replaceArtifacts,
  stableGeneratedAt,
} from "./sync-utils.ts"

test("attachment names are stable and unique for duplicate basenames", () => {
  const vault = path.join(os.tmpdir(), "vault")
  const first = attachmentName(path.join(vault, "one", "diagram.png"), vault)
  const second = attachmentName(path.join(vault, "two", "diagram.png"), vault)

  assert.notEqual(first, second)
  assert.equal(first, attachmentName(path.join(vault, "one", "diagram.png"), vault))
  assert.match(first, /^diagram-[a-f0-9]{16}\.png$/)
})

test("an attachment destination can never replace a different source", () => {
  const claimed = new Map<string, string>()
  assert.equal(claimAttachment(claimed, "diagram-hash.png", "/vault/one/diagram.png"), true)
  assert.equal(claimAttachment(claimed, "diagram-hash.png", "/vault/two/diagram.png"), false)
  assert.equal(claimed.get("diagram-hash.png"), "/vault/one/diagram.png")
})

test("public frontmatter drops every property that was not explicitly allowed", () => {
  const output = publicFrontmatter(
    {
      description: "Public summary",
      type: "project",
      year: 2026,
      stack: ["TypeScript", "Cloudflare"],
      link: "https://example.com/public",
      client: "Private client",
      privateUrl: "https://internal.example",
      status: "confidential",
    },
    ["description", "type", "year", "stack", "link"],
  )

  assert.deepEqual(output, {
    description: "Public summary",
    type: "project",
    year: 2026,
    stack: ["TypeScript", "Cloudflare"],
    link: "https://example.com/public",
  })
})

test("manifest timestamp changes only when the public payload changes", () => {
  const payload = { notes: [{ slug: "public-note" }], attachments: [] }
  const previous = { generatedAt: "2026-08-24T10:00:00.000Z", ...payload }

  assert.equal(
    stableGeneratedAt(previous, payload, "2026-08-25T10:00:00.000Z"),
    "2026-08-24T10:00:00.000Z",
  )
  assert.equal(
    stableGeneratedAt(previous, { ...payload, attachments: ["image.png"] }, "now"),
    "now",
  )
})

test("artifact promotion restores every live artifact when a rename fails", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "myblog-sync-test-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))

  const liveDir = path.join(root, "content")
  const stagedDir = path.join(root, "staged-content")
  const liveManifest = path.join(root, "manifest.json")
  const missingManifest = path.join(root, "missing-manifest.json")
  await fs.mkdir(liveDir)
  await fs.mkdir(stagedDir)
  await fs.writeFile(path.join(liveDir, "note.md"), "old")
  await fs.writeFile(path.join(stagedDir, "note.md"), "new")
  await fs.writeFile(liveManifest, "old manifest")

  await assert.rejects(
    replaceArtifacts([
      { staged: stagedDir, live: liveDir },
      { staged: missingManifest, live: liveManifest },
    ]),
  )

  assert.equal(await fs.readFile(path.join(liveDir, "note.md"), "utf8"), "old")
  assert.equal(await fs.readFile(liveManifest, "utf8"), "old manifest")
})

test("artifact promotion swaps all staged artifacts", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "myblog-sync-test-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))

  const live = path.join(root, "live.txt")
  const staged = path.join(root, "staged.txt")
  await fs.writeFile(live, "old")
  await fs.writeFile(staged, "new")

  await replaceArtifacts([{ staged, live }])

  assert.equal(await fs.readFile(live, "utf8"), "new")
  await assert.rejects(fs.access(staged))
})
