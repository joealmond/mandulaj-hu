import assert from "node:assert/strict"
import { test } from "node:test"
import { Graph, deferMobileGraphLibraries } from "./src/index"

test("mobile graph defers its third-party libraries behind an explicit button", () => {
  const script = Graph().afterDOMLoaded
  if (typeof script !== "string") {
    throw new TypeError("The pinned graph plugin must expose one browser script")
  }

  assert.match(script, /className = "graph-load"/)
  assert.match(script, /Load graph view/)
  assert.match(script, /max-width: 800px/)
  assert.ok(script.indexOf("graph-load") < script.indexOf("cdn.jsdelivr.net/npm/d3"))
})

test("graph wrapper fails closed when the pinned upstream loader changes", () => {
  assert.throws(
    () => deferMobileGraphLibraries("an unfamiliar graph script"),
    /upstream graph loader changed/,
  )
})
