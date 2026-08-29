/**
 * Regression guards for the panel's browser script and mobile explorer CSS.
 * The browser script lives inside a template literal, so these source checks
 * complement the real-browser verification used for layout changes.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const SRC = fs.readFileSync(path.resolve(import.meta.dirname, "src/index.tsx"), "utf8")
const CSS = fs.readFileSync(path.resolve(import.meta.dirname, "../../theme/custom.scss"), "utf8")

test("panel state is reapplied after Quartz client-side navigation", () => {
  assert.match(SRC, /function wirePanel\(\)/)
  assert.match(SRC, /document\.addEventListener\("nav", wirePanel\)/)
  assert.match(SRC, /localStorage\.getItem\(KEY\)/)
  assert.match(SRC, /if \(!root\.dataset\.panelWired\)/)
})

test("mobile Tree uses the inline panel instead of Quartz's full-screen drawer", () => {
  assert.match(
    CSS,
    /body\[data-panel="explorer"\] \.sidebar\.left \.explorer \.mobile-explorer\s*\{\s*display:\s*none/,
  )
  assert.match(
    CSS,
    /body\[data-panel="explorer"\][^\n]*\.explorer-content[\s\S]*?position:\s*static/,
  )
  assert.match(
    CSS,
    /body\[data-panel="explorer"\][\s\S]*?\.explorer-content[\s\S]*?transform:\s*none/,
  )
})
