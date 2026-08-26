#!/usr/bin/env tsx
/**
 * Fail-closed safety net.
 *
 * sync.ts is the guarantee; this is the proof. It runs in two modes:
 *
 *   audit content  — before commit. Everything staged in content/ must be
 *                    accounted for by the manifest and carry `publish: true`.
 *                    Catches hand-edited or hand-dropped files.
 *
 *   audit output   — after build, including in CI. Everything emitted into
 *                    public/ must trace back to a published note. Deliberately
 *                    works without the vault, so CI can run it.
 *
 * Any finding is fatal. This script never "warns and continues".
 */
import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { c, isMedia, isPublished, slugify, splitFrontmatter, walk } from "./lib.js"
import config from "./publish.config.js"

const REPO = path.resolve(import.meta.dirname, "..")
/** Test-only override; production intentionally defaults to the repository. */
const ARTIFACT_ROOT = process.env.PUBLISH_ARTIFACT_ROOT
  ? path.resolve(process.env.PUBLISH_ARTIFACT_ROOT)
  : REPO
const CONTENT = path.join(ARTIFACT_ROOT, "content")
const PUBLIC = path.join(ARTIFACT_ROOT, "public")
const MANIFEST = path.join(ARTIFACT_ROOT, ".publish-manifest.json")

interface Manifest {
  generatedAt: string
  notes: {
    slug: string
    title: string
    sha256: string
    attachments: string[]
  }[]
  attachments: string[]
}

const failures: string[] = []
const fail = (msg: string) => failures.push(msg)

/**
 * The complete metadata surface allowed in generated public notes.
 * Source properties are default-deny; structural properties are regenerated
 * by sync. Keeping this assertion in the independent audit turns that policy
 * into a deploy-blocking guarantee.
 */
const PUBLIC_FRONTMATTER = new Set([
  ...config.publicFrontmatter,
  "publish",
  "title",
  "slug",
  "tags",
  "moc",
  "mocSlug",
  "isMoc",
  "accent",
])

/** Filenames that must never appear in a build, whatever the source. */
const FORBIDDEN = [
  /(^|\/)\.env($|\.)/i,
  /(^|\/)\.obsidian(\/|$)/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)\.DS_Store$/i,
  /(^|\/)id_(rsa|ed25519)($|\.)/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.publish-manifest\.json$/i,
  /\.pem$/i,
  /\.key$/i,
]

async function loadManifest(): Promise<Manifest> {
  try {
    return JSON.parse(await fs.readFile(MANIFEST, "utf8")) as Manifest
  } catch {
    console.error(c.red("✗ .publish-manifest.json missing or unreadable."))
    console.error(c.dim("  Run `npm run sync` first — the audit refuses to pass without it."))
    process.exit(1)
  }
}

async function auditContent(manifest: Manifest) {
  const known = new Map(manifest.notes.map((n) => [n.slug, n]))
  const knownAttachments = new Set(manifest.attachments)

  const files = await walk(CONTENT)
  const seenSlugs = new Set<string>()

  for (const abs of files) {
    const rel = path.relative(CONTENT, abs)

    if (FORBIDDEN.some((re) => re.test(rel))) {
      fail(`Forbidden file staged in content/: ${rel}`)
      continue
    }

    if (rel.endsWith(".md")) {
      if (path.dirname(rel) !== ".") {
        fail(`Note outside the flat root of content/: ${rel}`)
      }
      const slug = path.basename(rel, ".md")
      seenSlugs.add(slug)

      const raw = await fs.readFile(abs, "utf8")
      const { frontmatter } = splitFrontmatter(raw)

      // The gate, re-asserted on the artifact rather than the source.
      if (!isPublished(frontmatter)) {
        fail(
          `content/${rel} does NOT carry \`publish: true\` — it must never have been synced. ` +
            `This is the exact leak the audit exists to catch.`,
        )
      }

      const unexpectedKeys = Object.keys(frontmatter).filter((key) => !PUBLIC_FRONTMATTER.has(key))
      if (unexpectedKeys.length) {
        fail(
          `content/${rel} contains non-public frontmatter: ${unexpectedKeys.join(", ")}. ` +
            `Only explicitly allowed or sync-generated properties may cross the boundary.`,
        )
      }

      const entry = known.get(slug)
      if (!entry) {
        fail(`content/${rel} is not in the manifest — added by hand? Re-run \`npm run sync\`.`)
        continue
      }
      const sha = createHash("sha256").update(raw).digest("hex").slice(0, 16)
      if (sha !== entry.sha256) {
        fail(
          `content/${rel} was modified after sync (hash ${sha} ≠ ${entry.sha256}). ` +
            `Edit the note in the vault, not in content/.`,
        )
      }
      continue
    }

    // Non-markdown: must be a traced attachment.
    const inAttachments = rel.startsWith("attachments" + path.sep)
    const base = path.basename(rel)
    if (!inAttachments) {
      fail(`Unexpected non-note file in content/: ${rel}`)
    } else if (!knownAttachments.has(base)) {
      fail(`Untraced attachment in content/: ${rel} (no published note references it)`)
    }
  }

  for (const slug of known.keys()) {
    if (!seenSlugs.has(slug)) fail(`Manifest lists "${slug}" but content/${slug}.md is missing.`)
  }

  return seenSlugs
}

async function auditOutput(manifest: Manifest) {
  try {
    await fs.stat(PUBLIC)
  } catch {
    console.error(c.red("✗ public/ not found — run the build before auditing output."))
    process.exit(1)
  }

  const allowedSlugs = new Set(manifest.notes.map((n) => n.slug))
  const allowedAttachments = new Set(manifest.attachments)
  const files = await walk(PUBLIC)

  for (const abs of files) {
    const rel = path.relative(PUBLIC, abs)

    if (FORBIDDEN.some((re) => re.test(rel))) {
      fail(`Forbidden file emitted into public/: ${rel}`)
      continue
    }

    // Raw markdown must never ship.
    if (rel.endsWith(".md")) {
      fail(`Markdown source leaked into public/: ${rel}`)
      continue
    }

    // Quartz's own assets and generated site files are fine.
    if (
      rel.startsWith("static" + path.sep) ||
      rel.startsWith("pagefind" + path.sep) ||
      /^(index|sitemap|rss)\.xml$/.test(rel) ||
      /^(_headers|_redirects|robots\.txt|sitemap\.xml|contentIndex\.json|404\.html|index\.html|favicon\.ico|prescript\.js|postscript\.js)$/.test(
        rel,
      ) ||
      // Generated OG cards are named "<page>-og-image.webp" alongside the page.
      /-og-image\.(webp|png|jpe?g)$/.test(rel) ||
      /\.(js|css|map|woff2?|ttf)$/.test(rel)
    ) {
      continue
    }

    // Media in the output must be a traced attachment.
    if (isMedia(rel)) {
      const base = path.basename(rel)
      if (!allowedAttachments.has(base)) {
        fail(
          `Untraced media in public/: ${rel}. No published note references it — ` +
            `this is how a private note's attachment reaches the web.`,
        )
      }
      continue
    }

    // Everything else should be a page. Pages are either a published note,
    // or a Quartz-generated listing (tags/, folder indexes, OG cards).
    if (rel.endsWith(".html") || rel.endsWith(".webp") || rel.endsWith(".png")) {
      const segments = rel.split(path.sep)
      const head = segments[0]
      if (head === "tags" || head === "og-image" || head === "social-images") continue
      const slug = rel.endsWith(path.sep + "index.html")
        ? segments.slice(0, -1).join("/")
        : rel.replace(/\.html$/, "")
      if (allowedSlugs.has(slug) || allowedSlugs.has(head)) continue
      // Folder listing pages are generated for any folder that holds notes;
      // with flat slugs the only legitimate one is the root.
      fail(`Page in public/ with no published source: ${rel} (slug "${slug}")`)
      continue
    }

    fail(`Unclassified file in public/: ${rel}`)
  }
}

/**
 * Warns when the vault has notes marked `publish: true` that were never synced.
 *
 * `npm run build` deliberately does NOT sync — CI has no vault, and sync is the
 * one step that reads it. The failure mode is silent and confusing: you mark a
 * note in Obsidian, run build, and nothing changes, because the build only ever
 * sees `content/`.
 *
 * Non-fatal, and skipped entirely when the vault is not reachable, so CI is
 * unaffected.
 */
async function warnIfStale(manifest: Manifest) {
  let vault: string
  try {
    const mod = await import("./publish.config.js")
    vault = path.resolve(mod.default.vaultPath)
    await fs.stat(vault)
  } catch {
    return // no vault here (CI); nothing to compare against
  }

  const synced = new Set(manifest.notes.map((n) => n.slug))
  const marked: string[] = []
  for (const abs of await walk(vault)) {
    if (!abs.endsWith(".md")) continue
    let raw: string
    try {
      raw = await fs.readFile(abs, "utf8")
    } catch {
      continue
    }
    if (!/^---/.test(raw)) continue
    const { frontmatter } = splitFrontmatter(raw)
    if (!isPublished(frontmatter)) continue
    const title =
      typeof frontmatter.title === "string" && frontmatter.title.trim()
        ? frontmatter.title
        : path.basename(abs, ".md")
    const explicit = typeof frontmatter.slug === "string" ? frontmatter.slug : title
    if (!synced.has(slugify(explicit))) marked.push(path.relative(vault, abs))
  }

  if (marked.length) {
    console.warn(
      c.yellow(
        `\n⚠ ${marked.length} note(s) are marked \`publish: true\` but are NOT in this build:`,
      ),
    )
    for (const m of marked.slice(0, 10)) console.warn(c.yellow(`    ${m}`))
    if (marked.length > 10) console.warn(c.dim(`    … and ${marked.length - 10} more`))
    console.warn(
      c.yellow("  Run `npm run sync` first — `npm run build` does not read the vault.\n"),
    )
  }
}

async function main() {
  const mode = process.argv[2] ?? "content"
  const manifest = await loadManifest()

  console.log(c.dim(`\naudit ${mode} — manifest generated ${manifest.generatedAt}`))

  if (mode === "content") {
    await auditContent(manifest)
    await warnIfStale(manifest)
  } else if (mode === "output") await auditOutput(manifest)
  else if (mode === "all") {
    await auditContent(manifest)
    await auditOutput(manifest)
  } else {
    console.error(c.red(`Unknown mode "${mode}". Use: content | output | all`))
    process.exit(1)
  }

  if (failures.length) {
    console.error(
      c.red(c.bold(`\n✗ PUBLISH SAFETY CHECK FAILED — ${failures.length} finding(s)\n`)),
    )
    for (const f of failures) console.error(c.red(`  ✗ ${f}`))
    console.error(c.red(c.bold(`\n  Refusing to continue. Nothing here should reach the web.\n`)))
    process.exit(1)
  }

  const n = manifest.notes.length
  console.log(c.green(`✓ audit ${mode} passed — ${n} published note(s), nothing unexpected.\n`))
}

await main()
