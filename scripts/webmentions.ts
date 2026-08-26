#!/usr/bin/env tsx
/**
 * Fetches received webmentions from webmention.io into a local JSON file.
 *
 * Runs before the build so the component can read mentions synchronously —
 * Quartz components render synchronously and cannot await a network call.
 *
 * Degrades to nothing, deliberately and at every step: no token, a network
 * failure, a non-200, malformed JSON, or webmention.io being down all leave the
 * previous cache in place (or an empty list) and let the build continue. A
 * third-party service being unreachable must never fail a deploy.
 */
import fs from "node:fs/promises"
import path from "node:path"
import { c } from "./lib.js"

const REPO = path.resolve(import.meta.dirname, "..")
const OUT = path.join(REPO, "quartz-custom/data/webmentions.json")
const TIMEOUT_MS = 8000

export interface Mention {
  type: "like" | "repost" | "reply" | "mention"
  target: string
  url: string
  published: string | null
  author: { name: string; photo: string | null; url: string | null }
  content: string | null
}

async function main() {
  const token = process.env.WEBMENTION_IO_TOKEN?.trim()
  const domain = process.env.WEBMENTION_DOMAIN?.trim()

  if (!token || !domain) {
    console.log(
      c.dim(
        "  webmentions: not configured, skipping (set WEBMENTION_IO_TOKEN + WEBMENTION_DOMAIN)",
      ),
    )
    await ensureFile()
    return
  }

  const url =
    `https://webmention.io/api/mentions.jf2?domain=${encodeURIComponent(domain)}` +
    `&token=${encodeURIComponent(token)}&per-page=500`

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(timer)

    if (!res.ok) {
      console.warn(c.yellow(`  webmentions: HTTP ${res.status}, keeping previous cache`))
      await ensureFile()
      return
    }

    const body = (await res.json()) as { children?: unknown[] }
    const mentions: Mention[] = (body.children ?? [])
      .map(normalise)
      .filter((m): m is Mention => m !== null)

    await fs.writeFile(OUT, JSON.stringify(mentions, null, 2) + "\n", "utf8")
    console.log(c.green(`  webmentions → ${mentions.length} received`))
  } catch (err) {
    console.warn(
      c.yellow(
        `  webmentions: ${(err as Error).message} — keeping previous cache, build continues`,
      ),
    )
    await ensureFile()
  }
}

/** webmention.io's jf2 shape is loose; take only what we render. */
function normalise(raw: unknown): Mention | null {
  const m = raw as Record<string, any>
  if (!m || typeof m !== "object" || typeof m["wm-target"] !== "string") return null

  const kind = String(m["wm-property"] ?? "")
  const type =
    kind === "like-of"
      ? "like"
      : kind === "repost-of"
        ? "repost"
        : kind === "in-reply-to"
          ? "reply"
          : "mention"

  const content =
    typeof m.content?.text === "string"
      ? m.content.text.slice(0, 400)
      : typeof m.content?.value === "string"
        ? m.content.value.slice(0, 400)
        : null

  return {
    type,
    target: m["wm-target"],
    url: typeof m.url === "string" ? m.url : "",
    published: typeof m.published === "string" ? m.published : (m["wm-received"] ?? null),
    author: {
      name: typeof m.author?.name === "string" ? m.author.name : "Someone",
      photo: typeof m.author?.photo === "string" ? m.author.photo : null,
      url: typeof m.author?.url === "string" ? m.author.url : null,
    },
    content,
  }
}

async function ensureFile() {
  try {
    await fs.access(OUT)
  } catch {
    await fs.writeFile(OUT, "[]\n", "utf8")
  }
}

await main()
