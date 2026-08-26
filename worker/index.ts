/**
 * mandulaj.hu — static site + API, one Worker.
 *
 * Static assets are served by Cloudflare directly and are free and unlimited;
 * only `/api/*` invokes this script (see `run_worker_first` in wrangler.jsonc),
 * so page views cost nothing against the free request budget.
 *
 * Everything here degrades safely: without a D1 binding the endpoints return
 * an empty-but-valid shape rather than erroring, so the site keeps working if
 * the database is missing or a migration has not run yet.
 */
import {
  allowedTurnstileHostnames,
  bad,
  esc,
  isRateLimited,
  isValidSlug,
  json,
  notifyTelegram,
  rateLimitScope,
  verifyTurnstile,
  visitorId,
} from "./lib"

/** Anything larger is refused before it is parsed. */
const MAX_BODY_BYTES = 16 * 1024
const MAX_NAME = 60
const MAX_BODY = 2000
const MAX_LINKS = 2

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request)
    }

    // Same-origin by design, so CORS is only needed for local development
    // against the deployed API.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) })
    }

    try {
      const res = await route(request, env, ctx, url)
      for (const [k, v] of Object.entries(corsHeaders(request, env))) res.headers.set(k, v)
      return res
    } catch (err) {
      console.error(
        JSON.stringify({
          message: "API request failed",
          error: err instanceof Error ? err.message : String(err),
          method: request.method,
          path: url.pathname,
        }),
      )
      return bad("Something went wrong", 500)
    }
  },
} satisfies ExportedHandler<Env>

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("origin") ?? ""
  const allowed = env.SITE_ORIGIN
  let localDevelopment = false
  try {
    const parsed = new URL(origin)
    localDevelopment =
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
  } catch {
    // Missing and malformed origins are not cross-origin development clients.
  }
  const ok = origin === allowed || localDevelopment
  return ok
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type",
        vary: "origin",
      }
    : {}
}

/**
 * Reads a JSON body with a hard size cap.
 *
 * Without this a client could stream an arbitrarily large body and make the
 * Worker do the parsing work. The cap is far above any legitimate comment.
 */
async function readJson(
  request: Request,
): Promise<{ data: Record<string, unknown> } | { error: Response }> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase()
  if (contentType !== "application/json") {
    return { error: bad("Content-Type must be application/json", 415) }
  }
  const declared = request.headers.get("content-length")
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    return { error: bad("Request body is too large", 413) }
  }

  const reader = request.body?.getReader()
  if (!reader) return { error: bad("A JSON body is required") }
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel()
      return { error: bad("Request body is too large", 413) }
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { data: parsed as Record<string, unknown> }
      : { error: bad("JSON body must be an object") }
  } catch {
    return { error: bad("Invalid JSON body") }
  }
}

/**
 * Confirms a slug corresponds to a real published page.
 *
 * `isValidSlug` only checks the shape, so anything well-formed could seed rows
 * for pages that do not exist. Asking the assets binding is authoritative and
 * needs no coupling to the build — if the page is not deployed, it is not a
 * page. Only writes pay this cost.
 */
async function isPublishedSlug(env: Env, request: Request, slug: string): Promise<boolean> {
  try {
    const probe = new URL(request.url)
    probe.pathname = `/${slug}`
    probe.search = ""
    const res = await env.ASSETS.fetch(new Request(probe.toString(), { method: "GET" }))
    return res.ok
  } catch {
    return false
  }
}

async function route(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> {
  const { pathname } = url
  const method = request.method

  if (!env.DB) {
    // No database bound yet: report empty rather than failing the page.
    if (pathname === "/api/likes")
      return json({ slug: url.searchParams.get("slug"), count: 0, liked: false })
    if (pathname === "/api/comments") return json({ comments: [] })
    return bad("API not configured", 503)
  }

  if (pathname === "/api/likes" && method === "GET") return getLikes(request, env, url)
  if (pathname === "/api/likes" && method === "POST") return toggleLike(request, env)
  if (pathname === "/api/comments" && method === "GET") return getComments(env, url)
  if (pathname === "/api/comments" && method === "POST") return postComment(request, env, ctx)
  if (pathname === "/api/comments" && method === "DELETE") return deleteComment(request, env)

  return bad("Not found", 404)
}

/* ── Likes ──────────────────────────────────────────────────────────────── */

async function getLikes(request: Request, env: Env, url: URL): Promise<Response> {
  const slug = url.searchParams.get("slug")
  if (!isValidSlug(slug)) return bad("Invalid slug")

  const visitor = await visitorId(request, env.VISITOR_SALT, "like")
  const [row, vote] = await Promise.all([
    env.DB.prepare("SELECT count FROM likes WHERE slug = ?").bind(slug).first<{ count: number }>(),
    env.DB.prepare("SELECT 1 AS v FROM like_votes WHERE slug = ? AND visitor = ?")
      .bind(slug, visitor)
      .first(),
  ])

  /*
   * `private`, NOT `public`. The response carries `liked`, which is derived
   * from this visitor's own hash — a shared cache serving it to someone else
   * would show them a like they never made. `private` lets the visitor's own
   * browser cache it while forbidding every shared cache from doing so.
   */
  return json({ slug, count: row?.count ?? 0, liked: Boolean(vote) }, 200, {
    "cache-control": "private, max-age=30",
  })
}

async function toggleLike(request: Request, env: Env): Promise<Response> {
  const parsed = await readJson(request)
  if ("error" in parsed) return parsed.error
  const body = parsed.data
  const slug = body.slug
  if (!isValidSlug(slug)) return bad("Invalid slug")
  if (!(await isPublishedSlug(env, request, slug))) return bad("Unknown page", 404)

  const visitor = await visitorId(request, env.VISITOR_SALT, "like")
  const rateVisitor = await visitorId(request, env.VISITOR_SALT, rateLimitScope("like"))
  if (await isRateLimited(env.DB, rateVisitor, "like", 60, 60_000)) {
    return bad("Slow down", 429)
  }

  const existing = await env.DB.prepare(
    "SELECT 1 AS v FROM like_votes WHERE slug = ? AND visitor = ?",
  )
    .bind(slug, visitor)
    .first()

  const now = Date.now()
  if (existing) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM like_votes WHERE slug = ? AND visitor = ?").bind(slug, visitor),
      env.DB.prepare(
        "UPDATE likes SET count = MAX(0, count - 1), updated_at = ? WHERE slug = ?",
      ).bind(now, slug),
    ])
  } else {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO like_votes (slug, visitor, created_at) VALUES (?, ?, ?)").bind(
        slug,
        visitor,
        now,
      ),
      // Atomic upsert: concurrent likes cannot lose an increment.
      env.DB.prepare(
        `INSERT INTO likes (slug, count, updated_at) VALUES (?, 1, ?)
         ON CONFLICT(slug) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`,
      ).bind(slug, now),
    ])
  }

  const row = await env.DB.prepare("SELECT count FROM likes WHERE slug = ?")
    .bind(slug)
    .first<{ count: number }>()
  return json({ slug, count: row?.count ?? 0, liked: !existing })
}

/* ── Comments ───────────────────────────────────────────────────────────── */

interface CommentRow {
  id: string
  parent_id: string | null
  name: string
  body: string
  is_owner: number
  created_at: number
}

async function getComments(env: Env, url: URL): Promise<Response> {
  const slug = url.searchParams.get("slug")
  if (!isValidSlug(slug)) return bad("Invalid slug")

  const { results } = await env.DB.prepare(
    `SELECT id, parent_id, name, body, is_owner, created_at
         FROM comments
        WHERE slug = ? AND status = 'visible'
        ORDER BY created_at ASC
        LIMIT 500`,
  )
    .bind(slug)
    .all<CommentRow>()

  // No visitor-specific fields here, so a shared cache is fine — but a deleted
  // comment should disappear quickly, so keep the window short.
  return json({ comments: results ?? [] }, 200, { "cache-control": "public, max-age=10" })
}

async function postComment(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const parsed = await readJson(request)
  if ("error" in parsed) return parsed.error
  const body = parsed.data

  const slug = body.slug
  if (!isValidSlug(slug)) return bad("Invalid slug")

  if (typeof body.name !== "string") return bad("A name is required")
  if (typeof body.body !== "string") return bad("A comment is required")
  if (body.email != null && typeof body.email !== "string") return bad("Invalid email")
  if (body.parentId != null && typeof body.parentId !== "string") return bad("Invalid parent")
  const name = body.name.trim()
  const text = body.body.trim()
  const email = body.email?.trim() || null
  const parentId = body.parentId ?? null

  if (!name) return bad("A name is required")
  if (name.length > MAX_NAME) return bad(`Name must be at most ${MAX_NAME} characters`)
  if (text.length < 2) return bad("Say a bit more than that")
  if (text.length > MAX_BODY) return bad(`Comment must be at most ${MAX_BODY} characters`)
  if (email && email.length > 200) return bad("Email must be at most 200 characters")
  if (parentId && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(parentId)) return bad("Invalid parent")
  if (!(await isPublishedSlug(env, request, slug))) return bad("Unknown page", 404)

  if (parentId) {
    const parent = await env.DB.prepare(
      "SELECT 1 AS found FROM comments WHERE id = ? AND slug = ? AND status = 'visible'",
    )
      .bind(parentId, slug)
      .first()
    if (!parent) return bad("Parent comment was not found")
  }

  // Cheap spam heuristic: comments that are mostly links.
  const links = (text.match(/https?:\/\//g) ?? []).length
  if (links > MAX_LINKS) return bad("Too many links")

  const ip = request.headers.get("cf-connecting-ip") ?? "0.0.0.0"
  const verdict = await verifyTurnstile(
    env.TURNSTILE_SECRET_KEY,
    body.turnstileToken,
    ip,
    allowedTurnstileHostnames(env, request),
    "comment",
  )
  if (!verdict.ok) {
    // The reason is logged, never returned: it tells an attacker which of the
    // three checks they tripped. The reader gets one undifferentiated message.
    console.warn("turnstile rejected:", verdict.reason)
    return bad("Verification failed — reload and try again", 403)
  }

  const visitor = await visitorId(request, env.VISITOR_SALT, rateLimitScope("comment"))
  if (await isRateLimited(env.DB, visitor, "comment", 5, 600_000)) {
    return bad("You have posted a few already — try again shortly", 429)
  }

  const id = crypto.randomUUID()
  const editToken = crypto.randomUUID()
  const now = Date.now()

  await env.DB.prepare(
    `INSERT INTO comments (id, slug, parent_id, name, email, body, status, is_owner, edit_token, visitor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'visible', 0, ?, NULL, ?)`,
  )
    .bind(id, slug, parentId, name, email, text, editToken, now)
    .run()

  // Post-moderation: it is live now, you hear about it immediately.
  ctx.waitUntil(
    notifyTelegram(
      env,
      `💬 <b>${esc(name)}</b> commented on <code>${esc(slug)}</code>\n\n` +
        `${esc(text.slice(0, 500))}\n\n` +
        `https://mandulaj.hu/${esc(slug)}#c-${id}`,
    ),
  )

  return json({
    id,
    editToken,
    name,
    body: text,
    created_at: now,
    is_owner: 0,
    parent_id: parentId,
  })
}

/** Authors may remove their own comment using the token held in their browser. */
async function deleteComment(request: Request, env: Env): Promise<Response> {
  const parsed = await readJson(request)
  if ("error" in parsed) return parsed.error
  const id = typeof parsed.data.id === "string" ? parsed.data.id : null
  const token = typeof parsed.data.editToken === "string" ? parsed.data.editToken : null
  if (!id || !token) return bad("Missing id or token")

  const res = await env.DB.prepare(
    "UPDATE comments SET status = 'hidden' WHERE id = ? AND edit_token = ?",
  )
    .bind(id, token)
    .run()

  if (!res.meta.changes) return bad("Not found or token mismatch", 403)
  return json({ ok: true })
}
