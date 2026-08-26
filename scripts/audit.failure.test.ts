/**
 * Proves the audit BLOCKS rather than warns, entirely inside throwaway output.
 * Tests must never poison or resync the checked-in content/ and manifest.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const REPO = path.resolve(import.meta.dirname, "..")

function fixture(raw: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "publish-audit-"))
  const content = path.join(root, "content")
  fs.mkdirSync(content, { recursive: true })
  fs.writeFileSync(path.join(content, "probe.md"), raw, "utf8")
  fs.writeFileSync(
    path.join(root, ".publish-manifest.json"),
    JSON.stringify({
      generatedAt: "2026-08-25T00:00:00.000Z",
      notes: [
        {
          slug: "probe",
          title: "Probe",
          sha256: createHash("sha256").update(raw).digest("hex").slice(0, 16),
          attachments: [],
        },
      ],
      attachments: [],
    }),
  )
  return { root, content }
}

function runAudit(root: string): { code: number; out: string } {
  try {
    const out = execFileSync("npx", ["tsx", "scripts/audit.ts", "content"], {
      cwd: REPO,
      encoding: "utf8",
      stdio: "pipe",
      env: {
        ...process.env,
        PUBLISH_ARTIFACT_ROOT: root,
        VAULT_PATH: path.join(root, "vault-not-present"),
      },
    })
    return { code: 0, out }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }
  }
}

test("a note without publish: true in content/ fails the audit", (t) => {
  const { root } = fixture("---\ntitle: Probe\n---\n\nbody\n")
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const { code, out } = runAudit(root)
  assert.notEqual(code, 0, "audit must exit non-zero")
  assert.match(out, /does NOT carry/i)
})

test("an untraced attachment fails the audit", (t) => {
  const { root, content } = fixture("---\npublish: true\ntitle: Probe\n---\n\nbody\n")
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const dir = path.join(content, "attachments")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "untraced.png"), "not referenced")

  const { code, out } = runAudit(root)
  assert.notEqual(code, 0, "audit must exit non-zero")
  assert.match(out, /[Uu]ntraced attachment/)
})

test("non-public frontmatter fails the audit", (t) => {
  const { root } = fixture(
    "---\npublish: true\ntitle: Probe\nclient: ACME Confidential\n---\n\nbody\n",
  )
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const { code, out } = runAudit(root)
  assert.notEqual(code, 0, "audit must exit non-zero")
  assert.match(out, /non-public frontmatter/)
})

test("an unpoisoned content/ passes", (t) => {
  const { root } = fixture("---\npublish: true\ntitle: Probe\nslug: probe\n---\n\nbody\n")
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const { code } = runAudit(root)
  assert.equal(code, 0, "a clean content/ must pass")
})
