import { test } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { h } from "preact"
import renderToString from "preact-render-to-string"
import { tsImport } from "tsx/esm/api"
const { default: Engagement } = await tsImport("./src/index.tsx", {
  parentURL: import.meta.url,
  tsconfig: new URL("../../../tsconfig.project.json", import.meta.url).pathname,
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 20))
function harness(fetch) {
  const Component = Engagement()
  const markup = renderToString(h(Component, { fileData: { slug: "about" } }))
  const dom = new JSDOM('<meta name="turnstile-site-key" content="test-site-key">' + markup, {
    url: "https://example.test/about",
    runScripts: "outside-only",
  })
  const cleanup = []
  dom.window.addCleanup = (fn) => cleanup.push(fn)
  dom.window.fetch = fetch
  dom.window.eval(Component.afterDOMLoaded)
  return { dom, window: dom.window, document: dom.window.document, cleanup, markup }
}

test("failed like rolls back, shows an error and ignores old local storage", async () => {
  let posted
  const h = harness(async (url, init) => {
    if (init?.method === "POST") {
      posted = JSON.parse(init.body)
      return Response.json({ error: "Slow down" }, { status: 429 })
    }
    return Response.json(url.includes("/likes") ? { count: 1, liked: false } : { comments: [] })
  })
  try {
    h.window.localStorage.setItem("eng-liked:about", "true")
    await tick()
    const button = h.document.querySelector(".eng-like-btn")
    assert.equal(button.getAttribute("aria-pressed"), "false")
    button.click()
    await tick()
    assert.deepEqual(posted, { slug: "about", liked: true })
    assert.equal(button.getAttribute("aria-pressed"), "false")
    assert.equal(h.document.querySelector(".eng-count").textContent, "1")
    assert.equal(h.document.querySelector(".eng-feedback").textContent, "Slow down")
    assert.equal(button.disabled, false)
  } finally {
    h.dom.window.close()
  }
})

test("SPA navigation cleans listeners even when the same engagement DOM is reused", async () => {
  let posts = 0
  const h = harness(async (url, init) => {
    if (init?.method === "POST") {
      posts++
      return Response.json({ count: 1, liked: true })
    }
    return Response.json(url.includes("/likes") ? { count: 0, liked: false } : { comments: [] })
  })
  try {
    await tick()
    for (const cleanup of h.cleanup.splice(0)) cleanup()
    h.document.querySelector(".eng").dataset.slug = "second-page"
    h.document.dispatchEvent(new h.window.Event("nav"))
    await tick()
    h.document.querySelector(".eng-like-btn").click()
    await tick()
    assert.equal(posts, 1)
  } finally {
    h.dom.window.close()
  }
})

test("failed delete re-enables its control and announces the failure", async () => {
  const h = harness(async (url, init) => {
    if (init?.method === "DELETE") return Response.json({ error: "Denied" }, { status: 403 })
    return Response.json(
      url.includes("/likes")
        ? { count: 0, liked: false }
        : {
            comments: [
              {
                id: "one",
                parent_id: null,
                name: "Reader",
                body: "<script>not markup</script>",
                created_at: 1,
              },
            ],
          },
    )
  })
  try {
    h.window.localStorage.setItem("eng-tokens", JSON.stringify({ one: "token" }))
    await tick()
    const button = h.document.querySelector(".eng-del")
    button.click()
    await tick()
    assert.equal(button.disabled, false)
    assert.match(h.document.querySelector(".eng-feedback").textContent, /Could not delete/)
    assert.equal(h.document.querySelectorAll(".eng-body script").length, 0)
  } finally {
    h.dom.window.close()
  }
})

test("a late like response cannot overwrite the next page", async () => {
  let finish
  const h = harness(async (url, init) => {
    if (init?.method === "POST")
      return new Promise((resolve) => {
        finish = resolve
      })
    return Response.json(url.includes("/likes") ? { count: 0, liked: false } : { comments: [] })
  })
  try {
    await tick()
    h.document.querySelector(".eng-like-btn").click()
    for (const cleanup of h.cleanup.splice(0)) cleanup()
    h.document.querySelector(".eng").dataset.slug = "next"
    h.document.dispatchEvent(new h.window.Event("nav"))
    await tick()
    finish(Response.json({ count: 9, liked: true }))
    await tick()
    assert.equal(h.document.querySelector(".eng-count").textContent, "0")
    assert.equal(h.document.querySelector(".eng-like-btn").getAttribute("aria-pressed"), "false")
  } finally {
    h.dom.window.close()
  }
})

test("verified comment posts, appears immediately, and can be deleted", async () => {
  let comments = []
  let resets = 0
  const h = harness(async (url, init) => {
    if (init?.method === "POST") {
      const data = JSON.parse(init.body)
      assert.equal(data.turnstileToken, "fixture-token")
      const comment = {
        id: "new-comment",
        parent_id: null,
        name: data.name,
        body: data.body,
        created_at: 1,
        is_owner: 0,
      }
      comments.push(comment)
      return Response.json({ ...comment, editToken: "fixture-delete-token" })
    }
    if (init?.method === "DELETE") {
      comments = []
      return Response.json({ ok: true })
    }
    return Response.json(url.includes("/likes") ? { count: 0, liked: false } : { comments })
  })
  try {
    h.window.turnstile = {
      render(_el, opts) {
        opts.callback("fixture-token")
        return "widget-one"
      },
      reset(id) {
        assert.equal(id, "widget-one")
        resets++
      },
    }
    await tick()
    h.document.querySelector(".eng-first").click()
    h.document.querySelector("#eng-name").value = "Reader"
    h.document.querySelector("#eng-body").value = "A useful note."
    h.document
      .querySelector("form")
      .dispatchEvent(new h.window.Event("submit", { cancelable: true }))
    await tick()
    assert.equal(h.document.querySelector(".eng-body").textContent, "A useful note.")
    assert.equal(h.document.querySelector(".eng-note").textContent, "Posted.")
    assert.equal(resets, 1)
    h.document.querySelector(".eng-del").click()
    await tick()
    assert.equal(h.document.querySelectorAll(".eng-item").length, 0)
    assert.equal(h.document.querySelector(".eng-head-count").textContent, "(0)")
  } finally {
    h.dom.window.close()
  }
})

test("a late comment saves its delete token without erasing the next page's draft", async () => {
  let finish
  const h = harness(async (url, init) => {
    if (init?.method === "POST")
      return new Promise((resolve) => {
        finish = resolve
      })
    return Response.json(url.includes("/likes") ? { count: 0, liked: false } : { comments: [] })
  })
  try {
    h.window.turnstile = {
      render(_el, opts) {
        opts.callback("token")
        return "widget"
      },
      remove() {},
      reset() {
        assert.fail("Removed widget must not reset")
      },
    }
    await tick()
    h.document.querySelector(".eng-first").click()
    h.document.querySelector("#eng-name").value = "Reader"
    h.document.querySelector("#eng-body").value = "Old page comment"
    h.document
      .querySelector("form")
      .dispatchEvent(new h.window.Event("submit", { cancelable: true }))
    await tick()
    for (const cleanup of h.cleanup.splice(0)) cleanup()
    h.document.querySelector(".eng").dataset.slug = "next-page"
    h.document.dispatchEvent(new h.window.Event("nav"))
    h.document.querySelector("#eng-body").value = "Next page draft"
    finish(Response.json({ id: "old-comment", editToken: "delete-token" }))
    await tick()
    assert.equal(h.document.querySelector("#eng-body").value, "Next page draft")
    assert.equal(h.document.querySelector(".eng-note").textContent, "")
    assert.equal(h.document.querySelector(".eng-submit").disabled, false)
    assert.equal(
      JSON.parse(h.window.localStorage.getItem("eng-tokens"))["old-comment"],
      "delete-token",
    )
  } finally {
    h.dom.window.close()
  }
})
