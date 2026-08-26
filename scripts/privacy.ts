#!/usr/bin/env tsx
/**
 * Shows what publishing has exposed beyond the notes you deliberately flagged.
 *
 * Run before a first public deploy, and any time you publish a hub note: a note
 * that links to many private notes drags all of their titles into public view
 * as plain text.
 */
import fs from "node:fs/promises"
import path from "node:path"
import { c } from "./lib.ts"

const REPORT = path.resolve(import.meta.dirname, "..", ".publish-exposure.json")

interface Report {
  generatedAt: string
  publishedNotes: number
  privateTitlesVisible: { title: string; appearsIn: string[] }[]
  attachmentsPublished: { file: string; inNote: string }[]
}

const report = await fs.readFile(REPORT, "utf8").then(
  (t) => JSON.parse(t) as Report,
  () => null,
)

if (!report) {
  console.error(c.red("No exposure report. Run `npm run sync` first."))
  process.exit(1)
}

console.log(c.bold(`\nExposure report — ${report.publishedNotes} published note(s)`))
console.log(c.dim(`generated ${report.generatedAt}\n`))

const titles = report.privateTitlesVisible
if (titles.length === 0) {
  console.log(c.green("✓ No private note titles are visible."))
} else {
  console.log(c.yellow(`⚠ ${titles.length} title(s) of UNPUBLISHED notes appear as plain text.`))
  console.log(
    c.dim(
      "  Their links were removed, but the words remain — they were visible prose\n" +
        "  in your note. Check that none of these titles is itself sensitive.\n",
    ),
  )
  for (const { title, appearsIn } of titles) {
    console.log(`  ${c.yellow("·")} ${title}`)
    console.log(c.dim(`      in: ${appearsIn.join(", ")}`))
  }
}

const files = report.attachmentsPublished
console.log()
if (files.length === 0) {
  console.log(c.dim("No attachments published."))
} else {
  console.log(c.bold(`${files.length} attachment(s) publicly fetchable:`))
  for (const { file, inNote } of files) {
    console.log(`  ${c.dim("·")} ${file}  ${c.dim(`(${inNote})`)}`)
  }
}
console.log()
