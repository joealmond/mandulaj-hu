#!/usr/bin/env tsx
/**
 * Sends outgoing webmentions for published notes.
 *
 * For every external link in a published note, discovers the target's
 * webmention endpoint (Link header, then <link>/<a> in the HTML) and POSTs
 * source+target to it.
 *
 * Every failure is non-fatal by design: a target with no endpoint, a dead
 * host, a timeout, or a rejection is logged and skipped. Sending mentions is
 * a courtesy to other sites — it must never be able to fail your publish.
 *
 * Run with `npm run publish`, or on its own with `npm run webmentions:send`.
 * `--dry` lists what would be sent without sending anything.
 */
import fs from "node:fs/promises"
import path from "node:path"
import { c, parseMarkdownLinks } from "./lib.js"

const REPO = path.resolve(import.meta.dirname, "..")
const TIMEOUT_MS = 8000
const DRY = process.argv.includes("--dry")

async function baseUrl(): Promise<string> {
  const yaml = await fs.readFile(path.join(REPO, "quartz.config.yaml"), "utf8")
  return (yaml.match(/^\s*baseUrl:\s*(.+)$/m)?.[1] ?? "").trim().replace(/^["']|["']$/g, "")
}

function withTimeout(ms: number) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  return { signal: ctrl.signal, done: () => clearTimeout(timer) }
}

/** Endpoint discovery, per the W3C spec order: Link header, then markup. */
async function discover(target: string): Promise<string | null> {
  const t = withTimeout(TIMEOUT_MS)
  try {
    const res = await fetch(target, { signal: t.signal, redirect: "follow" })
    t.done()
    if (!res.ok) return null

    const link = res.headers.get("link")
    if (link) {
      const m = link.match(/<([^>]+)>\s*;\s*rel\s*=\s*"?[^"]*webmention/i)
      if (m) return new URL(m[1], res.url).toString()
    }

    const html = await res.text()
    const tag =
      html.match(/<link[^>]+rel=["'][^"']*webmention[^"']*["'][^>]+href=["']([^"']+)["']/i) ??
      html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*webmention[^"']*["']/i) ??
      html.match(/<a[^>]+rel=["'][^"']*webmention[^"']*["'][^>]+href=["']([^"']+)["']/i)
    return tag ? new URL(tag[1], res.url).toString() : null
  } catch {
    t.done()
    return null
  }
}

async function send(endpoint: string, source: string, target: string): Promise<boolean> {
  const t = withTimeout(TIMEOUT_MS)
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      signal: t.signal,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ source, target }).toString(),
    })
    t.done()
    return res.ok || res.status === 202
  } catch {
    t.done()
    return false
  }
}

async function main() {
  const base = await baseUrl()
  if (!base) {
    console.error(c.red("✗ baseUrl missing from quartz.config.yaml"))
    process.exit(0) // still non-fatal
  }

  const manifest = JSON.parse(
    await fs.readFile(path.join(REPO, ".publish-manifest.json"), "utf8"),
  ) as { notes: { slug: string }[] }

  const jobs: { source: string; target: string }[] = []
  for (const note of manifest.notes) {
    let md: string
    try {
      md = await fs.readFile(path.join(REPO, "content", `${note.slug}.md`), "utf8")
    } catch {
      continue
    }
    const source = `https://${base}/${note.slug === "index" ? "" : note.slug}`
    const external = new Set<string>()
    // Markdown links plus bare autolinks.
    for (const l of parseMarkdownLinks(md)) external.add(l.target)
    for (const m of md.matchAll(/https?:\/\/[^\s)<>\]"']+/g)) external.add(m[0])

    for (const target of external) {
      if (!/^https?:\/\//i.test(target)) continue
      if (target.includes(base)) continue // don't mention yourself
      jobs.push({ source, target })
    }
  }

  if (jobs.length === 0) {
    console.log(c.dim("  webmentions: no outgoing links to send"))
    return
  }

  console.log(c.dim(`  webmentions: ${jobs.length} candidate link(s)`))
  let sent = 0
  let skipped = 0

  for (const { source, target } of jobs) {
    const endpoint = await discover(target)
    if (!endpoint) {
      skipped++
      continue
    }
    if (DRY) {
      console.log(c.dim(`    would send ${source} → ${target}`))
      sent++
      continue
    }
    const ok = await send(endpoint, source, target)
    if (ok) {
      sent++
      console.log(c.green(`    sent → ${target}`))
    } else {
      skipped++
      console.log(c.yellow(`    rejected → ${target}`))
    }
  }

  console.log(c.dim(`  webmentions: ${sent} sent, ${skipped} skipped (no endpoint or refused)`))
}

// Never fail the publish over an outgoing mention.
try {
  await main()
} catch (err) {
  console.warn(c.yellow(`  webmentions: ${(err as Error).message} — continuing`))
}
