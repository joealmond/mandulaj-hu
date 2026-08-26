import { env } from "cloudflare:workers"
import { createExecutionContext } from "cloudflare:test"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import worker from "./index"
import { isRateLimited } from "./lib"

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>

async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  const request = new IncomingRequest(`https://mandulaj.hu${path}`, init)
  return worker.fetch(request, env, createExecutionContext())
}

describe("API Worker", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM rate_limit"),
      env.DB.prepare("DELETE FROM like_votes"),
      env.DB.prepare("DELETE FROM likes"),
      env.DB.prepare("DELETE FROM comments"),
    ])
  })

  afterEach(() => vi.unstubAllGlobals())

  it("keeps visitor-specific like state out of shared caches", async () => {
    await env.DB.prepare("INSERT INTO likes (slug, count, updated_at) VALUES (?, ?, ?)")
      .bind("algorithms", 7, Date.now())
      .run()

    const response = await fetchApi("/api/likes?slug=algorithms", {
      headers: { "cf-connecting-ip": "203.0.113.10", "user-agent": "test" },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, max-age=30")
    expect(await response.json()).toEqual({ slug: "algorithms", count: 7, liked: false })
  })

  it("does not grant CORS access to arbitrary workers.dev or lookalike origins", async () => {
    for (const origin of ["https://attacker.workers.dev", "https://mandulaj.hu.example.com"]) {
      const response = await fetchApi("/api/likes?slug=algorithms", {
        headers: { origin },
      })
      expect(response.headers.has("access-control-allow-origin")).toBe(false)
    }

    const local = await fetchApi("/api/likes?slug=algorithms", {
      headers: { origin: "http://localhost:3000" },
    })
    expect(local.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
  })

  it("rejects non-JSON and oversized request bodies before parsing", async () => {
    const nonJson = await fetchApi("/api/likes", { method: "POST", body: "slug=algorithms" })
    expect(nonJson.status).toBe(415)

    const oversized = await fetchApi("/api/likes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "algorithms", padding: "x".repeat(17_000) }),
    })
    expect(oversized.status).toBe(413)
  })

  it("rejects replies whose parent is not visible on the same page", async () => {
    const response = await fetchApi("/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "algorithms",
        name: "Reader",
        body: "A thoughtful reply",
        parentId: "f61b7c5c-77f6-45aa-a80a-b9791e81aeca",
        turnstileToken: "not-reached",
      }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Parent comment was not found" })
  })

  it("rejects unknown pages before creating rows", async () => {
    const response = await fetchApi("/api/likes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "does-not-exist" }),
    })
    expect(response.status).toBe(404)
  })

  it("toggles a D1 like on and back off", async () => {
    const init = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.12",
        "user-agent": "like-test",
      },
      body: JSON.stringify({ slug: "algorithms" }),
    }
    const liked = await fetchApi("/api/likes", init)
    expect(await liked.json()).toMatchObject({ count: 1, liked: true })

    const unliked = await fetchApi("/api/likes", init)
    expect(await unliked.json()).toMatchObject({ count: 0, liked: false })
  })

  it("lets exactly one concurrent request consume the final rate-limit slot", async () => {
    const results = await Promise.all([
      isRateLimited(env.DB, "visitor", "test-action", 1, 60_000),
      isRateLimited(env.DB, "visitor", "test-action", 1, 60_000),
    ])
    expect(results.toSorted()).toEqual([false, true])
  })

  it("fails comments closed when Turnstile rejects the token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json({ success: false }))),
    )
    const response = await fetchApi("/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "algorithms",
        name: "Reader",
        body: "A comment that should not be stored",
        turnstileToken: "invalid",
      }),
    })
    expect(response.status).toBe(403)
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM comments").first<{ n: number }>()
    expect(row?.n).toBe(0)
  })

  it("accepts a verified comment without retaining its visitor key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({ success: true, hostname: "mandulaj.hu", action: "comment" }),
        ),
      ),
    )
    const response = await fetchApi("/api/comments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.15",
        "user-agent": "comment-test",
      },
      body: JSON.stringify({
        slug: "algorithms",
        name: "Reader",
        body: "A verified comment",
        email: "reader@example.com",
        turnstileToken: "valid",
      }),
    })
    expect(response.status).toBe(200)

    const row = await env.DB.prepare(
      "SELECT email, visitor, status FROM comments WHERE slug = 'algorithms'",
    ).first<{ email: string; visitor: string | null; status: string }>()
    expect(row).toEqual({ email: "reader@example.com", visitor: null, status: "visible" })
  })

  it("deletes a comment only with its edit token", async () => {
    const id = "510b73a3-6e31-4378-90dd-8d087af714f1"
    await env.DB.prepare(
      `INSERT INTO comments
       (id, slug, name, body, status, is_owner, edit_token, created_at)
       VALUES (?, 'algorithms', 'Reader', 'Body', 'visible', 0, 'secret-token', ?)`,
    )
      .bind(id, Date.now())
      .run()

    const denied = await fetchApi("/api/comments", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, editToken: "wrong" }),
    })
    expect(denied.status).toBe(403)

    const deleted = await fetchApi("/api/comments", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, editToken: "secret-token" }),
    })
    expect(deleted.status).toBe(200)

    const row = await env.DB.prepare("SELECT status FROM comments WHERE id = ?")
      .bind(id)
      .first<{ status: string }>()
    expect(row?.status).toBe("hidden")
  })
})
