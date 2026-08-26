/**
 * Turnstile verification must satisfy THREE conditions, not one.
 *
 * `success: true` alone is not enough: it only says a challenge was solved
 * somewhere, by someone, for some widget. These pin the other two.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { allowedTurnstileHostnames, verifyTurnstile } from "./lib.ts"

/** Stubs siteverify with a fixed response body. */
function withSiteverify<T>(body: unknown, status = 200, run: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch
  return run().finally(() => {
    globalThis.fetch = real
  })
}

const HOSTS = ["mandulaj.hu"]

test("accepts only when success, action and hostname all match", async () => {
  await withSiteverify(
    { success: true, action: "comment", hostname: "mandulaj.hu" },
    200,
    async () => {
      const r = await verifyTurnstile("secret", "token", "1.2.3.4", HOSTS, "comment")
      assert.equal(r.ok, true)
    },
  )
})

test("rejects a solved challenge from the wrong widget action", async () => {
  await withSiteverify(
    { success: true, action: "newsletter", hostname: "mandulaj.hu" },
    200,
    async () => {
      const r = await verifyTurnstile("secret", "token", "1.2.3.4", HOSTS, "comment")
      assert.equal(r.ok, false)
      assert.match(r.reason ?? "", /action mismatch/)
    },
  )
})

test("rejects a token farmed on someone else's page", async () => {
  await withSiteverify(
    { success: true, action: "comment", hostname: "evil.example.com" },
    200,
    async () => {
      const r = await verifyTurnstile("secret", "token", "1.2.3.4", HOSTS, "comment")
      assert.equal(r.ok, false)
      assert.match(r.reason ?? "", /hostname not allowed/)
    },
  )
})

test("rejects an unsolved challenge and reports the error codes", async () => {
  await withSiteverify(
    { success: false, "error-codes": ["invalid-input-response"] },
    200,
    async () => {
      const r = await verifyTurnstile("secret", "token", "1.2.3.4", HOSTS, "comment")
      assert.equal(r.ok, false)
      assert.match(r.reason ?? "", /invalid-input-response/)
    },
  )
})

test("fails closed on every degenerate input", async () => {
  const cases: [string, () => Promise<{ ok: boolean }>][] = [
    ["no secret", () => verifyTurnstile(undefined, "t", "ip", HOSTS, "comment")],
    ["no token", () => verifyTurnstile("s", "", "ip", HOSTS, "comment")],
    ["non-string token", () => verifyTurnstile("s", 42, "ip", HOSTS, "comment")],
    ["oversized token", () => verifyTurnstile("s", "x".repeat(9999), "ip", HOSTS, "comment")],
    ["no allowed hostnames", () => verifyTurnstile("s", "t", "ip", [], "comment")],
  ]
  for (const [name, run] of cases) {
    assert.equal((await run()).ok, false, name)
  }
})

test("fails closed when siteverify errors or is unreachable", async () => {
  await withSiteverify({}, 500, async () => {
    const r = await verifyTurnstile("s", "t", "ip", HOSTS, "comment")
    assert.equal(r.ok, false)
    assert.match(r.reason ?? "", /HTTP 500/)
  })

  const real = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new Error("network down")
  }) as typeof fetch
  try {
    const r = await verifyTurnstile("s", "t", "ip", HOSTS, "comment")
    assert.equal(r.ok, false)
    assert.match(r.reason ?? "", /unreachable/)
  } finally {
    globalThis.fetch = real
  }
})

test("allowed hostnames cover the bootstrap host as well as the final domain", () => {
  const env = { SITE_ORIGIN: "https://mandulaj.hu", TURNSTILE_HOSTNAMES: "" } as never
  const onWorkersDev = allowedTurnstileHostnames(
    env,
    new Request("https://mandulaj-hu.someacct.workers.dev/api/comments"),
  )
  assert.ok(onWorkersDev.includes("mandulaj-hu.someacct.workers.dev"), "serving host allowed")
  assert.ok(onWorkersDev.includes("mandulaj.hu"), "final domain allowed")
})

test("an explicit hostname list overrides the defaults", () => {
  const env = { SITE_ORIGIN: "https://mandulaj.hu", TURNSTILE_HOSTNAMES: "mandulaj.hu" } as never
  const hosts = allowedTurnstileHostnames(
    env,
    new Request("https://mandulaj-hu.someacct.workers.dev/api/comments"),
  )
  assert.deepEqual(hosts, ["mandulaj.hu"], "pinning excludes the serving host")
})

test("the documented test key is accepted, and only via its own marker", async () => {
  // What Cloudflare actually returns for the always-pass test secret:
  // hostname example.com, no action, plus an explicit marker.
  await withSiteverify(
    {
      success: true,
      hostname: "example.com",
      "error-codes": [],
      metadata: { result_with_testing_key: true },
    },
    200,
    async () => {
      const r = await verifyTurnstile("test-secret", "token", "1.2.3.4", HOSTS, "comment")
      assert.equal(r.ok, true, "local development must keep working")
    },
  )

  // The SAME shape without the marker must still be rejected — otherwise
  // "example.com with no action" would be a bypass anyone could forge.
  await withSiteverify(
    { success: true, hostname: "example.com", "error-codes": [] },
    200,
    async () => {
      const r = await verifyTurnstile("real-secret", "token", "1.2.3.4", HOSTS, "comment")
      assert.equal(r.ok, false, "no marker, no exemption")
      assert.match(r.reason ?? "", /action mismatch/)
    },
  )
})
