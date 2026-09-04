import { test } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { h } from "preact"
import renderToString from "preact-render-to-string"
import { tsImport } from "tsx/esm/api"
const { default: PagefindSearch } = await tsImport("./src/index.tsx", {
  parentURL: import.meta.url,
  tsconfig: new URL("../../../tsconfig.project.json", import.meta.url).pathname,
})
const tick = (ms = 160) => new Promise((resolve) => setTimeout(resolve, ms))
const hit = (title) => ({
  results: [
    { data: async () => ({ url: "/note.html", meta: { title }, excerpt: "A <mark>note</mark>" }) },
  ],
})
function harness(loader) {
  const Component = PagefindSearch()
  const dom = new JSDOM(renderToString(h(Component, {})), {
    url: "https://example.test/about",
    runScripts: "outside-only",
  })
  const { window } = dom
  const cleanup = []
  window.addCleanup = (fn) => cleanup.push(fn)
  // Replace only the browser module-loading boundary; exercise the shipped UI script.
  window.loadPagefind = loader
  const script = Component.afterDOMLoaded.replace(
    'import(/* webpackIgnore: true */ "/pagefind/pagefind.js")',
    "window.loadPagefind()",
  )
  assert.notEqual(script, Component.afterDOMLoaded)
  window.eval(script)
  const input = window.document.querySelector(".pf-input")
  const query = (value) => {
    input.value = value
    input.dispatchEvent(new window.Event("input"))
  }
  return { dom, window, document: window.document, cleanup, query }
}

test("search retries an unavailable index and clears outdated results immediately", async () => {
  let attempts = 0
  let finish
  const h = harness(async () => {
    if (++attempts === 1) throw new Error("offline")
    return {
      options: async () => {},
      filters: async () => ({}),
      search: async (q) =>
        q === "later"
          ? new Promise((resolve) => {
              finish = resolve
            })
          : hit(q),
    }
  })
  try {
    h.query("first")
    await tick()
    assert.match(h.document.querySelector(".pf-status").textContent, /index unavailable/)
    h.query("recovered")
    await tick()
    assert.equal(h.document.querySelector(".pf-title").textContent, "recovered")
    h.query("later")
    assert.equal(h.document.querySelectorAll(".pf-list li").length, 0)
    await tick()
    h.document.querySelector(".pf-clear").click()
    finish(hit("obsolete"))
    await tick(20)
    assert.equal(h.document.querySelectorAll(".pf-list li").length, 0)
    assert.equal(h.document.querySelector(".pf-results").hidden, true)
  } finally {
    h.dom.window.close()
  }
})

test("navigation restores the sidebar and ignores an old index failure", async () => {
  let fail
  let attempts = 0
  const h = harness(() =>
    ++attempts === 1
      ? new Promise((_, reject) => {
          fail = reject
        })
      : Promise.resolve({
          options: async () => {},
          filters: async () => ({}),
          search: async (q) => hit(q),
        }),
  )
  try {
    h.query("old")
    await tick()
    for (const cleanup of h.cleanup.splice(0)) cleanup()
    assert.equal(h.document.body.getAttribute("data-searching"), "false")
    h.document.dispatchEvent(new h.window.Event("nav"))
    h.query("new")
    await tick()
    fail(new Error("late offline"))
    await tick(20)
    assert.equal(h.document.querySelector(".pf-title").textContent, "new")
    assert.equal(h.document.querySelector(".pf-status").textContent, "1 result")
  } finally {
    h.dom.window.close()
  }
})
