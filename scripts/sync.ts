#!/usr/bin/env tsx
/**
 * Vault → content/ sync.
 *
 * This is the ONLY bridge between the private vault and anything publishable.
 * Quartz is never pointed at the vault; it only ever sees what this script
 * decided to copy. That makes publishing fail-closed by construction rather
 * than by filter: a note that this script does not copy cannot be built,
 * cannot be committed, and cannot be deployed.
 *
 * A note is copied only when its frontmatter has a literal `publish: true`
 * (and not `draft: true`). This explicit toggle is the publishing policy.
 *
 * Attachments are copied only if a copied note actually references them.
 */
import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import config from "./publish.config.js"
import { ACCENTS, accentFor, generateAccents, type AccentName } from "./gen-accents.js"
import {
  attachmentName,
  claimAttachment,
  publicFrontmatter,
  replaceArtifacts,
  stableGeneratedAt,
  stripObsidianFooter,
} from "./sync-utils.js"
import {
  c,
  escapeProseHashtags,
  inlineTags,
  isMedia,
  isMoc,
  isPublished,
  localLinkTarget,
  parseWikilinks,
  slugify,
  splitFrontmatter,
  walk,
  WIKILINK_RE,
  MDLINK_RE,
} from "./lib.js"

const REPO = path.resolve(import.meta.dirname, "..")
/** Test-only override that isolates every generated artifact, not just content/. */
const ARTIFACT_ROOT = process.env.PUBLISH_ARTIFACT_ROOT
  ? path.resolve(process.env.PUBLISH_ARTIFACT_ROOT)
  : REPO
const CONTENT = path.join(ARTIFACT_ROOT, config.contentDir)
/** Sync writes every generated artifact here before promoting any of them. */
const STAGING_ROOT = path.join(ARTIFACT_ROOT, ".sync-staging")
const STAGING = path.join(STAGING_ROOT, config.contentDir)
const STAGING_MANIFEST = path.join(STAGING_ROOT, "publish-manifest.json")
const STAGING_ACCENTS = path.join(STAGING_ROOT, "accents.generated.scss")
const MANIFEST = path.join(ARTIFACT_ROOT, ".publish-manifest.json")
/**
 * Local-only exposure report. NOT committed: it lists the titles of private
 * notes, and while those titles are already visible as plain text on the
 * published pages, there is no reason to also put a tidy machine-readable
 * index of them in the repo.
 */
const EXPOSURE = path.join(ARTIFACT_ROOT, ".publish-exposure.json")
const ACCENTS_OUT = path.join(ARTIFACT_ROOT, "quartz-custom/theme/_accents.generated.scss")

interface SyncedNote {
  slug: string
  title: string
  /** Local report label. Deliberately omitted from the persisted manifest. */
  sourcePath: string
  sha256: string
  attachments: string[]
  /** Page accent: explicit pin, category, or a stable slug-derived hue. */
  accent: AccentName
  /** Titles of every published MOC that links to this note. */
  mocs: string[]
  /** The MOC shown in the header block and driving the accent. */
  primaryMoc: string | null
  /** Is this note itself a MOC (a category page)? */
  isMoc: boolean
  /** Tags, for display and for search filters. */
  tags: string[]
  /**
   * Short display ID shown in the header block.
   *
   * Honest about what this is: it is DERIVED from the slug, not a real
   * Luhmann-style Zettelkasten address, so it encodes no ordering or lineage.
   * It exists because the design uses a fixed-width identifier as its one bold
   * element. Set `zk: 0142` in a note's frontmatter to pin a real one.
   */
  zk: string
}

/** Stable 4-digit display ID derived from the slug. */
function zkFor(slug: string, pinned: unknown): string {
  if (typeof pinned === "string" || typeof pinned === "number") {
    return String(pinned).padStart(4, "0").slice(-4)
  }
  return String(hashSlug(slug) % 10000).padStart(4, "0")
}

/**
 * Resolves which published MOC each note belongs to.
 *
 * A MOC is a page tagged `#moc` whose TITLE is the topic and whose body links
 * out to its members — so membership runs MOC → note, the opposite direction
 * from a frontmatter tag. This walks every MOC in the vault, resolves its
 * outbound wikilinks, and records the reverse mapping.
 *
 * A MOC only becomes a public category if its OWN page is published. Otherwise
 * publishing a note would leak the title of a private page ("Family growth")
 * as a category label. Publishing a MOC is the deliberate act that creates a
 * public category.
 */
function resolveMocs(
  mocPages: { abs: string; title: string; body: string; published: boolean }[],
  resolve: (target: string, fromAbs: string) => string | undefined,
): Map<string, string[]> {
  const memberOf = new Map<string, string[]>()
  for (const moc of mocPages) {
    if (!moc.published) continue // private MOC: contributes no public category
    for (const link of parseWikilinks(moc.body)) {
      const target = resolve(link.target, moc.abs)
      if (!target || target === moc.abs) continue
      const list = memberOf.get(target) ?? []
      if (!list.includes(moc.title)) list.push(moc.title)
      memberOf.set(target, list)
    }
  }
  return memberOf
}

/** Published categories share a hue; uncategorised pages still have colour. */
function accentForMoc(moc: string | null, slug: string): AccentName {
  if (!moc) return accentFor(slug)
  const names = Object.keys(ACCENTS) as AccentName[]
  return names[hashSlug(moc) % names.length]
}

/** Frontmatter tags plus inline `#tags` from the opening lines, deduped. */
function collectTags(frontmatter: Record<string, unknown>, body: string): string[] {
  const out = new Set<string>()
  const fm = frontmatter.tags
  // Braces matter here. Without them the `else` bound to the INNER `if`, so the
  // comma-separated string form (`tags: "a, b"`) was silently never read.
  if (Array.isArray(fm)) {
    for (const t of fm) {
      if (typeof t === "string") out.add(t.trim())
    }
  } else if (typeof fm === "string") {
    for (const t of fm.split(",")) out.add(t.trim())
  }
  for (const t of inlineTags(body)) out.add(t)
  // Structural tags are plumbing, not subject matter.
  for (const skip of ["moc", "index", "publish", "draft"]) out.delete(skip)
  return [...out].filter(Boolean).sort()
}

function hashSlug(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

const warnings: string[] = []
const errors: string[] = []
/** Links to unpublished notes that were flattened to plain text. */
const stripped: { target: string; note: string }[] = []

async function main() {
  const vault = path.resolve(config.vaultPath)
  try {
    const st = await fs.stat(vault)
    if (!st.isDirectory()) throw new Error("not a directory")
  } catch {
    console.error(c.red(`✗ Vault not found: ${vault}`))
    console.error(c.dim("  Set VAULT_PATH or fix vaultPath in scripts/publish.config.ts"))
    process.exit(1)
  }

  // ── Index the whole vault, but only to RESOLVE references. Nothing is
  //    copied from this index unless a published note asks for it.
  const allFiles = await walk(vault)
  const byBasename = new Map<string, string[]>()
  const byRelPath = new Map<string, string>()
  for (const abs of allFiles) {
    const rel = path.relative(vault, abs)
    byRelPath.set(rel, abs)
    const base = path.basename(abs)
    const list = byBasename.get(base) ?? []
    list.push(abs)
    byBasename.set(base, list)
    // Obsidian also resolves note links without the .md extension
    if (base.endsWith(".md")) {
      const noExt = base.slice(0, -3)
      const l2 = byBasename.get(noExt) ?? []
      l2.push(abs)
      byBasename.set(noExt, l2)
    }
  }

  // ── The explicit toggle is the single gate. Folder location is irrelevant.
  const eligible = allFiles.filter((abs) => abs.endsWith(".md"))
  const candidates: {
    abs: string
    rel: string
    frontmatter: Record<string, unknown>
    body: string
    raw: string
  }[] = []
  for (const abs of eligible) {
    const raw = await fs.readFile(abs, "utf8")
    const { frontmatter, body } = splitFrontmatter(raw)
    if (!isPublished(frontmatter)) continue
    candidates.push({
      abs,
      rel: path.relative(vault, abs),
      frontmatter,
      body: stripObsidianFooter(body),
      raw,
    })
  }

  if (candidates.length === 0) {
    console.log(c.yellow("⚠ No notes are marked `publish: true` anywhere in the vault."))
  }

  // ── Slugs, with collision detection (a collision would silently drop a post).
  const slugOf = new Map<string, string>() // abs -> slug
  const takenBy = new Map<string, string>() // slug -> abs
  for (const n of candidates) {
    const explicit = typeof n.frontmatter.slug === "string" ? n.frontmatter.slug : undefined
    const title =
      typeof n.frontmatter.title === "string" && n.frontmatter.title.trim()
        ? n.frontmatter.title
        : path.basename(n.abs, ".md")
    const slug = slugify(explicit ?? title)
    if (!slug) {
      errors.push(`Note produces an empty slug: ${n.rel}`)
      continue
    }
    const prev = takenBy.get(slug)
    if (prev) {
      errors.push(
        `Slug collision "${slug}":\n    ${path.relative(vault, prev)}\n    ${n.rel}\n` +
          `    Fix: add an explicit \`slug:\` to one of them.`,
      )
      continue
    }
    takenBy.set(slug, n.abs)
    slugOf.set(n.abs, slug)
  }

  if (errors.length) return report([], 0)

  // Which note paths are published — used to decide link rewriting.
  const publishedAbs = new Set(slugOf.keys())

  // ── Resolve a wikilink/markdown target the way Obsidian would.
  const resolve = (target: string, fromAbs: string): string | undefined => {
    const clean = target.replace(/^\.\//, "")
    // 1. vault-relative path
    if (byRelPath.has(clean)) return byRelPath.get(clean)
    if (byRelPath.has(clean + ".md")) return byRelPath.get(clean + ".md")
    // 2. relative to the linking note
    const rel = path.resolve(path.dirname(fromAbs), clean)
    if (byRelPath.has(path.relative(vault, rel))) return rel
    /*
     * 3. By basename, as Obsidian does — but proximity decides ties.
     *
     * Taking hits[0] meant the winner was whichever the directory walk reached
     * first, i.e. alphabetical order. A published note embedding `![[shot.png]]`
     * pulled `Private/img/shot.png` over `Public/img/shot.png` purely because
     * "Private" sorts before "Public". That is a privacy leak, not a cosmetic
     * bug: a private image shipped under a public note.
     *
     * Obsidian resolves an ambiguous basename to the nearest file, so this now
     * scores candidates by how much of their directory path they share with the
     * linking note and prefers the closest, breaking remaining ties by the
     * shortest path.
     */
    const hits = byBasename.get(path.basename(clean)) ?? byBasename.get(clean)
    if (!hits?.length) return undefined
    if (hits.length === 1) return hits[0]

    const fromParts = path.dirname(fromAbs).split(path.sep)
    const score = (candidate: string) => {
      const parts = path.dirname(candidate).split(path.sep)
      let shared = 0
      while (
        shared < parts.length &&
        shared < fromParts.length &&
        parts[shared] === fromParts[shared]
      ) {
        shared++
      }
      return shared
    }

    const best = hits
      .slice()
      .sort((a, b) => score(b) - score(a) || a.length - b.length || a.localeCompare(b))[0]

    warnings.push(
      `Ambiguous reference "${target}" in ${path.relative(vault, fromAbs)} — ` +
        `resolved to the nearest match, ${path.relative(vault, best)}`,
    )
    return best
  }

  // ── MOC index. Scans the whole vault so any MOC can define relationships.
  //    Only MOCs that are themselves published become public categories.
  const publishedAbs0 = new Set(slugOf.keys())
  const mocPages: { abs: string; title: string; body: string; published: boolean }[] = []
  for (const abs of allFiles) {
    if (!abs.endsWith(".md")) continue
    const raw = await fs.readFile(abs, "utf8").catch(() => "")
    if (!raw) continue
    const { frontmatter, body } = splitFrontmatter(raw)
    const publicBody = stripObsidianFooter(body)
    if (!isMoc(frontmatter, publicBody)) continue
    mocPages.push({
      abs,
      title:
        typeof frontmatter.title === "string" && frontmatter.title.trim()
          ? frontmatter.title
          : path.basename(abs, ".md"),
      body: publicBody,
      published: publishedAbs0.has(abs),
    })
  }
  const memberOf = resolveMocs(mocPages, resolve)
  const publicMocs = mocPages.filter((m) => m.published).map((m) => m.title)

  /*
   * Build into a staging directory and swap it in only once everything has
   * validated.
   *
   * content/ used to be deleted here, before the repo-page slug-collision check
   * further down had run — so an error late in the process left content/ either
   * empty or half-written, and the next build would fail the audit for a reason
   * unrelated to the actual mistake. Sync is now all-or-nothing.
   */
  await fs.rm(STAGING_ROOT, { recursive: true, force: true })
  await fs.mkdir(path.join(STAGING, config.attachmentsSubdir), { recursive: true })

  const synced: SyncedNote[] = []
  const attachmentsToCopy = new Map<string, string>() // destName -> srcAbs
  let strippedLinks = 0

  for (const n of candidates) {
    const slug = slugOf.get(n.abs)
    if (!slug) continue
    const title =
      typeof n.frontmatter.title === "string" && n.frontmatter.title.trim()
        ? n.frontmatter.title
        : path.basename(n.abs, ".md")

    const noteAttachments: string[] = []

    // Rewrite wikilinks in one pass.
    let body = n.body.replace(
      WIKILINK_RE,
      (raw, bang: string, rawTarget: string, anchor = "", alias = "") => {
        const target = rawTarget.trim()
        const resolved = resolve(target, n.abs)

        if (resolved && isMedia(resolved)) {
          const destName = attachmentName(resolved, vault)
          if (!claimAttachment(attachmentsToCopy, destName, resolved)) {
            errors.push(`Attachment destination collision: ${destName}`)
          }
          if (!noteAttachments.includes(destName)) noteAttachments.push(destName)
          const suffix = alias ? `|${alias}` : ""
          return `![[${config.attachmentsSubdir}/${destName}${suffix}]]`
        }

        if (resolved && publishedAbs.has(resolved)) {
          const targetSlug = slugOf.get(resolved)!
          const display = alias || target
          return `${bang}[[${targetSlug}${anchor}|${display}]]`
        }

        // Target is private or missing, so the LINK must not ship.
        // NOTE: the link TEXT still ships — it was visible prose in the note.
        // Deleting it would silently mangle the post, so it is flattened and
        // reported instead. Review the report if a private note's *title* is
        // itself sensitive.
        if (isRedacted(target)) {
          strippedLinks++
          return ""
        }
        if (config.stripUnpublishedLinks) {
          strippedLinks++
          stripped.push({ target, note: n.rel })
          return alias || target
        }
        warnings.push(`Unpublished link "${target}" left intact in ${n.rel}`)
        return raw
      },
    )

    // Rewrite plain markdown links/embeds to local files.
    body = body.replace(MDLINK_RE, (raw, bang: string, text: string, rawTarget: string) => {
      if (
        /^[a-z][a-z0-9+.-]*:/i.test(rawTarget) ||
        rawTarget.startsWith("#") ||
        rawTarget.startsWith("//")
      ) {
        return raw
      }
      const { target, suffix } = localLinkTarget(rawTarget)
      const resolved = resolve(target, n.abs)
      if (resolved && isMedia(resolved)) {
        const destName = attachmentName(resolved, vault)
        if (!claimAttachment(attachmentsToCopy, destName, resolved)) {
          errors.push(`Attachment destination collision: ${destName}`)
        }
        if (!noteAttachments.includes(destName)) noteAttachments.push(destName)
        return `${bang}[${text}](${config.attachmentsSubdir}/${encodeURIComponent(destName)}${suffix})`
      }
      if (resolved && publishedAbs.has(resolved)) {
        return `${bang}[${text}](${slugOf.get(resolved)!}${suffix})`
      }
      if (config.stripUnpublishedLinks && !bang) {
        strippedLinks++
        stripped.push({ target, note: n.rel })
        return text || target
      }
      return raw
    })

    // Explicit frontmatter pin wins; then the primary MOC; then slug hash.
    const noteMocs = memberOf.get(n.abs) ?? []
    const pinnedMoc = typeof n.frontmatter.moc === "string" ? n.frontmatter.moc : null
    const primaryMoc =
      pinnedMoc && noteMocs.includes(pinnedMoc)
        ? pinnedMoc
        : (noteMocs.slice().sort((a, b) => a.localeCompare(b))[0] ?? null)
    // A category page wears its own category's colour, not its parent's.
    const selfIsMoc = isMoc(n.frontmatter, n.body)
    const colourKey = selfIsMoc ? title : primaryMoc
    const pinnedAccent = n.frontmatter.accent
    const accent =
      typeof pinnedAccent === "string" && Object.hasOwn(ACCENTS, pinnedAccent)
        ? (pinnedAccent as AccentName)
        : accentForMoc(colourKey, slug)

    /*
     * Hoist inline #hashtags into frontmatter `tags`, and drop lines that are
     * nothing but tags.
     *
     * This vault tags with hashtags, not frontmatter, usually on the first line
     * (`#moc #index`). Left in the body that line is prose as far as Quartz is
     * concerned, so it led every generated description — "engineering testing
     * Dependency inversion is…". Hoisting keeps the tags (they reach Quartz via
     * frontmatter instead) and gives the description generator real prose to
     * start from.
     *
     * Only tag-ONLY lines are removed. "Some #engineering thoughts." is a
     * sentence and stays exactly as written.
     */
    const hoisted = collectTags(n.frontmatter, n.body)
    body = body.replace(/^[ \t]*(?:#[A-Za-z][\w/-]*[ \t]*)+$/gm, "").replace(/\n{3,}/g, "\n\n")
    body = escapeProseHashtags(body)

    // Rebuild frontmatter. `title` is written explicitly because the file is
    // renamed to its slug — without this, "Sound Processing" would render as
    // "sound-processing".
    const fm = publicFrontmatter(n.frontmatter, config.publicFrontmatter)
    // Structural values are normalized rather than copied from the private
    // source, so only the documented public shape can cross the boundary.
    fm.publish = true
    fm.title = title
    fm.slug = slug
    // ALWAYS written, even when empty. Omitting the key lets Quartz derive tags
    // by scanning the body itself, which picks up hashtag-shaped prose — a note
    // documenting GitHub Copilot filled the tag index with #codebase and
    // #terminalSelection. Writing the key makes our list authoritative.
    fm.tags = hoisted
    // Surfaced so the header component can render the category label and link
    // without reading the manifest at render time.
    if (primaryMoc) {
      fm.moc = primaryMoc
      const mocEntry = mocPages.find((m) => m.title === primaryMoc && m.published)
      if (mocEntry) fm.mocSlug = slugOf.get(mocEntry.abs) ?? ""
    }
    if (selfIsMoc) fm.isMoc = true
    // Lets list components colour each row with its own note's accent.
    fm.accent = accent
    const fmLines = Object.entries(fm)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${serialiseYamlValue(v)}`)
      .join("\n")

    const out = `---\n${fmLines}\n---\n\n${body.trimStart()}`
    await fs.writeFile(path.join(STAGING, `${slug}.md`), out, "utf8")

    synced.push({
      slug,
      title,
      sourcePath: n.rel,
      sha256: createHash("sha256").update(out).digest("hex").slice(0, 16),
      attachments: noteAttachments,
      accent,
      zk: zkFor(slug, n.frontmatter.zk),
      mocs: noteMocs,
      primaryMoc,
      isMoc: selfIsMoc,
      tags: hoisted,
    })
  }

  // ── Repo-owned pages (home, projects index, …). Same publish gate.
  const pagesDir = path.join(REPO, config.pagesDir)
  for (const abs of await walk(pagesDir)) {
    if (!abs.endsWith(".md")) continue
    const rel = path.relative(pagesDir, abs)
    const raw = await fs.readFile(abs, "utf8")
    const { frontmatter } = splitFrontmatter(raw)
    if (!isPublished(frontmatter)) {
      warnings.push(`${config.pagesDir}/${rel} lacks \`publish: true\` — skipped.`)
      continue
    }
    const slug =
      typeof frontmatter.slug === "string" ? frontmatter.slug : slugify(path.basename(rel, ".md"))
    if (takenBy.has(slug)) {
      errors.push(`Slug collision "${slug}": ${config.pagesDir}/${rel} vs a vault note.`)
      continue
    }
    takenBy.set(slug, abs)

    // Same treatment as vault notes, so repo-owned pages behave identically:
    // tags hoisted, and frontmatter filtered through the same default-deny
    // allowlist. Previously these pages were only caught by the output audit,
    // which gave the same guarantee but failed late instead of sanitising.
    const pageTags = collectTags(frontmatter, raw)
    const { body: pageBody } = splitFrontmatter(raw)
    const cleanedBody = pageBody
      .replace(/^[ \t]*(?:#[A-Za-z][\w/-]*[ \t]*)+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")

    const pageFm = publicFrontmatter(frontmatter, config.publicFrontmatter)
    pageFm.publish = true
    pageFm.title =
      typeof frontmatter.title === "string" && frontmatter.title.trim() ? frontmatter.title : slug
    pageFm.slug = slug
    pageFm.tags = pageTags
    const pinned = frontmatter.accent
    const accent =
      typeof pinned === "string" && Object.hasOwn(ACCENTS, pinned)
        ? (pinned as AccentName)
        : accentForMoc(null, slug)
    pageFm.accent = accent
    const fmLines = Object.entries(pageFm)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${serialiseYamlValue(v)}`)

    const pageOut = fmLines.length
      ? `---\n${fmLines.join("\n")}\n---\n\n${cleanedBody.trimStart()}`
      : cleanedBody.trimStart()
    await fs.writeFile(path.join(STAGING, `${slug}.md`), pageOut, "utf8")
    synced.push({
      slug,
      title: typeof frontmatter.title === "string" ? frontmatter.title : slug,
      sourcePath: `${config.pagesDir}/${rel}`,
      sha256: createHash("sha256").update(pageOut).digest("hex").slice(0, 16),
      attachments: [],
      accent,
      zk: zkFor(slug, frontmatter.zk),
      mocs: [],
      primaryMoc: null,
      isMoc: false,
      tags: pageTags,
    })
  }
  if (errors.length) {
    await discardStaging()
    return report([], 0)
  }

  // ── Copy ONLY traced attachments.
  for (const [destName, srcAbs] of attachmentsToCopy) {
    await fs.copyFile(srcAbs, path.join(STAGING, config.attachmentsSubdir, destName))
  }

  // Build every generated artifact before touching the live set. The final
  // multi-path promotion keeps backups and restores all of them if any rename
  // fails, so content, manifest, and CSS cannot disagree after an error. Keep
  // the timestamp stable when the public payload is identical so a private-only
  // vault commit remains a byte-for-byte no-op for the remote publisher.
  const manifestPayload = {
    categories: publicMocs.sort((a, b) => a.localeCompare(b)),
    notes: synced
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .map(({ sourcePath: _sourcePath, ...note }) => note),
    attachments: [...attachmentsToCopy.keys()].sort(),
  }
  const previousManifest = await fs
    .readFile(MANIFEST, "utf8")
    .then((raw) => JSON.parse(raw) as unknown)
    .catch(() => undefined)
  const generatedAt = stableGeneratedAt(previousManifest, manifestPayload, new Date().toISOString())
  await fs.mkdir(path.dirname(ACCENTS_OUT), { recursive: true })
  await fs.writeFile(
    STAGING_MANIFEST,
    JSON.stringify({ generatedAt, ...manifestPayload }, null, 2) + "\n",
    "utf8",
  )
  await generateAccents(STAGING_MANIFEST, STAGING_ACCENTS)
  await replaceArtifacts([
    { staged: STAGING, live: CONTENT },
    { staged: STAGING_MANIFEST, live: MANIFEST },
    { staged: STAGING_ACCENTS, live: ACCENTS_OUT },
  ])
  await fs.rm(STAGING_ROOT, { recursive: true, force: true })

  // Written after the swap, so it always describes what is actually live.
  await writeExposureReport(synced)

  report(synced, attachmentsToCopy.size, strippedLinks)
}

/**
 * Records what publishing exposed beyond the notes deliberately flagged.
 *
 * Two categories, both easy to forget:
 *  - titles of UNPUBLISHED notes, left as plain text where their link was
 *    flattened. The link is gone; the words are not.
 *  - attachments, which become publicly fetchable URLs once their note ships.
 *
 * Written to a gitignored file rather than the manifest: those titles are
 * already visible on the published pages, but there is no reason to also commit
 * a tidy machine-readable index of them.
 */
async function writeExposureReport(synced: SyncedNote[]) {
  const byTitle = new Map<string, Set<string>>()
  for (const { target, note } of stripped) {
    const set = byTitle.get(target) ?? new Set<string>()
    set.add(note)
    byTitle.set(target, set)
  }

  const report = {
    generatedAt: new Date().toISOString(),
    publishedNotes: synced.length,
    privateTitlesVisible: [...byTitle.entries()]
      .map(([title, notes]) => ({ title, appearsIn: [...notes].sort() }))
      .sort((a, b) => a.title.localeCompare(b.title)),
    attachmentsPublished: synced
      .flatMap((n) => n.attachments.map((a) => ({ file: a, inNote: n.slug })))
      .sort((a, b) => a.file.localeCompare(b.file)),
  }
  await fs.writeFile(EXPOSURE, JSON.stringify(report, null, 2) + "\n", "utf8")
}

/**
 * True when a link target should be removed outright rather than flattened.
 * See `redactLinkPrefixes` in publish.config.ts for why both behaviours exist.
 */
function isRedacted(target: string): boolean {
  const t = target.toLowerCase()
  return config.redactLinkPrefixes.some((p) => t.startsWith(p.toLowerCase()))
}

function serialiseYamlValue(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => serialiseYamlValue(x)).join(", ")}]`
  if (v instanceof Date) return v.toISOString()
  if (typeof v === "string") {
    return /^[\w .\/-]+$/.test(v) && !/^\d/.test(v) ? v : JSON.stringify(v)
  }
  return String(v)
}

async function discardStaging() {
  await fs.rm(STAGING_ROOT, { recursive: true, force: true }).catch(() => {})
}

function report(synced: SyncedNote[], attachments: number, strippedCount = 0) {
  console.log()
  if (errors.length) {
    console.error(c.red(c.bold(`✗ Sync aborted — ${errors.length} error(s):`)))
    for (const e of errors) console.error(c.red(`  • ${e}`))
    console.error(c.dim("\n  content/ was left untouched."))
    process.exit(1)
  }
  console.log(c.green(c.bold(`✓ Synced ${synced.length} note(s), ${attachments} attachment(s)`)))
  for (const n of synced) {
    console.log(`  ${c.dim("→")} ${n.slug.padEnd(36)} ${c.dim(n.sourcePath)}`)
  }
  if (strippedCount) {
    const unique = [...new Set(stripped.map((s) => s.target))].sort()
    console.log(
      c.yellow(`\n⚠ ${strippedCount} link(s) to unpublished notes flattened to plain text.`),
    )
    console.log(
      c.dim(
        `  The link is gone, but the text remains visible on the published page.\n` +
          `  Check that none of these titles is itself sensitive:`,
      ),
    )
    for (const t of unique) console.log(c.dim(`    · ${t}`))
  }
  if (warnings.length) {
    console.log(c.yellow(`\n⚠ ${warnings.length} warning(s):`))
    for (const w of warnings.slice(0, 20)) console.log(c.yellow(`  • ${w}`))
    if (warnings.length > 20) console.log(c.dim(`  … and ${warnings.length - 20} more`))
  }
  console.log()
}

await main()
