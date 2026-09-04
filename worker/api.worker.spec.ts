import { env } from "cloudflare:workers"
import { createExecutionContext } from "cloudflare:test"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import worker from "./index"
import { isRateLimited, rateLimitVisitor } from "./lib"

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

  it("redirects the legacy Hungarian portfolio route and preserves its query", async () => {
    for (const path of ["/index_hu?from=portfolio", "/index_hu/?from=portfolio"]) {
      const response = await fetchApi(path, { redirect: "manual" })

      expect(response.status).toBe(301)
      expect(response.headers.get("location")).toBe("https://mandulaj.hu/?from=portfolio")
    }
  })

  it("keeps visitor-specific like state out of shared caches", async () => {
    await env.DB.prepare("INSERT INTO likes (slug, count, updated_at) VALUES (?, ?, ?)")
      .bind("algorithms", 7, Date.now())
      .run()

    const response = await fetchApi("/api/likes?slug=algorithms", {
      headers: { "cf-connecting-ip": "203.0.113.10", "user-agent": "test" },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ slug: "algorithms", count: 0, liked: false })
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

  it("rejects a reply if its thread is deleted during verification", async () => {
    const parentId = crypto.randomUUID()
    await env.DB.prepare(
      `INSERT INTO comments (id, slug, name, body, status, is_owner, edit_token, created_at)
       VALUES (?, 'algorithms', 'Reader', 'Parent', 'visible', 0, 'edit', 1)`,
    )
      .bind(parentId)
      .run()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const deleted = await fetchApi("/api/comments", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: parentId, editToken: "edit" }),
        })
        expect(deleted.status).toBe(200)
        return Response.json({ success: true, hostname: "mandulaj.hu", action: "comment" })
      }),
    )
    const response = await fetchApi("/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "algorithms",
        name: "Reader",
        body: "Reply",
        parentId,
        turnstileToken: "valid",
      }),
    })
    expect(response.status).toBe(409)
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE parent_id = ?")
      .bind(parentId)
      .first<{ n: number }>()
    expect(row?.n).toBe(0)
  })

  it("rejects reader and owner replies under an already hidden ancestor", async () => {
    const rootId = crypto.randomUUID()
    const parentId = crypto.randomUUID()
    const moderationToken = crypto.randomUUID()
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO comments (id, slug, name, body, status, is_owner, created_at)
        VALUES (?, 'algorithms', 'Reader', 'Root', 'hidden', 0, 1)`,
      ).bind(rootId),
      env.DB.prepare(
        `INSERT INTO comments (id, slug, parent_id, name, body, status, is_owner, moderation_token, created_at)
        VALUES (?, 'algorithms', ?, 'Reader', 'Old orphan', 'visible', 0, ?, 2)`,
      ).bind(parentId, rootId, moderationToken),
    ])
    const verification = vi.fn()
    vi.stubGlobal("fetch", verification)
    const reader = await fetchApi("/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "algorithms",
        name: "Reader",
        body: "Reply",
        parentId,
        turnstileToken: "valid",
      }),
    })
    expect(reader.status).toBe(400)
    expect(verification).not.toHaveBeenCalled()
    const owner = await fetchApi("/api/moderate", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://mandulaj.hu",
      },
      body: new URLSearchParams({ token: moderationToken, action: "reply", reply: "Owner reply" }),
    })
    expect(owner.status).toBe(409)
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM comments").first<{ n: number }>()
    expect(row?.n).toBe(2)
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
    const cookie = liked.headers.get("set-cookie")?.split(";", 1)[0]
    expect(cookie).toMatch(/^mandulaj_like=/)

    const unliked = await fetchApi("/api/likes", {
      ...init,
      headers: { ...init.headers, cookie: cookie ?? "" },
    })
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

  it("lets the private moderation page post an owner reply and hide the comment", async () => {
    const id = crypto.randomUUID()
    const token = crypto.randomUUID()
    await env.DB.prepare(
      `INSERT INTO comments
       (id, slug, name, body, status, is_owner, edit_token, moderation_token, created_at)
       VALUES (?, 'algorithms', '<Reader>', 'A useful & safe body', 'visible', 0, 'edit', ?, ?)`,
    )
      .bind(id, token, Date.now())
      .run()

    const page = await fetchApi(`/api/moderate?token=${token}`)
    expect(page.status).toBe(200)
    expect(page.headers.get("cache-control")).toBe("no-store")
    expect(page.headers.get("x-robots-tag")).toContain("noindex")
    const html = await page.text()
    expect(html).toContain("&lt;Reader&gt;")
    expect(html).not.toContain("<Reader>")

    const reply = await fetchApi("/api/moderate", {
      method: "POST",
      redirect: "manual",
      headers: {
        origin: "https://mandulaj.hu",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token, action: "reply", reply: "Thank you for reading." }),
    })
    expect(reply.status).toBe(303)

    const owner = await env.DB.prepare(
      "SELECT parent_id, name, body, is_owner, status FROM comments WHERE is_owner = 1",
    ).first<{
      parent_id: string
      name: string
      body: string
      is_owner: number
      status: string
    }>()
    expect(owner).toEqual({
      parent_id: id,
      name: "József Mandula",
      body: "Thank you for reading.",
      is_owner: 1,
      status: "visible",
    })

    const hidden = await fetchApi("/api/moderate", {
      method: "POST",
      headers: {
        origin: "https://mandulaj.hu",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token, action: "hide" }),
    })
    expect(hidden.status).toBe(200)
    expect(await hidden.text()).toContain("The comment is hidden.")

    const comments = await fetchApi("/api/comments?slug=algorithms")
    expect(await comments.json()).toEqual({ comments: [] })
  })

  it("rejects moderation mutations without a same-origin browser POST", async () => {
    const response = await fetchApi("/api/moderate", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: crypto.randomUUID(),
        action: "hide",
      }),
    })
    expect(response.status).toBe(403)
  })
})

describe("production regressions", () => {
  beforeEach(async () => {
    await env.DB.batch(
      ["rate_limit", "like_votes", "likes", "comments"].map((table) =>
        env.DB.prepare(`DELETE FROM ${table}`),
      ),
    )
  })
  const like = async (liked: boolean, cookie = "", ua = "reader") =>
    fetchApi("/api/likes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.55",
        "user-agent": ua,
        cookie,
      },
      body: JSON.stringify({ slug: "algorithms", liked }),
    })

  it("shares the quota across User-Agent and cookie changes", async () => {
    const req = new IncomingRequest("https://mandulaj.hu/api/likes", {
      headers: { "cf-connecting-ip": "203.0.113.55" },
    })
    const visitor = await rateLimitVisitor(req, env.VISITOR_SALT, "like")
    await env.DB.batch(
      Array.from({ length: 60 }, () =>
        env.DB.prepare("INSERT INTO rate_limit VALUES (?, 'like', ?)").bind(visitor, Date.now()),
      ),
    )
    expect((await like(true, "", "first-agent")).status).toBe(429)
    expect((await like(true, "", "changed-agent")).status).toBe(429)
  })

  it("keeps concurrent retries idempotent and counts exactly the surviving votes", async () => {
    const initial = await like(true)
    const cookie = initial.headers.get("set-cookie")!.split(";")[0]
    await like(true, "", "another-browser")
    const removed = await Promise.all([like(false, cookie), like(false, cookie)])
    expect(removed.map((r) => r.status)).toEqual([200, 200])
    for (const r of removed) expect(await r.json()).toMatchObject({ count: 1, liked: false })
    const added = await Promise.all([like(true, cookie), like(true, cookie)])
    expect(added.map((r) => r.status)).toEqual([200, 200])
    for (const r of added) expect(await r.json()).toMatchObject({ count: 2, liked: true })
    const row = await env.DB.prepare("SELECT count FROM likes WHERE slug='algorithms'").first<{
      count: number
    }>()
    const votes = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM like_votes WHERE slug='algorithms'",
    ).first<{ count: number }>()
    expect(row).toEqual(votes)
  })

  it("hides a reader-deleted thread and filters existing orphaned replies", async () => {
    await env.DB.prepare(
      "INSERT INTO comments (id,slug,name,body,edit_token,created_at) VALUES ('parent','algorithms','Reader','Parent','token',1)",
    ).run()
    await env.DB.prepare(
      "INSERT INTO comments (id,slug,parent_id,name,body,created_at) VALUES ('reply','algorithms','parent','Reader','Reply',2)",
    ).run()
    const denied = await fetchApi("/api/comments", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "parent", editToken: "wrong" }),
    })
    expect(denied.status).toBe(403)
    const deleted = await fetchApi("/api/comments", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "parent", editToken: "token" }),
    })
    expect(deleted.status).toBe(200)
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE status='visible'").first("n"),
    ).toBe(0)
    // Old deployments could leave a visible reply behind a hidden parent.
    await env.DB.prepare("UPDATE comments SET status='visible' WHERE id='reply'").run()
    const response = await fetchApi("/api/comments?slug=algorithms")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ comments: [] })
  })

  it("does not expose engagement for unpublished pages", async () => {
    for (const api of ["likes", "comments"])
      expect((await fetchApi(`/api/${api}?slug=removed-page`)).status).toBe(404)
  })
})
