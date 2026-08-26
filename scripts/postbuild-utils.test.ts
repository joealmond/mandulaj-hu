import { test } from "node:test"
import assert from "node:assert/strict"
import { normaliseArticleHeadings } from "./postbuild-utils.ts"

test("article headings starting at h3 shift up while preserving structure and ids", () => {
  const html = '<h3>Chrome</h3><article><h3 id="a">A</h3><h4 id="b">B</h4></article>'
  assert.equal(
    normaliseArticleHeadings(html),
    '<h3>Chrome</h3><article><h2 id="a">A</h2><h3 id="b">B</h3></article>',
  )
})

test("an article body starting at h1 shifts down beneath the page h1", () => {
  const html = '<article class="note"><h1 id="a">A</h1><h2>B</h2></article>'
  assert.equal(
    normaliseArticleHeadings(html),
    '<article class="note"><h2 id="a">A</h2><h3>B</h3></article>',
  )
})

test("an article already starting at h2 is unchanged", () => {
  const html = "<article><h2>A</h2><h4>B</h4></article>"
  assert.equal(normaliseArticleHeadings(html), html)
})
