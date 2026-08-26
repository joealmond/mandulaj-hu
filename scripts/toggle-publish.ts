#!/usr/bin/env tsx
/**
 * Toggles `publish: true` on a note, from Obsidian.
 *
 * Bound to a hotkey via the Shell commands plugin, this is the whole publishing
 * gesture: open a note, press the key, it is marked for publication. Press it
 * again to unmark. Nothing is deployed — that is still the publish button.
 *
 *   npx tsx scripts/toggle-publish.ts "/path/to/Note.md"
 *   npx tsx scripts/toggle-publish.ts "/path/to/Note.md" --on    (force on)
 *   npx tsx scripts/toggle-publish.ts "/path/to/Note.md" --off   (force off)
 *
 * Deliberately conservative about the file it is handed:
 *  - notes with no frontmatter get a minimal block, nothing else invented
 *  - existing frontmatter is edited in place, key order and comments preserved
 *  - `description` is NEVER written: Quartz generates one from the first ~150
 *    characters of the note, which beats both a hand-written line and the title
 *  - `tags` are NEVER written: this vault tags with inline #hashtags and Quartz
 *    reads those directly
 */
import fs from "node:fs/promises"
import path from "node:path"
import { c, isPublished, splitFrontmatter } from "./lib.js"

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function updatePublishFlag(
  raw: string,
  force: boolean | null = null,
): { output: string; published: boolean; changed: boolean } {
  const { frontmatter } = splitFrontmatter(raw)
  const currently = isPublished(frontmatter)
  const next = force ?? !currently

  if (currently === next) return { output: raw, published: next, changed: false }

  const match = raw.match(FM)
  let output: string

  if (!match) {
    output = next ? `---\npublish: true\n---\n\n${raw.replace(/^\s+/, "")}` : raw
  } else {
    const body = raw.slice(match[0].length)
    const lines = match[1].split(/\r?\n/)
    const idx = lines.findIndex((line) => /^publish\s*:/.test(line))

    if (next) {
      if (idx >= 0) lines[idx] = "publish: true"
      else lines.unshift("publish: true")
    } else if (idx >= 0) {
      lines.splice(idx, 1)
    }

    const kept = lines.filter((line) => line.trim() !== "")
    output = kept.length ? `---\n${kept.join("\n")}\n---\n${body}` : body.replace(/^\s+/, "")
  }

  return { output, published: next, changed: true }
}

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error("Usage: toggle-publish.ts <file.md> [--on|--off]")
    process.exit(1)
  }
  const force = process.argv.includes("--on") ? true : process.argv.includes("--off") ? false : null

  const abs = path.resolve(file)
  if (!abs.endsWith(".md")) {
    console.error(`Not a markdown note: ${path.basename(abs)}`)
    process.exit(1)
  }

  let raw: string
  try {
    raw = await fs.readFile(abs, "utf8")
  } catch {
    console.error(`Cannot read ${abs}`)
    process.exit(1)
  }

  const result = updatePublishFlag(raw, force)

  if (!result.changed) {
    console.log(
      `Already ${result.published ? "published" : "unpublished"}: ${path.basename(abs, ".md")}`,
    )
    return
  }

  await fs.writeFile(abs, result.output, "utf8")
  const name = path.basename(abs, ".md")
  console.log(
    result.published
      ? c.green(`✓ Marked for publishing: ${name}`)
      : c.yellow(`✓ Unmarked: ${name}`),
  )
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith("toggle-publish.ts")) {
  await main()
}
