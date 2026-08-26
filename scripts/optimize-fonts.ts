#!/usr/bin/env tsx
/**
 * Converts the self-hosted fonts from TTF to WOFF2.
 *
 * Why this exists: @quartz-community/quartz-fonts downloads fonts by calling
 * `fetch(href)` against the Google Fonts CSS API with no User-Agent. Google
 * serves WOFF2 only to user agents it recognises as modern, so an anonymous
 * fetch gets the legacy TTF payload — roughly 2x the bytes for identical
 * glyphs. Patching the plugin is not an option (it would be lost on reinstall),
 * so we re-encode after the build instead and rewrite the CSS to match.
 *
 * Runs after `quartz build`, before the output audit.
 */
import fs from "node:fs/promises"
import path from "node:path"
import { compress } from "wawoff2"
import { c } from "./lib.js"

const PUBLIC = path.resolve(import.meta.dirname, "..", "public")
const FONT_DIR = path.join(PUBLIC, "static", "fonts")

async function main() {
  let ttfs: string[]
  try {
    ttfs = (await fs.readdir(FONT_DIR)).filter((f) => f.endsWith(".ttf"))
  } catch {
    console.log(c.dim("  no self-hosted fonts to optimise"))
    return
  }
  if (!ttfs.length) return

  let before = 0
  let after = 0
  const renames = new Map<string, string>()

  for (const file of ttfs) {
    const src = path.join(FONT_DIR, file)
    const buf = await fs.readFile(src)
    let out: Buffer
    try {
      out = Buffer.from(await compress(buf))
    } catch (err) {
      console.warn(c.yellow(`  skipped ${file}: ${(err as Error).message}`))
      continue
    }
    // Only adopt the conversion when it actually wins.
    if (out.length >= buf.length) continue
    const dest = file.replace(/\.ttf$/, ".woff2")
    await fs.writeFile(path.join(FONT_DIR, dest), out)
    await fs.rm(src)
    renames.set(file, dest)
    before += buf.length
    after += out.length
  }

  // Also fix the @font-face src URLs. The fonts plugin writes them as absolute
  // URLs against `baseUrl` (https://mandulaj.hu/static/fonts/...), which 404s
  // on localhost and on every preview deployment, and would fetch
  // cross-origin from production even after the domain is live. Root-relative
  // is correct in all three cases.
  const fontCss = path.join(FONT_DIR, "quartz-fonts.css")
  try {
    let css = await fs.readFile(fontCss, "utf8")
    const before = css
    css = css.replace(/url\((https?:)?\/\/[^/)]+\/static\/fonts\//g, "url(/static/fonts/")
    if (css !== before) {
      await fs.writeFile(fontCss, css, "utf8")
      console.log(c.dim("  font URLs → origin-relative"))
    }
  } catch {
    /* no font stylesheet */
  }

  if (!renames.size) return

  // Rewrite every reference: CSS urls and the format() hint.
  const files = await collect(PUBLIC)
  for (const abs of files) {
    if (!/\.(css|html|js)$/.test(abs)) continue
    let text = await fs.readFile(abs, "utf8")
    let touched = false
    for (const [from, to] of renames) {
      if (text.includes(from)) {
        text = text.split(from).join(to)
        touched = true
      }
    }
    if (touched) {
      text = text.replace(/format\((["']?)truetype\1\)/g, "format($1woff2$1)")
      await fs.writeFile(abs, text, "utf8")
    }
  }

  const kb = (n: number) => `${(n / 1024).toFixed(0)}KB`
  const saved = (((before - after) / before) * 100).toFixed(0)
  console.log(
    c.green(`  fonts → woff2: ${renames.size} file(s), ${kb(before)} → ${kb(after)} (−${saved}%)`),
  )
}

async function collect(dir: string, out: string[] = []): Promise<string[]> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) await collect(full, out)
    else out.push(full)
  }
  return out
}

await main()
