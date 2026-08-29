import type {
  QuartzComponent,
  QuartzComponentConstructor,
  QuartzComponentProps,
} from "@quartz-community/types"

/**
 * The left rail: Recent · Categories · Explorer.
 *
 * Renders the first two panes itself and toggles Quartz's own explorer, which
 * stays a separate component. The active pane is written to `data-panel` on
 * <body> and remembered in localStorage; CSS does the showing and hiding, so
 * switching costs no re-render and works before hydration.
 *
 * Categories come from MOC pages — a note belongs to a category because that
 * category's page links to it. Only published MOCs appear, so a private MOC
 * can never leak its title here.
 */

interface FileLike {
  slug?: string
  frontmatter?: Record<string, unknown>
  dates?: { modified?: Date | string; created?: Date | string }
}

const ACCENTS = ["vermilion", "ochre", "verdigris", "ultramarine", "aubergine", "oxblood"]

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)

function titleOf(f: FileLike): string {
  return str(f.frontmatter?.title) ?? f.slug ?? "Untitled"
}

function accentOf(f: FileLike): string {
  const a = str(f.frontmatter?.accent)
  return a && ACCENTS.includes(a) ? a : "neutral"
}

function timeOf(f: FileLike): number {
  const d = f.dates?.modified ?? f.dates?.created
  if (!d) return 0
  const t = d instanceof Date ? d.getTime() : Date.parse(String(d))
  return Number.isFinite(t) ? t : 0
}

const Panel: QuartzComponentConstructor = () => {
  const Component: QuartzComponent = ({ fileData, allFiles }: QuartzComponentProps) => {
    const here = fileData?.slug
    const files = (allFiles as FileLike[]).filter(
      (f) => f.slug && f.slug !== "404" && !f.slug.startsWith("tags/"),
    )

    // ── Recent: newest first.
    const recent = files
      .slice()
      .sort((a, b) => timeOf(b) - timeOf(a))
      .slice(0, 40)

    // ── Categories: grouped by MOC, with the MOC's own page first.
    const groups = new Map<string, { slug: string | null; items: FileLike[] }>()
    const unfiled: FileLike[] = []
    for (const f of files) {
      const moc = str(f.frontmatter?.moc)
      if (f.frontmatter?.isMoc === true) {
        const name = titleOf(f)
        const g = groups.get(name) ?? { slug: f.slug ?? null, items: [] }
        g.slug = f.slug ?? null
        groups.set(name, g)
        continue
      }
      if (!moc) {
        unfiled.push(f)
        continue
      }
      const g = groups.get(moc) ?? { slug: null, items: [] }
      g.items.push(f)
      groups.set(moc, g)
    }
    const categories = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))

    // Tag counts across published notes. Structural tags are already stripped
    // upstream by note-header, but guard here too so the pane never shows
    // plumbing.
    const STRUCTURAL = new Set(["moc", "index", "publish", "draft", "area", "spine"])
    const tagCounts = new Map<string, number>()
    for (const f of files) {
      const raw = f.frontmatter?.tags
      if (!Array.isArray(raw)) continue
      for (const t of raw) {
        if (typeof t !== "string") continue
        const tag = t.trim()
        if (!tag || STRUCTURAL.has(tag.toLowerCase())) continue
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
      }
    }
    const tagList = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))

    const Row = ({ f }: { f: FileLike }) => (
      <li class="pn-row" data-accent={accentOf(f)}>
        <a href={`./${f.slug}`} aria-current={f.slug === here ? "page" : undefined}>
          <span class="pn-rule" aria-hidden="true"></span>
          <span class="pn-title">{titleOf(f)}</span>
        </a>
      </li>
    )

    return (
      <nav class="pn" aria-label="Site navigation">
        <div class="pn-tabs" role="tablist">
          <button class="pn-tab" data-pane="recent" role="tab">
            Recent
          </button>
          <button class="pn-tab" data-pane="categories" role="tab">
            Categories
          </button>
          <button class="pn-tab" data-pane="tags" role="tab">
            Tags
          </button>
          <button class="pn-tab" data-pane="explorer" role="tab">
            Tree
          </button>
        </div>

        <div class="pn-pane" data-pane="recent">
          <ol class="pn-list">
            {recent.map((f) => (
              <Row key={f.slug} f={f} />
            ))}
          </ol>
        </div>

        {/* Tags are navigation, so they live here rather than being surfaced
            as filter chips inside search. That is what let the search dialog
            go away entirely. */}
        <div class="pn-pane" data-pane="tags">
          {tagList.length === 0 ? (
            <p class="pn-empty">No tags on published notes yet.</p>
          ) : (
            <ul class="pn-tags">
              {tagList.map(([tag, n]) => (
                <li key={tag}>
                  <a href={`./tags/${tag}`}>
                    {tag}
                    <span class="pn-tag-n">{n}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div class="pn-pane" data-pane="categories">
          {categories.length === 0 && (
            <p class="pn-empty">
              No published categories yet. Publish a note tagged <code>#moc</code> and the notes it
              links to are grouped under its title.
            </p>
          )}
          {categories.map(([name, g]) => (
            <section class="pn-group" key={name}>
              <h2 class="pn-group-title">{g.slug ? <a href={`./${g.slug}`}>{name}</a> : name}</h2>
              <ol class="pn-list">
                {g.items
                  .slice()
                  .sort((a, b) => titleOf(a).localeCompare(titleOf(b)))
                  .map((f) => (
                    <Row key={f.slug} f={f} />
                  ))}
              </ol>
            </section>
          ))}
          {unfiled.length > 0 && (
            <section class="pn-group">
              {/* Surfacing this is deliberate: it shows what you have published
                  but never filed, which is a useful signal, not a defect. */}
              <h2 class="pn-group-title pn-group-title--muted">Unfiled</h2>
              <ol class="pn-list">
                {unfiled
                  .slice()
                  .sort((a, b) => timeOf(b) - timeOf(a))
                  .map((f) => (
                    <Row key={f.slug} f={f} />
                  ))}
              </ol>
            </section>
          )}
        </div>
      </nav>
    )
  }

  Component.css = `
.pn { display: flex; flex-direction: column; gap: .75rem; }
.pn-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--lightgray); }
.pn-tab {
  flex: 1; background: none; border: 0; cursor: pointer;
  padding: .4rem .1rem .5rem; color: var(--gray);
  font-family: var(--codeFont); font-size: .64rem; letter-spacing: .06em;
  text-transform: uppercase; border-bottom: 2px solid transparent;
  margin-bottom: -1px; transition: color 120ms ease;
}
.pn-tab:hover { color: var(--dark); }
.pn-tab[aria-selected="true"] { color: var(--dark); border-bottom-color: var(--accent); }

/* Panes and the explorer are shown by body[data-panel]; see custom.scss. */
.pn-pane { display: none; }
.pn-list { list-style: none; margin: 0; padding: 0; }
.pn-row a {
  display: flex; align-items: baseline; gap: .5rem;
  padding: .1rem 0; text-decoration: none; color: var(--gray);
  font-size: .82rem; line-height: 1.28;
}
/* Space BETWEEN entries must exceed the space within a wrapped entry, or a
   two-line title reads as two items. */
.pn-row + .pn-row { margin-top: .55rem; }
.pn-row a:hover { color: var(--dark); }
/* 600 at this size out-weighs body copy; 500 is enough to mark position. */
.pn-row a[aria-current="page"] { color: var(--dark); font-weight: 500; }

/* Each row carries its own note's accent — the rail doubles as a colour key
   to the site. */
.pn-rule { flex: 0 0 .85rem; height: 2px; margin-top: .5rem; background: var(--row-accent, var(--gray)); }
.pn-row[data-accent="vermilion"]   { --row-accent: #CD311D; }
.pn-row[data-accent="ochre"]       { --row-accent: #92640D; }
.pn-row[data-accent="verdigris"]   { --row-accent: #3F6B5F; }
.pn-row[data-accent="ultramarine"] { --row-accent: #1F3FA8; }
.pn-row[data-accent="aubergine"]   { --row-accent: #5B3A8C; }
.pn-row[data-accent="oxblood"]     { --row-accent: #7A2540; }
.pn-row[data-accent="neutral"]     { --row-accent: #A79E8C; }
:root[saved-theme="dark"] .pn-row[data-accent="vermilion"]   { --row-accent: #E24531; }
:root[saved-theme="dark"] .pn-row[data-accent="ochre"]       { --row-accent: #C98A12; }
:root[saved-theme="dark"] .pn-row[data-accent="verdigris"]   { --row-accent: #508879; }
:root[saved-theme="dark"] .pn-row[data-accent="ultramarine"] { --row-accent: #5777E0; }
:root[saved-theme="dark"] .pn-row[data-accent="aubergine"]   { --row-accent: #906DC3; }
:root[saved-theme="dark"] .pn-row[data-accent="oxblood"]     { --row-accent: #CC557B; }
:root[saved-theme="dark"] .pn-row[data-accent="neutral"]     { --row-accent: #6E6656; }

.pn-group { margin-bottom: 1.1rem; }
.pn-group-title {
  font-family: var(--codeFont); font-size: .68rem; letter-spacing: .09em;
  text-transform: uppercase; color: var(--gray); font-weight: 400;
  margin: 0 0 .3rem; border: 0; padding: 0;
}
.pn-group-title a { color: var(--gray); text-decoration: none; }
.pn-group-title a:hover { color: var(--accent); }
.pn-group-title--muted { opacity: .7; }
.pn-empty { font-size: .78rem; color: var(--gray); line-height: 1.5; }

.pn-tags { list-style: none; display: flex; flex-wrap: wrap; gap: .3rem; padding: 0; margin: 0; }
/* Same outline chip as tags on a note and as tag matches in search — one
   vocabulary across the site. */
.pn-tags a {
  display: inline-block; text-decoration: none;
  font-family: var(--codeFont); font-size: .66rem; letter-spacing: .07em;
  text-transform: uppercase; color: var(--gray);
  border: 1px solid var(--lightgray); padding: .08rem .35rem;
}
.pn-tags a:hover { color: var(--accent); border-color: var(--accent); }
.pn-tag-n { opacity: .6; margin-left: .3em; }
`

  Component.afterDOMLoaded = `
(() => {
  const KEY = "panel-pane";
  const PANES = new Set(["recent", "categories", "tags", "explorer"]);

  function apply(pane) {
    if (!PANES.has(pane)) pane = "recent";
    document.body.setAttribute("data-panel", pane);
    for (const t of document.querySelectorAll(".pn-tab")) {
      t.setAttribute("aria-selected", String(t.dataset.pane === pane));
    }
    try { localStorage.setItem(KEY, pane); } catch (e) {}
  }

  function wirePanel() {
    const root = document.querySelector(".pn");
    if (!root) return;

    let saved = "recent";
    try { saved = localStorage.getItem(KEY) || "recent"; } catch (e) {}
    apply(saved);

    if (!root.dataset.panelWired) {
      root.dataset.panelWired = "1";
      root.addEventListener("click", (e) => {
        const tab = e.target.closest(".pn-tab");
        if (tab) apply(tab.dataset.pane);
      });
    }

    /*
     * Explorer ARIA patch.
     *
     * Upstream's explorer puts aria-expanded on the container <div>, which is not
     * a valid ARIA combination — the attribute belongs on the control that does
     * the expanding. There IS a real <button class="explorer-toggle"> already
     * carrying aria-controls, so the state just needs to live there instead.
     *
     * Stripping it server-side was not enough: the explorer's own script re-adds
     * it whenever the tree collapses, which is the default on mobile. This
     * mirrors the state onto the button and keeps the container clean, including
     * after the explorer writes to it again.
     *
     * Small enough to send upstream as a PR; delete this when it lands.
     */
    const explorer = document.querySelector(".explorer");
    const explorerBtn = document.querySelector(".explorer-toggle");
    if (explorer && explorerBtn && !explorer.dataset.panelAriaWired) {
      explorer.dataset.panelAriaWired = "1";
      const mirror = () => {
        const state = explorer.getAttribute("aria-expanded");
        if (state === null) return;
        explorer.removeAttribute("aria-expanded");
        explorerBtn.setAttribute("aria-expanded", state);
      };
      // Collapsed state is also expressed as a data attribute, so seed from that
      // when the explorer has not written aria-expanded yet.
      explorerBtn.setAttribute(
        "aria-expanded",
        String(explorer.dataset.collapsed !== "collapsed"),
      );
      mirror();
      new MutationObserver(mirror).observe(explorer, {
        attributes: true,
        attributeFilter: ["aria-expanded"],
      });
    }
  }

  // Quartz replaces page markup and body attributes during client-side
  // navigation. Reapply the remembered pane and wire any newly rendered root.
  document.addEventListener("nav", wirePanel);
  wirePanel();
})();
`
  return Component
}

export default Panel
export { Panel }
