#!/usr/bin/env tsx
/**
 * Post-build fixes that Quartz's plugins don't cover.
 *
 *  1. RSS: drop tag-listing pages and the home page from the feed. The
 *     content-index plugin feeds every emitted page into the RSS index, so a
 *     subscriber would otherwise see "nestjs" and "learning" arrive as posts.
 *  2. robots.txt: Quartz emits a sitemap but no robots.txt to point at it.
 *  3. <link rel="alternate">: Quartz does not emit feed autodiscovery, so
 *     browsers and readers cannot find the feed from a page.
 *  4. Heading order: normalize body headings beneath the page H1 and promote
 *     bare sidebar H3 labels to H2.
 *  5. CSS bundling: Quartz emits one stylesheet per component — 23 separate
 *     render-blocking requests on a note page. They are concatenated into a
 *     single file, in the original head order so the cascade is preserved.
 *  6. Strips an invalid `aria-expanded` off the explorer container (upstream).
 */
import "./env.js"
import fs from "node:fs/promises"
import { createHash } from "node:crypto"
import path from "node:path"
import { c, walk } from "./lib.js"
import { normaliseArticleHeadings } from "./postbuild-utils.js"

const REPO = path.resolve(import.meta.dirname, "..")
const PUBLIC = path.join(REPO, "public")

async function readConfigBaseUrl(): Promise<string> {
  const yaml = await fs.readFile(path.join(REPO, "quartz.config.yaml"), "utf8")
  const m = yaml.match(/^\s*baseUrl:\s*(.+)$/m)
  return (m?.[1] ?? "").trim().replace(/^["']|["']$/g, "")
}

async function filterFeed(baseUrl: string) {
  const feed = path.join(PUBLIC, "index.xml")
  let xml: string
  try {
    xml = await fs.readFile(feed, "utf8")
  } catch {
    return
  }

  const before = (xml.match(/<item>/g) ?? []).length
  const root = `https://${baseUrl}/`

  xml = xml.replace(/<item>[\s\S]*?<\/item>/g, (item) => {
    const link = item.match(/<link>(.*?)<\/link>/)?.[1] ?? ""
    if (link.includes("/tags/") || link === root || link === `https://${baseUrl}`) return ""
    return item
  })

  const after = (xml.match(/<item>/g) ?? []).length
  await fs.writeFile(feed, xml, "utf8")
  if (before !== after) {
    console.log(c.dim(`  rss → ${after} item(s), dropped ${before - after} non-note page(s)`))
  }
}

/**
 * Copies _headers into the asset directory. Cloudflare reads it from the root
 * of the served assets; it lives in quartz-custom/pages/ so it is version
 * controlled next to the other site furniture rather than inside generated
 * output.
 */
async function copyHeaders() {
  const src = path.join(REPO, "quartz-custom", "pages", "_headers")
  const base = await fs.readFile(src, "utf8")
  const hashed = (await walk(PUBLIC))
    .map((file) => path.relative(PUBLIC, file).split(path.sep).join("/"))
    .filter((file) => !file.startsWith("pagefind/") && /-[a-f0-9]{8,}\.(js|css|woff2?)$/.test(file))
    .sort()
  // Cloudflare allows 100 rules. Never silently drop security/cache policy.
  if (hashed.length + 2 > 100)
    throw new Error("Too many immutable asset rules; move hashed assets into a dedicated directory")
  const rules = hashed.map(
    (file) => `/${file}\n  Cache-Control: public, max-age=31536000, immutable\n`,
  )
  await fs.writeFile(path.join(PUBLIC, "_headers"), base + "\n" + rules.join("\n"))
  console.log(c.dim(`  _headers → ${hashed.length} immutable assets; other URLs revalidate`))
}

async function writeRobots(baseUrl: string) {
  const body = [
    "User-agent: *",
    "Allow: /",
    "",
    "# Nothing here is private — this site only ever contains notes explicitly",
    "# marked `publish: true`. See scripts/audit.ts.",
    "",
    `Sitemap: https://${baseUrl}/sitemap.xml`,
    "",
  ].join("\n")
  await fs.writeFile(path.join(PUBLIC, "robots.txt"), body, "utf8")
  console.log(c.dim("  robots.txt → written"))
}

/**
 * Drops the preconnect to cdnjs.cloudflare.com that obsidian-flavored-markdown
 * emits for mermaid. Nothing on this site is ever fetched from that host, so
 * it costs a TCP + TLS handshake for no payload. If you start using mermaid
 * diagrams, remove this.
 */
function dropUnusedPreconnect(html: string): string {
  return html.replace(/<link[^>]+rel="preconnect"[^>]+cdnjs\.cloudflare\.com[^>]*\/?>/g, "")
}

/** Bare <h3>Label</h3> in the chrome → <h2>. Article headings carry an id. */
function fixHeadingOrder(html: string): string {
  return html.replace(/<h3>([^<]{1,60})<\/h3>/g, '<h2 class="sidebar-heading">$1</h2>')
}

/**
 * Marks long titles so the theme can drop a type step.
 *
 * The H1 is uppercased by CSS, never in the source string — the same title
 * stays sentence case in the sidebar, breadcrumb, RSS and og:title. One title,
 * one display rule. But all-caps at display size stops reading as a signature
 * once it wraps to four or five lines, and CSS cannot count characters.
 */
const LONG_TITLE = 60
function markLongTitles(html: string): string {
  return html.replace(/<h1 class="article-title">([^<]*)<\/h1>/g, (raw, title: string) =>
    title.trim().length > LONG_TITLE ? `<h1 class="article-title is-long">${title}</h1>` : raw,
  )
}

/**
 * Turnstile SITE keys look like `0x4AAAAAAA…`; the documented test keys use the
 * `1x`/`2x`/`3x` prefixes. Anything else is not a site key.
 *
 * This guard exists because a Cloudflare API token (`cfut_…`) was once pasted
 * into TURNSTILE_SITE_KEY and published as a meta tag on every page. Cloudflare
 * hands out several credential types from the same dashboard and nothing about
 * them says which slot they belong in, so the only safe assumption is that an
 * unrecognised value is a credential rather than a site key.
 *
 * Fails the build rather than skipping injection: silently dropping the key
 * would leave comments mysteriously off, which is the failure mode that hid the
 * unloaded .env for so long.
 */
const TURNSTILE_SITE_KEY_RE = /^[0-3]x[A-Za-z0-9_-]{20,}$/

export function assertTurnstileSiteKey(key: string): void {
  if (!key) return // Unset is a supported state: the comment form stays hidden.
  if (TURNSTILE_SITE_KEY_RE.test(key)) return

  const looksLikeCredential = /^(cfut_|cfsk_|v1\.0-)/.test(key)
  throw new Error(
    `TURNSTILE_SITE_KEY does not look like a Turnstile site key.\n` +
      `  got:      ${key.slice(0, 6)}… (${key.length} chars)\n` +
      `  expected: 0x4AAAAAAA… (or a 1x/2x/3x test key)\n` +
      (looksLikeCredential
        ? `  This looks like a Cloudflare API token or secret. It would have been\n` +
          `  published in the HTML of every page. Revoke it if it is real.\n`
        : "") +
      `  The site key is in the Turnstile dashboard next to the secret key.`,
  )
}

/**
 * Injects the Turnstile SITE key (public, not a secret) as a meta tag.
 *
 * It has to reach the browser somehow and the component is bundled at build
 * time, so a meta tag is the simplest env-configurable channel. With the key
 * unset the comment form stays hidden and the page says so — the build never
 * fails over it.
 */
function injectTurnstileKey(html: string, key: string): string {
  if (!key || html.includes('name="turnstile-site-key"')) return html
  return html.replace("</head>", `<meta name="turnstile-site-key" content="${key}"/></head>`)
}

/**
 * Concatenates every render-blocking <link rel="stylesheet"> into one file.
 *
 * Quartz emits a stylesheet per component, which on a throttled mobile
 * connection costs 150–300ms each. Order is preserved exactly as it appeared
 * in <head>, so the cascade is unchanged. The bundle is content-hashed and
 * served with the immutable cache header from vercel.json.
 */
async function bundleCss(): Promise<void> {
  const files = await collectHtml(PUBLIC)
  const linkRe = /<link\s+href="([^"]+\.css)"\s+rel="stylesheet"[^>]*>/g

  // Every page shares the same component set, so one bundle serves all of them.
  const seen: string[] = []
  const first = await fs.readFile(files[0], "utf8")
  for (const m of first.matchAll(linkRe)) seen.push(m[1])
  if (seen.length < 2) return

  const parts: string[] = []
  for (const href of seen) {
    const rel = href.replace(/^\.?\//, "")
    try {
      parts.push(`/* ${rel} */\n` + (await fs.readFile(path.join(PUBLIC, rel), "utf8")))
    } catch {
      /* an absolute or missing href — leave that link alone */
    }
  }
  if (!parts.length) return

  const css = parts.join("\n")
  const hash = createHash("sha256").update(css).digest("hex").slice(0, 8)
  const name = `bundle-${hash}.css`
  await fs.writeFile(path.join(PUBLIC, name), css, "utf8")

  let pages = 0
  for (const file of files) {
    let html = await fs.readFile(file, "utf8")
    const links = [...html.matchAll(linkRe)]
    if (links.length < 2) continue
    // Replace the first with the bundle, drop the rest.
    html = html.replace(
      links[0][0],
      `<link href="/${name}" rel="stylesheet" type="text/css" data-persist="true"/>`,
    )
    for (const l of links.slice(1)) html = html.replace(l[0], "")
    // The preload hint pointed at the old first stylesheet.
    html = html.replace(
      /<link rel="preload" href="[^"]+\.css" as="style"\/?>/,
      `<link rel="preload" href="/${name}" as="style"/>`,
    )
    await fs.writeFile(file, html, "utf8")
    pages++
  }
  console.log(
    c.green(
      `  css → 1 bundle (${(css.length / 1024).toFixed(0)}KB) replacing ${seen.length} files on ${pages} page(s)`,
    ),
  )
}

async function collectHtml(dir: string, out: string[] = []): Promise<string[]> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) await collectHtml(full, out)
    else if (e.name.endsWith(".html")) out.push(full)
  }
  return out
}

async function addFeedDiscovery(baseUrl: string, turnstileKey: string) {
  const tag =
    `<link rel="alternate" type="application/rss+xml" ` +
    `title="József Mandula" href="https://${baseUrl}/index.xml"/>` +
    // Webmention endpoints. Harmless when webmention.io is not configured:
    // nothing on the page depends on them, they only tell other sites where to
    // deliver a mention.
    `<link rel="webmention" href="https://webmention.io/${baseUrl}/webmention"/>` +
    `<link rel="pingback" href="https://webmention.io/${baseUrl}/xmlrpc"/>`

  let touched = 0
  const walk = async (dir: string): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) await walk(full)
      else if (e.name.endsWith(".html")) {
        let html = await fs.readFile(full, "utf8")
        const before = html
        if (!html.includes('type="application/rss+xml"') && html.includes("</head>")) {
          html = html.replace("</head>", `${tag}</head>`)
        }
        html = fixHeadingOrder(html)
        // The error page's own title is its only H1; there is no header H1 above it.
        if (/<h1 class="article-title(?: [^"]*)?">/.test(html))
          html = normaliseArticleHeadings(html)
        html = dropUnusedPreconnect(html)
        html = injectTurnstileKey(html, turnstileKey)
        html = markLongTitles(html)
        if (html !== before) {
          await fs.writeFile(full, html, "utf8")
          touched++
        }
      }
    }
  }
  await walk(PUBLIC)
  console.log(c.dim(`  feed autodiscovery → ${touched} page(s)`))
  console.log(
    c.dim(
      turnstileKey
        ? "  turnstile site key → injected"
        : "  turnstile site key → unset, comment form stays hidden",
    ),
  )
}

async function main() {
  const turnstileKey = (process.env.TURNSTILE_SITE_KEY ?? "").trim()
  assertTurnstileSiteKey(turnstileKey)

  const baseUrl = await readConfigBaseUrl()
  if (!baseUrl) {
    console.error(c.red("✗ baseUrl missing from quartz.config.yaml"))
    process.exit(1)
  }
  await filterFeed(baseUrl)
  await writeRobots(baseUrl)
  await addFeedDiscovery(baseUrl, turnstileKey)
  await bundleCss()
  await copyHeaders()
}

// Importing this module exposes its validation helpers without touching the
// generated site. The post-build work only runs through `npm run finalize`.
if (process.argv[1] && path.resolve(process.argv[1]).endsWith("postbuild.ts")) {
  await main()
}
