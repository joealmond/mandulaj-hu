/** Shared helpers for the publish pipeline. */
import fs from "node:fs/promises"
import path from "node:path"
import { parse as parseYaml } from "yaml"

export interface Note {
  /** Absolute path in the vault. */
  sourcePath: string
  /** Vault-relative path, e.g. "Output/Sound Processing.md". */
  vaultRelPath: string
  /** Publishable slug, e.g. "sound-processing". */
  slug: string
  frontmatter: Record<string, unknown>
  body: string
  /** Raw frontmatter block, kept verbatim so we round-trip cleanly. */
  rawFrontmatter: string
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function splitFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>
  rawFrontmatter: string
  body: string
} {
  const match = raw.match(FRONTMATTER_RE)
  if (!match) return { frontmatter: {}, rawFrontmatter: "", body: raw }
  let parsed: unknown
  try {
    parsed = parseYaml(match[1])
  } catch {
    // Malformed frontmatter must NOT be read as "publish: true".
    return { frontmatter: {}, rawFrontmatter: match[1], body: raw.slice(match[0].length) }
  }
  const frontmatter =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  return { frontmatter, rawFrontmatter: match[1], body: raw.slice(match[0].length) }
}

/**
 * The publish gate.
 *
 * Accepts a real YAML boolean `true` and the string `"true"` — and nothing
 * else. `yes`, `1`, `True` and every typo still fail closed.
 *
 * The string form is allowed on purpose: Obsidian's Properties UI writes
 * `publish: "true"` when the property's type is Text rather than Checkbox, and
 * @quartz-community/explicit-publish already accepts both. Rejecting it here
 * only created a silent dead end where a note passed Quartz's filter but was
 * never synced. Matching the plugin keeps one definition of "published".
 */
export function isPublished(frontmatter: Record<string, unknown>): boolean {
  if (frontmatter.draft === true) return false
  return frontmatter.publish === true || frontmatter.publish === "true"
}

/** Slugify with Hungarian diacritics folded (ő/ű included, which NFD handles). */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
}

/** Recursively list files under `dir`, returning absolute paths. */
export async function walk(dir: string, out: string[] = []): Promise<string[]> {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === ".obsidian" || entry.name === ".git" || entry.name === ".trash") continue
      await walk(full, out)
    } else if (entry.isFile()) {
      if (entry.name === ".DS_Store") continue
      out.push(full)
    }
  }
  return out
}

/** A parsed Obsidian wikilink, with every part preserved for round-tripping. */
export interface Wikilink {
  raw: string
  /** Link target with anchor and alias stripped, e.g. "Some Note". */
  target: string
  /** "#heading" or "^block-id", including the leading sigil. Empty if none. */
  anchor: string
  /** Text after "|" — a display alias for notes, a width for images. */
  alias: string
  isEmbed: boolean
  index: number
}

/** `!?[[ target (#anchor)? (|alias)? ]]` */
export const WIKILINK_RE = /(!?)\[\[([^\]|#^]+)([#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g
/** `!?[text](target)`, external URLs excluded by the caller. */
export const MDLINK_RE = /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

export function parseWikilinks(body: string): Wikilink[] {
  const out: Wikilink[] = []
  for (const m of body.matchAll(WIKILINK_RE)) {
    out.push({
      raw: m[0],
      target: m[2].trim(),
      anchor: m[3] ?? "",
      alias: m[4] ?? "",
      isEmbed: m[1] === "!",
      index: m.index ?? 0,
    })
  }
  return out
}

export interface MarkdownLink {
  raw: string
  text: string
  target: string
  isEmbed: boolean
}

export function parseMarkdownLinks(body: string): MarkdownLink[] {
  const out: MarkdownLink[] = []
  for (const m of body.matchAll(MDLINK_RE)) {
    const target = m[3]
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#") || target.startsWith("//")) {
      continue
    }
    out.push({
      raw: m[0],
      text: m[2],
      target: decodeURIComponent(target),
      isEmbed: m[1] === "!",
    })
  }
  return out
}

export const MEDIA_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".avif",
  ".bmp",
  ".ico",
  ".pdf",
  ".mp4",
  ".webm",
  ".ogv",
  ".mov",
  ".mkv",
  ".avi",
  ".mp3",
  ".wav",
  ".flac",
  ".aac",
  ".ogg",
  ".m4a",
])

export function isMedia(name: string): boolean {
  return MEDIA_EXT.has(path.extname(name).toLowerCase())
}

/**
 * Detects a Map-of-Content page.
 *
 * In this vault `#moc` is an INLINE tag, almost always on the first line of the
 * body (`#moc #index`), not a frontmatter key — so frontmatter parsing alone
 * misses every one of them. Only the opening lines are scanned, which keeps a
 * stray `#moc` inside a code block further down from promoting a note.
 */
export function isMoc(frontmatter: Record<string, unknown>, body: string): boolean {
  const tags = frontmatter.tags
  if (Array.isArray(tags) && tags.some((t) => String(t).toLowerCase() === "moc")) return true
  if (typeof tags === "string" && /\bmoc\b/i.test(tags)) return true
  const head = body.split(/\r?\n/).slice(0, 8).join("\n")
  return /(^|\s)#moc(\s|$)/i.test(head)
}

/**
 * Inline `#tag` occurrences, taken only from TAG-ONLY LINES.
 *
 * This vault tags with hashtags rather than frontmatter, on a line of its own —
 * `#moc #index` at the top of a note. Measured across the whole vault: 199
 * notes tag that way, 3 do both, and only 7 have hashtags exclusively
 * mid-prose.
 *
 * Those 7 are all false positives — `#Example`, `#User`, `#See`, `#Getting`,
 * `#service-name` — and one note documenting GitHub Copilot filled the tag
 * index with `#codebase`, `#selection` and `#terminalSelection`, which are
 * chat variables rather than tags.
 *
 * So a hashtag counts only when its line contains nothing else. That matches
 * how this vault is actually written. Frontmatter `tags:` is always honoured.
 *
 * Code is stripped first, so `#include`, `#!/bin/sh` and `#fff` never qualify.
 */
export function inlineTags(body: string): string[] {
  const prose = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`\n]*`/g, " ")
  const out: string[] = []
  for (const line of prose.split(/\r?\n/)) {
    if (!/^[ \t]*(?:#[A-Za-z][\w/-]*[ \t]*)+$/.test(line)) continue
    for (const m of line.matchAll(/#([A-Za-z][\w/-]*)/g)) out.push(m[1])
  }
  return out
}

/**
 * Escapes hashtag-shaped text that is NOT on a tag-only line.
 *
 * Quartz MERGES tags it finds in the body with frontmatter `tags`, so writing
 * an authoritative list is not enough to suppress a false positive — a note
 * documenting GitHub Copilot still contributed `#codebase`, `#selection` and
 * `#terminalSelection` to the tag index.
 *
 * A backslash escape renders identically ("#codebase" still reads as
 * "#codebase") but is no longer parsed as a tag. Tag-only lines are left
 * untouched, since those are the real tags; so are code spans and fences.
 */
export function escapeProseHashtags(body: string): string {
  const fence = /^\s*(```|~~~)/
  let inFence = false
  return body
    .split(/\r?\n/)
    .map((line) => {
      if (fence.test(line)) {
        inFence = !inFence
        return line
      }
      if (inFence) return line
      // A real tag line: leave it alone.
      if (/^[ \t]*(?:#[A-Za-z][\w/-]*[ \t]*)+$/.test(line)) return line
      // Escape elsewhere, but never inside inline code.
      return line
        .split(/(`[^`]*`)/)
        .map((part) =>
          part.startsWith("`") ? part : part.replace(/(^|\s)#([A-Za-z][\w/-]*)/g, "$1\\#$2"),
        )
        .join("")
    })
    .join("\n")
}

export const c = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
}
