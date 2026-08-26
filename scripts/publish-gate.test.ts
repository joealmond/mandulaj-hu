/**
 * Executable versions of the safety claims in README/ADR.
 *
 * These were previously demonstrated by hand and described in prose, which is
 * exactly the kind of guarantee that quietly stops being true. Run with
 * `npm test`.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  escapeProseHashtags,
  inlineTags,
  isMedia,
  isMoc,
  isPublished,
  parseMarkdownLinks,
  parseWikilinks,
  slugify,
  splitFrontmatter,
} from "./lib.ts"
import { updatePublishFlag } from "./toggle-publish.ts"

test('publish gate: only `true` and "true" publish', () => {
  const yes = [{ publish: true }, { publish: "true" }]
  for (const fm of yes) assert.equal(isPublished(fm), true, JSON.stringify(fm))

  // Everything else must fail CLOSED. A typo must never publish.
  const no = [
    {},
    { publish: false },
    { publish: "yes" },
    { publish: "True" },
    { publish: 1 },
    { publish: null },
    { publish: ["true"] },
    { Publish: true },
  ]
  for (const fm of no) assert.equal(isPublished(fm as never), false, JSON.stringify(fm))
})

test("publish gate: draft pulls a published note back", () => {
  assert.equal(isPublished({ publish: true, draft: true }), false)
  assert.equal(isPublished({ publish: true, draft: false }), true)
})

test("malformed frontmatter is never read as published", () => {
  // Broken YAML must not be salvaged into `publish: true`.
  const { frontmatter } = splitFrontmatter("---\npublish: true\n  bad: [unclosed\n---\n\nbody")
  assert.equal(isPublished(frontmatter), false)
})

test("tags come only from tag-only lines", () => {
  assert.deepEqual(inlineTags("#moc #index\n\nSome prose."), ["moc", "index"])
  // Mid-sentence hashtags are prose, not tags.
  assert.deepEqual(inlineTags("Use #codebase in Copilot chat."), [])
  // Code must never contribute tags.
  assert.deepEqual(inlineTags("```c\n#include <stdio.h>\n```"), [])
  assert.deepEqual(inlineTags("Colour is `#fff` here."), [])
})

test("prose hashtags are escaped, tag lines are not", () => {
  const out = escapeProseHashtags("#moc #index\n- use #codebase now\n")
  assert.match(out, /^#moc #index$/m, "tag-only line untouched")
  assert.match(out, /\\#codebase/, "prose hashtag escaped")
})

test("MOC detection reads the inline tag, not frontmatter alone", () => {
  assert.equal(isMoc({}, "#moc #index\n\nbody"), true)
  assert.equal(isMoc({ tags: ["moc"] }, "body"), true)
  assert.equal(isMoc({}, "just a note"), false)
})

test("slugify folds Hungarian diacritics", () => {
  assert.equal(slugify("Újfőcím"), "ujfocim")
  assert.equal(slugify("A vertical slice"), "a-vertical-slice")
  assert.equal(slugify("Trailing --- dashes--"), "trailing-dashes")
})

test('publish toggle treats YAML boolean and string "true" identically', () => {
  for (const value of ["true", '"true"']) {
    const raw = `---\ntitle: Example\npublish: ${value}\n---\n\nBody\n`
    const toggled = updatePublishFlag(raw)
    assert.equal(toggled.published, false)
    assert.equal(toggled.changed, true)
    assert.doesNotMatch(toggled.output, /^publish\s*:/m)
    assert.match(toggled.output, /^title: Example$/m)
  }
})

test("forced publish toggle is idempotent", () => {
  const raw = '---\npublish: "true"\n---\n\nBody\n'
  const result = updatePublishFlag(raw, true)
  assert.equal(result.changed, false)
  assert.equal(result.output, raw)
})

test("wikilink parsing preserves anchors and aliases", () => {
  const [a] = parseWikilinks("see [[Some Note#Heading|the alias]] here")
  assert.equal(a.target, "Some Note")
  assert.equal(a.anchor, "#Heading")
  assert.equal(a.alias, "the alias")
  assert.equal(a.isEmbed, false)

  const [b] = parseWikilinks("![[diagram.png|300]]")
  assert.equal(b.isEmbed, true)
  assert.equal(b.target, "diagram.png")
  assert.equal(b.alias, "300", "image width must survive as the alias")
})

test("markdown link parsing skips external and anchor targets", () => {
  const targets = parseMarkdownLinks(
    "[a](./local.md) [b](https://example.com) [c](#frag) [d](//cdn) ![e](img/x.png)",
  ).map((l) => l.target)
  assert.deepEqual(targets, ["./local.md", "img/x.png"])
})

test("media detection covers what sync will copy", () => {
  for (const yes of ["a.png", "b.JPG", "c.pdf", "d.mp4", "e.webp", "f.m4a"]) {
    assert.equal(isMedia(yes), true, yes)
  }
  for (const no of ["note.md", "script.ts", "noext", "a.mdx"]) {
    assert.equal(isMedia(no), false, no)
  }
})
