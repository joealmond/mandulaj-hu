/**
 * mandulaj.hu — static site + API, one Worker.
 *
 * Static assets are served by Cloudflare directly and are free and unlimited;
 * only `/api/*` and the two legacy `/index_hu` spellings invoke this script
 * (see `run_worker_first` in wrangler.jsonc), so normal page views cost nothing
 * against the free request budget.
 *
 * API configuration failures return an error so the client cannot mistake a
 * failed write for success. The static site remains available independently.
 */
import {
  allowedTurnstileHostnames,
  bad,
  isRateLimited,
  isValidSlug,
  json,
  likeVisitor,
  notifyTelegram,
  pageTitleFromHtml,
  rateLimitVisitor,
  telegramCommentText,
  telegramLikeText,
  verifyTurnstile,
} from "./lib"

/** Anything larger is refused before it is parsed. */
const MAX_BODY_BYTES = 16 * 1024
const MAX_NAME = 60
const MAX_BODY = 2000
const MAX_LINKS = 2

// Both reads and writes use the same definition of a publicly reachable thread.
// Bind the page slug twice before any parameters belonging to the query itself.
const VISIBLE_COMMENTS = `WITH RECURSIVE visible(id) AS (
  SELECT id FROM comments WHERE slug = ? AND parent_id IS NULL AND status = 'visible'
  UNION ALL
  SELECT c.id FROM comments c JOIN visible v ON c.parent_id = v.id
   WHERE c.slug = ? AND c.status = 'visible'
)`

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    if (
      (url.pathname === "/index_hu" || url.pathname === "/index_hu/") &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      url.pathname = "/"
      return Response.redirect(url.toString(), 301)
    }

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
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { data: parsed as Record<string, unknown> }
      : { error: bad("JSON body must be an object") }
  } catch {
    return { error: bad("Invalid JSON body") }
  }
}

/**
 * Confirms the slug is deployed and returns its authoritative page title.
 * Asking the assets binding prevents well-formed but nonexistent slugs from
 * seeding database rows, without coupling the Worker to build-time metadata.
 */
async function publishedPageTitle(
  env: Env,
  request: Request,
  slug: string,
): Promise<string | null> {
  try {
    const page = new URL(request.url)
    page.pathname = `/${slug}`
    page.search = ""
    const res = await env.ASSETS.fetch(new Request(page.toString(), { method: "GET" }))
    if (!res.ok) return null
    return pageTitleFromHtml(await res.text(), slug)
  } catch {
    return null
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
    return bad("API not configured", 503)
  }

  if (pathname === "/api/likes" && method === "GET") return getLikes(request, env, url)
  if (pathname === "/api/likes" && method === "POST") return toggleLike(request, env, ctx)
  if (pathname === "/api/comments" && method === "GET") return getComments(request, env, url)
  if (pathname === "/api/comments" && method === "POST") return postComment(request, env, ctx)
  if (pathname === "/api/comments" && method === "DELETE") return deleteComment(request, env)
  if (pathname === "/api/moderate" && method === "GET") return moderationPage(request, env, url)
  if (pathname === "/api/moderate" && method === "POST") return moderateComment(request, env)

  return bad("Not found", 404)
}

/* ── Likes ──────────────────────────────────────────────────────────────── */

async function getLikes(request: Request, env: Env, url: URL): Promise<Response> {
  const slug = url.searchParams.get("slug")
  if (!isValidSlug(slug)) return bad("Invalid slug")
  if (!(await publishedPageTitle(env, request, slug))) return bad("Unknown page", 404)

  const identity = await likeVisitor(request, env.VISITOR_SALT, false)
  const visitors = [...new Set([identity.current, identity.legacy].filter(Boolean))] as string[]
  const placeholders = visitors.map(() => "?").join(", ")
  const [row, vote] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS count FROM like_votes WHERE slug = ?")
      .bind(slug)
      .first<{ count: number }>(),
    env.DB.prepare(`SELECT 1 AS v FROM like_votes WHERE slug = ? AND visitor IN (${placeholders})`)
      .bind(slug, ...visitors)
      .first(),
  ])

  // A read immediately after a write must reflect current cookie/vote state.
  return json({ slug, count: row?.count ?? 0, liked: Boolean(vote) })
}

async function toggleLike(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const parsed = await readJson(request)
  if ("error" in parsed) return parsed.error
  const body = parsed.data
  const slug = body.slug
  if (!isValidSlug(slug)) return bad("Invalid slug")
  const pageTitle = await publishedPageTitle(env, request, slug)
  if (!pageTitle) return bad("Unknown page", 404)

  if (body.liked !== undefined && typeof body.liked !== "boolean") return bad("Invalid like state")
  const rateVisitor = await rateLimitVisitor(request, env.VISITOR_SALT, "like")
  if (await isRateLimited(env.DB, rateVisitor, "like", 60, 60_000)) {
    return bad("Slow down", 429)
  }

  const identity = await likeVisitor(request, env.VISITOR_SALT, true)
  if (!identity.current) throw new Error("Like identity was not created")
  const visitors = [...new Set([identity.current, identity.legacy])]
  const placeholders = visitors.map(() => "?").join(", ")
  // Older already-open pages send a toggle. New clients send the desired state
  // so duplicate requests are idempotent. Both paths keep counts authoritative.
  const existing =
    body.liked === undefined
      ? await env.DB.prepare(
          `SELECT 1 FROM like_votes WHERE slug = ? AND visitor IN (${placeholders})`,
        )
          .bind(slug, ...visitors)
          .first()
      : null
  const desired = body.liked === undefined ? !existing : body.liked
  const now = Date.now()
  const mutations = desired
    ? [
        // Migrate an old IP-based vote to the returning browser's signed cookie.
        env.DB.prepare(
          "UPDATE OR IGNORE like_votes SET visitor = ? WHERE slug = ? AND visitor = ?",
        ).bind(identity.current, slug, identity.legacy),
        env.DB.prepare(
          "DELETE FROM like_votes WHERE slug = ? AND visitor = ? AND visitor != ?",
        ).bind(slug, identity.legacy, identity.current),
        env.DB.prepare(
          "INSERT OR IGNORE INTO like_votes (slug, visitor, created_at) VALUES (?, ?, ?)",
        ).bind(slug, identity.current, now),
      ]
    : [
        env.DB.prepare(
          `DELETE FROM like_votes WHERE slug = ? AND visitor IN (${placeholders})`,
        ).bind(slug, ...visitors),
      ]

  const results = await env.DB.batch([
    ...mutations,
    env.DB.prepare(
      `INSERT INTO likes (slug, count, updated_at)
      VALUES (?, (SELECT COUNT(*) FROM like_votes WHERE slug = ?), ?)
      ON CONFLICT(slug) DO UPDATE SET count = excluded.count, updated_at = excluded.updated_at`,
    ).bind(slug, slug, now),
    env.DB.prepare(
      `SELECT COUNT(*) AS count,
      COALESCE(MAX(CASE WHEN visitor = ? THEN 1 ELSE 0 END), 0) AS liked
      FROM like_votes WHERE slug = ?`,
    ).bind(identity.current, slug),
  ])
  const state = results.at(-1)!.results[0] as { count: number; liked: number }
  // Only an actual insert sends an alert; retries and legacy migration are silent.
  if (desired && results[mutations.length - 1].meta.changes > 0) {
    ctx.waitUntil(
      notifyTelegram(env, telegramLikeText(pageTitle, state.count, `https://mandulaj.hu/${slug}`)),
    )
  }
  return json(
    { slug, count: state.count, liked: Boolean(state.liked) },
    200,
    identity.setCookie ? { "set-cookie": identity.setCookie } : {},
  )
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

interface ModerationRow extends CommentRow {
  slug: string
  status: string
}

async function getComments(request: Request, env: Env, url: URL): Promise<Response> {
  const slug = url.searchParams.get("slug")
  if (!isValidSlug(slug)) return bad("Invalid slug")
  if (!(await publishedPageTitle(env, request, slug))) return bad("Unknown page", 404)

  const { results } = await env.DB.prepare(
    `${VISIBLE_COMMENTS}
     SELECT c.id, c.parent_id, c.name, c.body, c.is_owner, c.created_at
       FROM comments c JOIN visible v ON c.id = v.id
      ORDER BY c.created_at ASC, c.id ASC
      LIMIT 500`,
  )
    .bind(slug, slug)
    .all<CommentRow>()

  // Mutations must be visible immediately, including on an already-open page.
  return json({ comments: results ?? [] })
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
  const pageTitle = await publishedPageTitle(env, request, slug)
  if (!pageTitle) return bad("Unknown page", 404)

  if (parentId) {
    const parent = await env.DB.prepare(
      `${VISIBLE_COMMENTS} SELECT 1 AS found FROM visible WHERE id = ?`,
    )
      .bind(slug, slug, parentId)
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

  const visitor = await rateLimitVisitor(request, env.VISITOR_SALT, "comment")
  if (await isRateLimited(env.DB, visitor, "comment", 5, 600_000)) {
    return bad("You have posted a few already — try again shortly", 429)
  }

  const id = crypto.randomUUID()
  const editToken = crypto.randomUUID()
  const moderationToken = crypto.randomUUID()
  const now = Date.now()

  const inserted = await env.DB.prepare(
    `${VISIBLE_COMMENTS} INSERT INTO comments
       (id, slug, parent_id, name, email, body, status, is_owner, edit_token, moderation_token, visitor, created_at)
       SELECT ?, ?, ?, ?, ?, ?, 'visible', 0, ?, ?, NULL, ?
       WHERE ? IS NULL OR EXISTS (SELECT 1 FROM visible WHERE id = ?)`,
  )
    .bind(
      slug,
      slug,
      id,
      slug,
      parentId,
      name,
      email,
      text,
      editToken,
      moderationToken,
      now,
      parentId,
      parentId,
    )
    .run()
  if (!inserted.meta.changes)
    return bad("This thread was removed — post a new comment instead", 409)

  // Post-moderation: it is live now, you hear about it immediately.
  ctx.waitUntil(
    notifyTelegram(
      env,
      telegramCommentText(pageTitle, name, text, `https://mandulaj.hu/${slug}#c-${id}`),
      {
        text: "Moderate or reply",
        url: `${env.SITE_ORIGIN}/api/moderate?token=${moderationToken}`,
      },
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
    `WITH RECURSIVE thread(id) AS (
       SELECT id FROM comments WHERE id = ? AND edit_token = ?
       UNION ALL
       SELECT c.id FROM comments c JOIN thread t ON c.parent_id = t.id
     ) UPDATE comments SET status = 'hidden' WHERE id IN (SELECT id FROM thread)`,
  )
    .bind(id, token)
    .run()

  if (!res.meta.changes) return bad("Not found or token mismatch", 403)
  return json({ ok: true })
}

const UUID_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const htmlEscape = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")

function moderationHtml(
  row: ModerationRow,
  token: string,
  pageTitle: string,
  message?: string,
): Response {
  const nonce = crypto.randomUUID().replace(/-/g, "")
  const visible = row.status === "visible"
  const date = new Date(row.created_at).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Budapest",
  })
  const pageUrl = `https://mandulaj.hu/${row.slug}#c-${row.id}`
  const content = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Moderate comment · mandulaj.hu</title>
  <style nonce="${nonce}">
    :root { color-scheme: light dark; font: 17px/1.55 system-ui, sans-serif; }
    body { margin: 0; background: Canvas; color: CanvasText; }
    main { box-sizing: border-box; width: min(42rem, 100%); margin: 0 auto; padding: 2rem 1.25rem 4rem; }
    h1 { line-height: 1.15; }
    .notice { border-left: .3rem solid #589b60; padding: .75rem 1rem; background: color-mix(in srgb, CanvasText 7%, Canvas); }
    article { margin: 1.5rem 0; padding: 1rem; border: 1px solid color-mix(in srgb, CanvasText 25%, Canvas); }
    blockquote { margin: .75rem 0 0; white-space: pre-wrap; }
    form { margin: 1.25rem 0; }
    textarea { box-sizing: border-box; width: 100%; min-height: 8rem; padding: .75rem; font: inherit; }
    button, .link { display: inline-block; box-sizing: border-box; padding: .7rem 1rem; border: 1px solid currentColor; background: CanvasText; color: Canvas; font: inherit; cursor: pointer; text-decoration: none; }
    .danger { background: #8f2929; color: white; }
    small { opacity: .72; }
  </style>
</head>
<body>
<main>
  <h1>Moderate comment</h1>
  ${message ? `<p class="notice" role="status">${htmlEscape(message)}</p>` : ""}
  <p>On <strong>${htmlEscape(pageTitle)}</strong></p>
  <article>
    <strong>${htmlEscape(row.name)}</strong> <small>· ${htmlEscape(date)}</small>
    <blockquote>${htmlEscape(row.body)}</blockquote>
  </article>
  ${
    visible
      ? `<h2>Reply as József Mandula</h2>
  <form method="post" action="/api/moderate">
    <input type="hidden" name="token" value="${htmlEscape(token)}">
    <input type="hidden" name="action" value="reply">
    <label for="reply">Your public reply</label>
    <textarea id="reply" name="reply" minlength="2" maxlength="${MAX_BODY}" required></textarea>
    <button type="submit">Post owner reply</button>
  </form>
  <h2>Remove from the site</h2>
  <p>Hiding is recoverable in the database and removes the comment from the public page.</p>
  <form method="post" action="/api/moderate">
    <input type="hidden" name="token" value="${htmlEscape(token)}">
    <input type="hidden" name="action" value="hide">
    <button class="danger" type="submit">Hide comment</button>
  </form>`
      : "<p>This comment is hidden and is no longer visible on the site.</p>"
  }
  <p><a class="link" href="${htmlEscape(pageUrl)}" rel="noreferrer">View post</a></p>
</main>
</body>
</html>`

  return new Response(content, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  })
}

async function moderationRow(env: Env, token: string): Promise<ModerationRow | null> {
  return env.DB.prepare(
    `SELECT id, slug, parent_id, name, body, status, is_owner, created_at
       FROM comments
      WHERE moderation_token = ?`,
  )
    .bind(token)
    .first<ModerationRow>()
}

async function moderationPage(request: Request, env: Env, url: URL): Promise<Response> {
  const token = url.searchParams.get("token") ?? ""
  if (!UUID_TOKEN.test(token)) return bad("Invalid moderation link", 404)
  const row = await moderationRow(env, token)
  if (!row) return bad("Invalid moderation link", 404)
  const title = (await publishedPageTitle(env, request, row.slug)) ?? row.slug
  const done = url.searchParams.get("done")
  const message = done === "reply" ? "Your owner reply is now public." : undefined
  return moderationHtml(row, token, title, message)
}

async function readModerationForm(
  request: Request,
): Promise<{ data: URLSearchParams } | { error: Response }> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase()
  if (contentType !== "application/x-www-form-urlencoded") {
    return { error: bad("Invalid form", 415) }
  }
  const declared = request.headers.get("content-length")
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    return { error: bad("Form is too large", 413) }
  }
  const reader = request.body?.getReader()
  if (!reader) return { error: bad("Form is required") }
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel()
      return { error: bad("Form is too large", 413) }
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
    return {
      data: new URLSearchParams(
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
      ),
    }
  } catch {
    return { error: bad("Invalid form") }
  }
}

function isSameOriginPost(request: Request, env: Env): boolean {
  const origin = request.headers.get("origin")
  if (!origin) return false
  if (origin === env.SITE_ORIGIN) return true
  try {
    const parsed = new URL(origin)
    return (
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
      new URL(request.url).origin === origin
    )
  } catch {
    return false
  }
}

async function moderateComment(request: Request, env: Env): Promise<Response> {
  if (!isSameOriginPost(request, env)) return bad("Invalid request origin", 403)
  const parsed = await readModerationForm(request)
  if ("error" in parsed) return parsed.error
  const token = parsed.data.get("token") ?? ""
  const action = parsed.data.get("action") ?? ""
  if (!UUID_TOKEN.test(token)) return bad("Invalid moderation link", 404)
  const row = await moderationRow(env, token)
  if (!row) return bad("Invalid moderation link", 404)

  if (action === "hide") {
    // Hide the complete reply thread so no owner/reader reply is left orphaned
    // on the public page when its parent disappears.
    await env.DB.prepare(
      `WITH RECURSIVE thread(id) AS (
         SELECT id FROM comments WHERE id = ?
         UNION ALL
         SELECT comments.id FROM comments JOIN thread ON comments.parent_id = thread.id
       )
       UPDATE comments SET status = 'hidden' WHERE id IN (SELECT id FROM thread)`,
    )
      .bind(row.id)
      .run()
    const title = (await publishedPageTitle(env, request, row.slug)) ?? row.slug
    return moderationHtml({ ...row, status: "hidden" }, token, title, "The comment is hidden.")
  }

  if (action === "reply") {
    if (row.status !== "visible") return bad("Cannot reply to a hidden comment", 409)
    const reply = (parsed.data.get("reply") ?? "").trim()
    if (reply.length < 2) return bad("Write a reply first")
    if (reply.length > MAX_BODY) return bad(`Reply must be at most ${MAX_BODY} characters`)
    const links = (reply.match(/https?:\/\//g) ?? []).length
    if (links > MAX_LINKS) return bad("Too many links")

    const inserted = await env.DB.prepare(
      `${VISIBLE_COMMENTS} INSERT INTO comments
       (id, slug, parent_id, name, body, status, is_owner, edit_token, moderation_token, visitor, created_at)
       SELECT ?, ?, ?, 'József Mandula', ?, 'visible', 1, NULL, NULL, NULL, ?
       WHERE EXISTS (SELECT 1 FROM visible WHERE id = ?)`,
    )
      .bind(row.slug, row.slug, crypto.randomUUID(), row.slug, row.id, reply, Date.now(), row.id)
      .run()
    if (!inserted.meta.changes) return bad("Cannot reply to a removed thread", 409)
    return new Response(null, {
      status: 303,
      headers: { location: `${env.SITE_ORIGIN}/api/moderate?token=${token}&done=reply` },
    })
  }

  return bad("Unknown moderation action")
}
