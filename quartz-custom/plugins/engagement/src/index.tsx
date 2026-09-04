import type {
  QuartzComponent,
  QuartzComponentConstructor,
  QuartzComponentProps,
} from "@quartz-community/types"

/**
 * Likes and comments, fetched at runtime from the same Worker that serves the
 * site (`/api/*`, same origin — no CORS).
 *
 * Nothing here is baked into the build, which is the point: a comment never
 * enters the repo, never appears in git history, and removing one takes effect
 * immediately rather than at the next deploy. The publish audit is therefore
 * untouched by anything readers write.
 *
 * Degrades to nothing visible if the API is unreachable — a static page with a
 * dead comment box is worse than a static page.
 */
const Engagement: QuartzComponentConstructor = () => {
  const Component: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
    const slug = fileData?.slug ?? ""
    // Site furniture has no conversation attached to it.
    if (!slug || slug === "index" || slug === "404" || slug.startsWith("tags/")) return null

    return (
      <section class="eng" data-slug={slug} hidden>
        {/* The note's footer: one row of chips on the text spine, sitting just
            under the content rule. Previously the like button floated in ~90px
            of void belonging to neither the note nor the form. */}
        <div class="eng-footer">
          <span class="eng-ask">Useful?</span>
          <button
            class="eng-like-btn"
            type="button"
            aria-pressed="false"
            aria-label="Like this note"
          >
            <span class="eng-heart" aria-hidden="true">
              &#9829;
            </span>
            <span class="eng-count">0</span>
          </button>
          <span class="eng-feedback" role="status" aria-live="polite"></span>
        </div>

        <div class="eng-comments">
          {/* A plain label, not a section title. The accent rule here echoed
              the H1 treatment and made an empty form outweigh the note. */}
          <div class="eng-head">
            <span class="eng-head-label">Comments</span>
            <span class="eng-head-count">0</span>
            <button class="eng-first" type="button">
              Be the first &rarr;
            </button>
          </div>

          {/* Comments are content and are never collapsed. Only the composer
              is, because on most notes it will never be used. */}
          <ol class="eng-list"></ol>

          {/* Sits BELOW the list, next to where the composer will appear —
              a trigger 400px above its own result is a disconnect. */}
          <button class="eng-toggle" type="button" aria-expanded="false" hidden></button>

          <div class="eng-composer" hidden>
            <form class="eng-form">
              <div class="eng-row eng-row--name">
                <label class="eng-lbl" for="eng-name">
                  Name
                </label>
                <input
                  id="eng-name"
                  class="eng-input"
                  name="name"
                  maxLength={60}
                  autoComplete="nickname"
                  required
                />
              </div>
              <div class="eng-row">
                <label class="eng-lbl" for="eng-body">
                  Comment
                </label>
                <textarea
                  id="eng-body"
                  class="eng-input eng-area"
                  name="body"
                  rows={5}
                  maxLength={2000}
                  required
                ></textarea>
              </div>
              <div class="eng-turnstile"></div>
              <div class="eng-actions">
                <span class="eng-note" role="status" aria-live="polite"></span>
                <button class="eng-submit" type="submit">
                  Post
                </button>
              </div>
            </form>
          </div>
          <p class="eng-off" hidden>
            Comments are not configured on this deployment.
          </p>
        </div>
      </section>
    )
  }

  Component.css = `
/* One chip system across the page: tags, footer chips and Post all share this
   height and treatment, so the footer reads as part of the note. */
/* Quartz emits an <hr> and an empty .page-footer between the article and this
   section, which already carry separation. 2rem on top of that put the footer
   row ~67px adrift, belonging to neither the note nor the comments. */
.eng { margin-top: 0; max-width: var(--measure, 34rem); }
.eng[hidden] { display: none; }
.eng *, .eng *::before, .eng *::after { box-sizing: border-box; }

/* 2rem below the content rule and no more. .eng already carries the top
   margin; adding padding here too was stacking 64px of dead space. */
.eng-footer { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
.eng-ask {
  font-family: var(--codeFont); font-size: .68rem; letter-spacing: .07em;
  text-transform: uppercase; color: var(--gray); margin-right: .1rem;
}
.eng-like-btn, .eng-toggle, .eng-submit, .eng-first {
  display: inline-flex; align-items: center; gap: .4rem;
  height: 2rem; padding: 0 .7rem;
  background: none; border: 1px solid var(--lightgray); border-radius: 0;
  cursor: pointer; color: var(--gray);
  font-family: var(--codeFont); font-size: .7rem; letter-spacing: .05em;
  text-transform: uppercase;
  transition: border-color 120ms ease, color 120ms ease, background-color 120ms ease;
}
.eng-like-btn:hover, .eng-toggle:hover, .eng-first:hover { border-color: var(--accent); color: var(--accent); }
.eng-like-btn[aria-pressed="true"] { color: var(--accent); border-color: var(--accent); }
.eng-like-btn[aria-pressed="true"] .eng-heart { color: var(--accent); }
/* Mono numerals are tabular; keep tracking at zero so the count does not jitter
   as it crosses 9 → 10. */
.eng-count { letter-spacing: 0; font-variant-numeric: tabular-nums; }
.eng-pending { opacity: .55; }
.eng-feedback { font-size: .8rem; color: var(--gray); }
.eng-toggle[hidden] { display: none; }
.eng-toggle { margin-top: 1rem; }

.eng-comments { margin-top: 2rem; }
.eng-head { display: flex; align-items: center; gap: .5rem; }
.eng-head-label, .eng-head-count {
  font-family: var(--codeFont); font-size: .68rem; letter-spacing: .08em;
  text-transform: uppercase; color: var(--gray);
}
.eng-head-count { letter-spacing: 0; font-variant-numeric: tabular-nums; }
.eng-first[hidden] { display: none; }

.eng-list { list-style: none; margin: 1rem 0 0; padding: 0; }
.eng-list:empty { margin: 0; }
.eng-item { border-top: 1px solid var(--lightgray); padding: .9rem 0; }
.eng-item--reply { margin-left: 1.4rem; border-left: 2px solid var(--lightgray); padding-left: .9rem; }
.eng-item--owner { border-left: 2px solid var(--accent); padding-left: .9rem; }
.eng-who { font-family: var(--headerFont); font-weight: 700; font-size: .9rem; color: var(--dark); }
.eng-badge {
  font-family: var(--codeFont); font-size: .62rem; letter-spacing: .08em;
  text-transform: uppercase; color: var(--light); background: var(--accent);
  padding: .05rem .35rem; margin-left: .4rem;
}
.eng-when { font-family: var(--codeFont); font-size: .68rem; color: var(--gray); margin-left: .5rem; }
.eng-body { margin: .35rem 0 0; font-size: .92rem; line-height: 1.55; white-space: pre-wrap; }
.eng-del {
  background: none; border: 0; cursor: pointer; padding: 0;
  font-family: var(--codeFont); font-size: .66rem; color: var(--gray);
  text-transform: uppercase; letter-spacing: .07em; margin-top: .3rem;
}
.eng-del:hover { color: var(--accent); }

/* The composer opens BELOW the list, so opening it never pushes what you just
   read off screen. */
.eng-composer { margin-top: 1.25rem; }
.eng-composer[hidden] { display: none; }
.eng-form { display: flex; flex-direction: column; gap: .8rem; max-width: 40rem; }
.eng-row { display: flex; flex-direction: column; gap: .25rem; }
/* A name is about twelve characters; a full-bleed field misreports that. */
.eng-row--name { max-width: 15rem; }
.eng-lbl {
  font-family: var(--codeFont); font-size: .66rem; letter-spacing: .08em;
  text-transform: uppercase; color: var(--gray);
}
.eng-input {
  font-family: var(--bodyFont); font-size: .92rem; color: var(--darkgray);
  background: var(--light); border: 1px solid var(--lightgray); border-radius: 0;
  padding: .45rem .55rem; width: 100%;
}
/* A remembered value looked identical to placeholder text. Filled fields carry
   a faint wash so value never reads as empty. */
.eng-input:not(:placeholder-shown), .eng-input.is-filled { background: var(--accent-wash); }
.eng-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
.eng-area { resize: vertical; min-height: 7rem; line-height: 1.5; }
.eng-actions { display: flex; align-items: center; justify-content: flex-end; gap: .8rem; }
/* Outline, not solid. Exactly one element per page carries a solid accent fill
   — the category chip in the header — and Post was competing with it. */
.eng-submit { color: var(--accent); border-color: var(--accent); }
.eng-submit:hover { background: var(--accent); color: var(--light); }
.eng-submit[disabled] { opacity: .5; cursor: default; }
.eng-note { font-family: var(--codeFont); font-size: .7rem; color: var(--gray); }
.eng-off { font-family: var(--codeFont); font-size: .72rem; color: var(--gray); }

@media all and (max-width: 800px) {
  .eng-form, .eng-row--name { max-width: 100%; }
  /* Prevent Safari and Chrome on iOS from zooming the viewport on focus. */
  .eng-input { font-size: 1rem; }
}
`

  Component.afterDOMLoaded = `
(() => {
  function wireEngagement() {
  const root = document.querySelector(".eng");
  if (!root || root.dataset.wired) return;
  root.dataset.wired = "1";
  const listeners = new AbortController();
  const signal = listeners.signal;
  const slug = root.dataset.slug;

  const API = "/api";
  const LS_NAME = "eng-name";
  const LS_TOKENS = "eng-tokens";

  const $ = (s) => root.querySelector(s);
  const likeBtn  = $(".eng-like-btn");
  const countEl  = $(".eng-count");
  const toggle   = $(".eng-toggle");
  const firstBtn = $(".eng-first");
  const headCnt  = $(".eng-head-count");
  const list     = $(".eng-list");
  const composer = $(".eng-composer");
  const form     = $(".eng-form");
  const nameEl   = $("#eng-name");
  const bodyEl   = $("#eng-body");
  const noteEl   = $(".eng-note");
  const offEl    = $(".eng-off");
  const tsBox    = $(".eng-turnstile");

  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  /* ── Likes ─────────────────────────────────────────────────────────── */

  let liked = false;
  let count = 0;
  let inflight = false;
  let likeReady = false;
  const feedback = $(".eng-feedback");

  function paintLike() {
    likeBtn.setAttribute("aria-pressed", String(liked));
    likeBtn.setAttribute("aria-label", (liked ? "Remove like" : "Like this note") + " (" + count + ")");
    likeBtn.disabled = inflight || !likeReady;
    countEl.textContent = String(count);
    likeBtn.classList.toggle("eng-pending", inflight);
  }

  async function loadLikes() {
    try {
      const r = await fetch(API + "/likes?slug=" + encodeURIComponent(slug), { cache: "no-store" });
      if (!r.ok) return false;
      const d = await r.json();
      if (signal.aborted) return false;
      count = d.count | 0;
      liked = Boolean(d.liked);
      likeReady = true;
      paintLike();
      return true;
    } catch (e) { return false; }
  }

  likeBtn.addEventListener("click", async () => {
    if (inflight || !likeReady) return;
    const previous = { liked, count };
    feedback.textContent = "";
    liked = !liked;
    count = Math.max(0, count + (liked ? 1 : -1));
    inflight = true;
    paintLike();
    try {
      const r = await fetch(API + "/likes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, liked }),
      });
      const d = await r.json();
      if (signal.aborted) return;
      if (!r.ok) throw new Error(d.error || "Could not save your like. Try again.");
      count = d.count | 0;
      liked = Boolean(d.liked);
    } catch (e) {
      if (signal.aborted) return;
      liked = previous.liked;
      count = previous.count;
      feedback.textContent = e instanceof Error ? e.message : "Could not save your like. Try again.";
    } finally {
      inflight = false;
      if (!signal.aborted) paintLike();
    }
  }, { signal });

  /* ── Composer disclosure ───────────────────────────────────────────── */

  let commentCount = 0;

  function paintCounts() {
    headCnt.textContent = "(" + commentCount + ")";
    // With no comments the whole block collapses to a single inviting line.
    // With some, the list is shown and the composer hides behind a chip.
    firstBtn.hidden = commentCount !== 0 || !siteKey;
    toggle.hidden = commentCount === 0 || !siteKey;
    toggle.textContent = "Add a comment";
  }

  function openComposer() {
    if (!siteKey) return;
    composer.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    firstBtn.hidden = true;
    loadTurnstile();
    nameEl.focus({ preventScroll: true });
  }

  toggle.addEventListener("click", () => {
    if (composer.hidden) openComposer();
    else { composer.hidden = true; toggle.setAttribute("aria-expanded", "false"); }
  }, { signal });
  firstBtn.addEventListener("click", openComposer, { signal });

  /* ── Comments ──────────────────────────────────────────────────────── */

  const fmt = (t) => {
    try { return new Date(t).toISOString().slice(0, 10); } catch (e) { return ""; }
  };

  function render(comments) {
    list.textContent = "";
    commentCount = comments.length;
    const tokens = store.get(LS_TOKENS, {});
    const byParent = new Map();
    for (const c of comments) {
      const k = c.parent_id || "";
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k).push(c);
    }

    const add = (c, depth) => {
      const li = document.createElement("li");
      li.className = "eng-item" + (depth ? " eng-item--reply" : "") + (c.is_owner ? " eng-item--owner" : "");
      li.id = "c-" + c.id;

      const head = document.createElement("div");
      const who = document.createElement("span");
      who.className = "eng-who";
      // textContent, never innerHTML: comment text is untrusted input and must
      // never be parsed as markup.
      who.textContent = c.name;
      head.append(who);
      if (c.is_owner) {
        const b = document.createElement("span");
        b.className = "eng-badge";
        b.textContent = "Author";
        head.append(b);
      }
      const when = document.createElement("span");
      when.className = "eng-when";
      when.textContent = fmt(c.created_at);
      head.append(when);

      const body = document.createElement("p");
      body.className = "eng-body";
      body.textContent = c.body;

      li.append(head, body);

      if (tokens[c.id]) {
        const del = document.createElement("button");
        del.className = "eng-del";
        del.type = "button";
        del.textContent = "Delete";
        del.addEventListener("click", async () => {
          del.disabled = true;
          try {
            const r = await fetch(API + "/comments", {
              method: "DELETE",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ id: c.id, editToken: tokens[c.id] }),
            });
            if (!r.ok) throw new Error("Could not delete the comment. Try again.");
            const savedTokens = store.get(LS_TOKENS, {});
            delete savedTokens[c.id]; store.set(LS_TOKENS, savedTokens);
            if (signal.aborted) return;
            if (!(await load())) throw new Error("Deleted. Reload to refresh the comments.");
          } catch (e) {
            if (!signal.aborted) feedback.textContent = e.message || "Could not delete the comment. Try again.";
          } finally { del.disabled = false; }
        }, { signal });
        li.append(del);
      }

      list.append(li);
      for (const child of byParent.get(c.id) || []) add(child, depth + 1);
    };

    for (const c of byParent.get("") || []) add(c, 0);
    paintCounts();
  }

  async function load() {
    try {
      const r = await fetch(API + "/comments?slug=" + encodeURIComponent(slug), { cache: "no-store" });
      if (!r.ok) return false;
      const d = await r.json();
      if (signal.aborted) return false;
      render(d.comments || []);
      return true;
    } catch (e) { return false; }
  }

  /* ── Turnstile, loaded lazily on first interaction ─────────────────── */

  const siteKey = document.querySelector('meta[name="turnstile-site-key"]')?.content;
  let tsReady = false;
  let tsToken = null;
  let tsWidgetId = null;

  function loadTurnstile() {
    if (tsReady || !siteKey) return;
    tsReady = true;
    const renderWidget = () => {
      if (signal.aborted || !root.isConnected) return;
      try {
        tsWidgetId = window.turnstile.render(tsBox, {
          sitekey: siteKey,
          action: "comment",
          theme: "auto",
          callback: (t) => { tsToken = t; },
          "expired-callback": () => {
            tsToken = null;
            noteEl.textContent = "Verification expired — try again.";
          },
          "error-callback": () => {
            tsToken = null;
            noteEl.textContent = "Verification unavailable — reload and try again.";
          },
        });
        // The ID is public widget state, not a credential. Keeping it lets us
        // reset this exact widget after each single-use token is submitted.
        tsBox.dataset.turnstileWidgetId = String(tsWidgetId);
      } catch (e) {
        tsReady = false;
        noteEl.textContent = "Verification unavailable — try again.";
      }
    };
    if (window.turnstile) { renderWidget(); return; }
    let script = document.querySelector('script[data-eng-turnstile]');
    if (!script) {
      script = document.createElement("script");
      script.dataset.engTurnstile = "1";
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      document.head.append(script);
    }
    script.addEventListener("load", renderWidget, { once: true, signal });
    script.addEventListener("error", () => {
      script.remove(); tsReady = false;
      noteEl.textContent = "Verification unavailable — try again.";
    }, { once: true, signal });
  }

  // Marks a prefilled field as filled: :placeholder-shown cannot help when
  // there is no placeholder, and a remembered name looked like ghost text.
  const markFilled = (el) => el.classList.toggle("is-filled", el.value.trim() !== "");
  if (siteKey) {
    nameEl.value = store.get(LS_NAME, "") || "";
    markFilled(nameEl);
    for (const el of [nameEl, bodyEl]) el.addEventListener("input", () => markFilled(el), { signal });
  } else {
    offEl.hidden = false;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = nameEl.value.trim();
    const body = bodyEl.value.trim();
    if (!name || body.length < 2) { noteEl.textContent = "Add a name and a comment."; return; }
    if (siteKey && !tsToken) { noteEl.textContent = "Just a moment — verifying."; loadTurnstile(); return; }

    const btn = form.querySelector(".eng-submit");
    btn.disabled = true;
    noteEl.textContent = "Posting…";

    try {
      const r = await fetch(API + "/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, name, body, turnstileToken: tsToken }),
      });
      const d = await r.json();
      if (!r.ok) { if (!signal.aborted) noteEl.textContent = d.error || "That did not go through."; return; }

      store.set(LS_NAME, name);
      const tokens = store.get(LS_TOKENS, {});
      tokens[d.id] = d.editToken;
      store.set(LS_TOKENS, tokens);
      if (signal.aborted) return;

      bodyEl.value = "";
      markFilled(bodyEl);
      noteEl.textContent = "Posted.";
      await load();
      if (signal.aborted) return;
      // Posting is the one case where a form should stay open — people often
      // have a second thought straight after.
      composer.hidden = false;
      toggle.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
    } catch (e) {
      if (!signal.aborted) noteEl.textContent = "Network problem — try again.";
    } finally {
      // Turnstile tokens are single-use even when our API rejects the request.
      // Clear and reset after every network attempt so a retry always receives
      // a fresh token and targets the widget that minted the submitted token.
      tsToken = null;
      if (!signal.aborted && tsWidgetId !== null) {
        try { window.turnstile?.reset(tsWidgetId); } catch (e) {}
      }
      if (!signal.aborted) btn.disabled = false;
    }
  }, { signal });

  window.addCleanup?.(() => {
    listeners.abort(); delete root.dataset.wired;
    form.querySelector(".eng-submit").disabled = false;
    noteEl.textContent = "";
    if (tsWidgetId !== null) {
      try { window.turnstile?.remove(tsWidgetId); } catch (e) {}
    }
  });
  paintLike();
  (async () => {
    const ok = await Promise.all([loadLikes(), load()]);
    if (ok.some(Boolean)) root.hidden = false;
  })();
  }

  // Component modules are imported once, while Quartz replaces page content
  // on every client-side navigation. Wire the new engagement root each time;
  // the per-root data flag above prevents duplicate listeners.
  document.addEventListener("nav", wireEngagement);
  wireEngagement();
})();
`
  return Component
}

export default Engagement
export { Engagement }
