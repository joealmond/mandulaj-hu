import type { QuartzComponent, QuartzComponentConstructor } from "@quartz-community/types"

/**
 * Search, in the rail rather than in a modal.
 *
 * The first version was a centred overlay. It existed mainly to have somewhere
 * to put tag filter chips, which is backwards reasoning: the chrome came first
 * and the content was found to fill it. It also put a dim over the note you
 * were reading, left the sidebar's own search affordance visible behind it, and
 * showed an empty result list under six tags.
 *
 * Now the sidebar field IS the search surface. Typing filters in place and the
 * Recent / Categories / Tree row is replaced by results; Esc restores it.
 * Nothing covers the page. Tags are navigation, so they live in their own pane
 * of the rail and appear here only as matches above the note results.
 *
 * Mobile is the exception and keeps a sheet, because there is no rail to type
 * into — the same component, promoted to full screen by CSS.
 */
const PagefindSearch: QuartzComponentConstructor = () => {
  const Component: QuartzComponent = () => (
    <div class="pf">
      <div class="pf-field">
        <svg
          class="pf-icon"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="16.5" y1="16.5" x2="21" y2="21" />
        </svg>
        <input
          class="pf-input"
          type="search"
          placeholder="Search"
          aria-label="Search notes"
          autocomplete="off"
          spellcheck={false}
        />
        <kbd class="pf-key">/</kbd>
        <button class="pf-clear" type="button" aria-label="Clear search" hidden>
          &times;
        </button>
      </div>

      <div class="pf-results" hidden>
        <div class="pf-status" role="status" aria-live="polite"></div>
        <div class="pf-tags" hidden>
          <div class="pf-group-label">Tags</div>
          <ul class="pf-taglist"></ul>
        </div>
        <ol class="pf-list"></ol>
      </div>
    </div>
  )

  Component.css = `
.pf { display: flex; flex-direction: column; flex: 1; min-width: 0; }

.pf-field {
  display: flex; align-items: center; gap: .4rem;
  border: 1px solid var(--lightgray); padding: 0 .5rem; height: 2rem;
  transition: border-color 120ms ease;
}
.pf-field:focus-within { border-color: var(--accent); }
.pf-icon { flex: 0 0 auto; color: var(--gray); }
.pf-input {
  flex: 1; min-width: 0; border: 0; background: none; outline: none; padding: 0;
  font-family: var(--codeFont); font-size: .72rem; letter-spacing: .05em;
  color: var(--dark); text-transform: uppercase;
}
.pf-input::placeholder { color: var(--gray); text-transform: uppercase; }
.pf-input::-webkit-search-cancel-button { display: none; }
.pf-key {
  font-family: var(--codeFont); font-size: .66rem; color: var(--gray);
  border: 1px solid var(--lightgray); padding: 0 .25rem; line-height: 1.4;
}
.pf-clear {
  background: none; border: 0; cursor: pointer; color: var(--gray);
  font-size: 1rem; line-height: 1; padding: 0 .1rem;
}
.pf-clear:hover { color: var(--accent); }
.pf-clear[hidden], .pf-key[hidden] { display: none; }

/* Results take the full rail width. The toolbar is a flex row, so they wrap
   onto their own line rather than squeezing in beside the darkmode toggle. */
.pf-results { flex-basis: 100%; margin-top: .75rem; }
.pf-results[hidden] { display: none; }

.pf-status {
  font-family: var(--codeFont); font-size: .66rem; letter-spacing: .08em;
  text-transform: uppercase; color: var(--gray); margin-bottom: .5rem;
}
.pf-status:empty { display: none; }

.pf-group-label {
  font-family: var(--codeFont); font-size: .66rem; letter-spacing: .09em;
  text-transform: uppercase; color: var(--gray); margin-bottom: .35rem;
}
.pf-tags[hidden] { display: none; }
.pf-taglist { list-style: none; display: flex; flex-wrap: wrap; gap: .3rem; padding: 0; margin: 0 0 1rem; }
/* Same outline treatment as tags on a note — one chip vocabulary, not a
   search-specific variant. */
.pf-taglist a {
  display: inline-block; text-decoration: none;
  font-family: var(--codeFont); font-size: .66rem; letter-spacing: .07em;
  text-transform: uppercase; color: var(--gray);
  border: 1px solid var(--lightgray); padding: .08rem .35rem;
}
.pf-taglist a:hover { color: var(--accent); border-color: var(--accent); }
.pf-n { opacity: .6; margin-left: .3em; }

.pf-list { list-style: none; margin: 0; padding: 0; }
.pf-list > li { margin-bottom: .7rem; }
.pf-list a { display: block; text-decoration: none; color: var(--gray); }
.pf-list a:hover, .pf-list a:focus-visible,
.pf-list li[aria-selected="true"] a { color: var(--dark); outline: none; }
.pf-title {
  font-family: var(--bodyFont); font-size: .82rem; font-weight: 500;
  line-height: 1.28; color: var(--dark); margin: 0 0 .15rem;
}
.pf-excerpt {
  margin: 0; font-size: .72rem; line-height: 1.4; color: var(--gray);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}
.pf-excerpt mark { background: var(--accent-wash); color: var(--dark); font-weight: 600; }

/* ── Mobile: no rail to type into, so results become a sheet ───────────── */
@media all and (max-width: 800px) {
  body[data-searching="true"] .pf-results {
    position: fixed; inset: 3.5rem 0 0; z-index: 80;
    background: var(--light); overflow-y: auto;
    padding: 1rem; margin: 0;
    border-top: 1px solid var(--lightgray);
  }
  .pf-key { display: none; }
}
`

  Component.afterDOMLoaded = `
(() => {
  const root = document.querySelector(".pf");
  if (!root || root.dataset.wired) return;
  root.dataset.wired = "1";

  const input   = root.querySelector(".pf-input");
  const clear   = root.querySelector(".pf-clear");
  const key     = root.querySelector(".pf-key");
  const results = root.querySelector(".pf-results");
  const status  = root.querySelector(".pf-status");
  const tagsBox = root.querySelector(".pf-tags");
  const tagList = root.querySelector(".pf-taglist");
  const list    = root.querySelector(".pf-list");

  let pagefind = null;
  let allTags = {};
  let token = 0;
  let cursor = -1;

  // The index is fetched on first use, not on page load: it is dead weight for
  // a reader who never searches.
  async function ensure() {
    if (pagefind) return pagefind;
    try {
      pagefind = await import(/* webpackIgnore: true */ "/pagefind/pagefind.js");
      await pagefind.options({ excerptLength: 18 });
      try { allTags = (await pagefind.filters()).tag || {}; } catch (e) { allTags = {}; }
      return pagefind;
    } catch (e) {
      status.textContent = "Search index unavailable";
      return null;
    }
  }

  function setSearching(on) {
    document.body.setAttribute("data-searching", on ? "true" : "false");
    results.hidden = !on;
    clear.hidden = !on;
    key.hidden = on;
    if (!on) { list.textContent = ""; tagsBox.hidden = true; status.textContent = ""; cursor = -1; }
  }

  function paintTags(q) {
    tagList.textContent = "";
    const hits = Object.keys(allTags)
      .filter((t) => t.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => (allTags[b] - allTags[a]) || a.localeCompare(b))
      .slice(0, 8);
    tagsBox.hidden = hits.length === 0;
    for (const t of hits) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = "/tags/" + encodeURIComponent(t);
      a.textContent = t;
      const n = document.createElement("span");
      n.className = "pf-n";
      n.textContent = String(allTags[t]);
      a.append(n);
      li.append(a);
      tagList.append(li);
    }
  }

  function paint(items, q) {
    list.textContent = "";
    cursor = -1;
    if (!items.length) {
      status.textContent = tagsBox.hidden ? "No matches" : "";
      return;
    }
    status.textContent = items.length + (items.length === 1 ? " result" : " results");
    for (const r of items) {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      const a = document.createElement("a");
      a.href = r.url.replace(/\\.html$/, "");
      const h = document.createElement("p");
      h.className = "pf-title";
      h.textContent = r.meta && r.meta.title ? r.meta.title : r.url;
      const p = document.createElement("p");
      p.className = "pf-excerpt";
      p.innerHTML = r.excerpt; // Pagefind emits only <mark> here
      a.append(h, p);
      li.append(a);
      list.append(li);
    }
  }

  async function run() {
    const q = input.value.trim();
    const mine = ++token;
    if (!q) { setSearching(false); return; }

    setSearching(true);
    const pf = await ensure();
    if (!pf) return;
    paintTags(q);
    status.textContent = "Searching";
    const search = await pf.search(q);
    if (mine !== token) return;
    const data = await Promise.all(search.results.slice(0, 12).map((r) => r.data()));
    if (mine !== token) return;
    paint(data, q);
  }

  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(run, 120);
  });
  input.addEventListener("focus", ensure, { once: true });

  clear.addEventListener("click", () => {
    input.value = "";
    setSearching(false);
    input.focus();
  });

  function move(delta) {
    const items = [...list.querySelectorAll("li")];
    if (!items.length) return;
    if (cursor >= 0) items[cursor].removeAttribute("aria-selected");
    cursor = (cursor + delta + items.length) % items.length;
    items[cursor].setAttribute("aria-selected", "true");
    items[cursor].scrollIntoView({ block: "nearest" });
  }

  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (e.key === "/" && !typing) { e.preventDefault(); input.focus(); return; }
    if (document.body.getAttribute("data-searching") !== "true") return;
    if (e.key === "Escape") { input.value = ""; setSearching(false); input.blur(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter" && cursor >= 0) {
      const a = list.querySelectorAll("li")[cursor].querySelector("a");
      if (a) window.location.assign(a.href);
    }
  });
})();
`
  return Component
}

export default PagefindSearch
export { PagefindSearch }
