import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { JSDOM } from "jsdom"

const root = path.resolve(import.meta.dirname, "../public")
const walk = async (dir) =>
  (
    await Promise.all(
      (await fs.readdir(dir, { withFileTypes: true })).map(async (e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
      ),
    )
  ).flat()
const files = await walk(root)
const exists = async (pathname) => {
  const base = path.join(root, decodeURIComponent(pathname))
  for (const candidate of [base, base + ".html", path.join(base, "index.html")]) {
    try {
      if ((await fs.stat(candidate)).isFile()) return true
    } catch {}
  }
  return false
}
let checked = 0
for (const file of files.filter((f) => f.endsWith(".html"))) {
  const rel = path.relative(root, file)
  const route = rel
    .replace(/(^|\/)index\.html$/, "")
    .replace(/\.html$/, "")
    .replace(/\/$/, "")
  const dom = new JSDOM(await fs.readFile(file, "utf8"), { url: "https://mandulaj.hu/" + route })
  const doc = dom.window.document
  assert.equal(
    doc.querySelectorAll("main,[role=main]").length,
    1,
    `${rel}: exactly one main landmark`,
  )
  assert.equal(doc.querySelectorAll("h1").length, 1, `${rel}: exactly one page title`)
  assert.ok(doc.title.trim(), `${rel}: document title`)
  for (const el of doc.querySelectorAll("a[href],script[src],link[href],img[src]")) {
    const raw = el.getAttribute("href") ?? el.getAttribute("src")
    if (!raw || raw.startsWith("#")) continue
    const url = new URL(raw, dom.window.location.href)
    if (url.origin !== "https://mandulaj.hu") continue
    assert.ok(await exists(url.pathname), `${rel}: missing local target ${raw}`)
  }
  const like = doc.querySelector(".eng-like-btn")
  if (like)
    assert.ok(like.getAttribute("aria-label"), `${rel}: like control has a descriptive name`)
  dom.window.close()
  checked++
}
const headers = await fs.readFile(path.join(root, "_headers"), "utf8")
const rules = []
for (const line of headers.split("\n")) {
  if (!line.trim() || line.startsWith("#")) continue
  if (!/^\s/.test(line)) rules.push({ pattern: line.trim(), cache: [] })
  else if (/cache-control:/i.test(line)) rules.at(-1).cache.push(line.trim())
}
assert.ok(rules.length <= 100, "Cloudflare header rule limit")
for (const rule of rules.filter((r) => r.cache.length)) {
  assert.equal(rule.cache.length, 1, "One cache policy per rule")
  assert.ok(!rule.pattern.includes("*"), "Cache overrides must target exact hashed files")
  assert.match(rule.pattern, /-[a-f0-9]{8,}\.(js|css|woff2?)$/)
  assert.ok(!rule.pattern.startsWith("/pagefind/"), "Pagefind must revalidate")
  assert.ok(await exists(rule.pattern), "Cache rule names an emitted file")
}
assert.ok(
  files.some((f) => f.endsWith("/pagefind/pagefind.js")),
  "Search index was generated",
)
console.log(
  `Verified ${checked} HTML pages: landmarks, titles, local targets, accessible like controls, cache rules and search output.`,
)
