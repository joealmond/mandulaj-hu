#!/usr/bin/env tsx
/**
 * Generates the social preview cards.
 *
 * Why this exists rather than the og-image plugin's `imageStructure` option:
 * the plugin's TS override path is wired to `componentRegistry`, and the
 * config loader never reads those overrides back for emitter plugins — the
 * setter fires with the right key and the getter is simply never called. The
 * plugin therefore always renders its own default card, which is fine but
 * generic. Rendering here keeps full control of the design.
 *
 * The plugin stays enabled: it emits the correct <meta property="og:image">
 * tags and per-page filenames. This overwrites the image bytes in place, so
 * the markup and the artwork stay in agreement.
 *
 * Runs BEFORE optimize-fonts: satori needs TTF, and that step rewrites the
 * TTFs to WOFF2, which satori cannot parse.
 */
import fs from "node:fs/promises"
import path from "node:path"
import satori from "satori"
import sharp from "sharp"
import { kassakCard } from "../quartz-custom/og/card.js"
import { c } from "./lib.js"

const REPO = path.resolve(import.meta.dirname, "..")
const PUBLIC = path.join(REPO, "public")
const FONTS = path.join(PUBLIC, "static", "fonts")

interface Note {
  slug: string
  title: string
  accent?: string
  zk?: string
}

/**
 * Picks the TTFs satori needs. Font filenames are Google's opaque hashes, so
 * they're matched by reading the @font-face blocks out of quartz-fonts.css.
 */
async function loadFonts() {
  const css = await fs.readFile(path.join(FONTS, "quartz-fonts.css"), "utf8")
  const blocks = css.split("@font-face").slice(1)
  const wanted = [
    { family: "Archivo", weight: 800 as const },
    { family: "Archivo", weight: 700 as const },
    { family: "Libre Franklin", weight: 400 as const },
  ]

  const fonts: { name: string; data: Buffer; weight: 400 | 700 | 800; style: "normal" }[] = []
  for (const w of wanted) {
    const block = blocks.find(
      (b) =>
        b.includes(`font-family: '${w.family}'`) &&
        b.includes(`font-weight: ${w.weight}`) &&
        !b.includes("font-style: italic"),
    )
    const file = block
      ?.match(/url\(([^)]+)\)/)?.[1]
      ?.split("/")
      .pop()
    if (!file) continue
    const ttf = path.join(FONTS, file.replace(/\.woff2$/, ".ttf"))
    try {
      fonts.push({
        name: w.family,
        data: await fs.readFile(ttf),
        weight: w.weight,
        style: "normal",
      })
    } catch {
      /* that weight was not downloaded */
    }
  }
  return fonts
}

async function main() {
  const manifest = JSON.parse(
    await fs.readFile(path.join(REPO, ".publish-manifest.json"), "utf8"),
  ) as { notes: Note[] }

  const fonts = await loadFonts()
  if (fonts.length < 2) {
    console.warn(c.yellow("  og: fonts unavailable, keeping plugin default cards"))
    return
  }

  // satori wants the two faces in header-then-body order, like the plugin.
  const satoriFonts = fonts.map((f) => ({
    name: f.name,
    data: f.data,
    weight: f.weight,
    style: f.style,
  }))

  let written = 0
  for (const note of manifest.notes) {
    const target = path.join(PUBLIC, `${note.slug}-og-image.webp`)
    try {
      await fs.access(target)
    } catch {
      continue // the plugin did not emit a card for this page
    }

    const description = await descriptionFor(note.slug)
    const element = kassakCard({
      title: note.title,
      description,
      fileData: { slug: note.slug },
    })

    const svg = await satori(element as never, {
      width: 1200,
      height: 630,
      fonts: satoriFonts as never,
    })
    await sharp(Buffer.from(svg)).webp({ quality: 90 }).toFile(target)
    written++
  }

  console.log(c.green(`  og cards → ${written} rendered in site typography`))
}

/** Frontmatter description, read back from the synced note. */
async function descriptionFor(slug: string): Promise<string> {
  try {
    const md = await fs.readFile(path.join(REPO, "content", `${slug}.md`), "utf8")
    return md.match(/^description:\s*(.+)$/m)?.[1]?.replace(/^["']|["']$/g, "") ?? ""
  } catch {
    return ""
  }
}

await main()
