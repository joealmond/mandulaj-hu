import type {
  QuartzComponent,
  QuartzComponentConstructor,
  QuartzComponentProps,
} from "@quartz-community/types"

/**
 * The accent block at the top of a note.
 *
 * This slot used to hold a four-digit id derived from the slug. That id
 * encoded nothing — it was decoration in the most prominent position on the
 * page. It now carries the note's category (its MOC) and links to it, so the
 * boldest element tells you where you are and takes you somewhere.
 *
 * Uncategorised notes get the year instead, rendered in the neutral accent, so
 * "no colour" reads as "not filed" rather than implying a category.
 */
const NoteHeader: QuartzComponentConstructor = () => {
  const Component: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
    const fm = (fileData?.frontmatter ?? {}) as Record<string, unknown>
    /*
     * Quartz promotes inline `#tags` into frontmatter, so this list also
     * contains the structural ones the vault uses for organisation rather than
     * subject matter. They are plumbing — filtering them here keeps `moc` and
     * `index` out of the page and out of the search facets.
     */
    const STRUCTURAL = new Set(["moc", "index", "publish", "draft", "area", "spine"])
    const tags = (Array.isArray(fm.tags) ? (fm.tags as unknown[]) : [])
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter((t) => t && !STRUCTURAL.has(t.toLowerCase()))

    /*
     * Tags carry `data-pagefind-filter` so Pagefind builds a facet index from
     * them at build time — that is the ONLY way the search dialog can offer
     * filter chips. They are inside `.center`, which pagefind.yml sets as the
     * root selector, so they are indexed.
     */
    const Tags = () =>
      tags.length === 0 ? null : (
        <ul class="nh-tags">
          {tags.map((t) => (
            <li key={t}>
              <a href={`./tags/${t}`} data-pagefind-filter={`tag:${t}`}>
                {t}
              </a>
            </li>
          ))}
        </ul>
      )
    const moc = typeof fm.moc === "string" ? fm.moc : null
    const mocSlug = typeof fm.mocSlug === "string" ? fm.mocSlug : null
    const isMoc = fm.isMoc === true

    // A category page labels itself as one rather than pointing at a parent.
    if (isMoc) {
      return (
        <>
          <div class="nh">
            <span class="nh-label nh-label--moc">Category</span>
          </div>
          <Tags />
        </>
      )
    }

    if (moc) {
      return (
        <>
          <div class="nh">
            {mocSlug ? (
              <a class="nh-label" href={`./${mocSlug}`}>
                {moc}
              </a>
            ) : (
              <span class="nh-label">{moc}</span>
            )}
          </div>
          <Tags />
        </>
      )
    }

    const year =
      fileData?.dates?.modified instanceof Date ? String(fileData.dates.modified.getFullYear()) : ""
    return (
      <>
        <div class="nh">
          <span class="nh-label nh-label--none">{year || "Note"}</span>
        </div>
        <Tags />
      </>
    )
  }

  Component.css = `
.nh { display: flex; align-items: center; }
.nh-tags { list-style: none; display: flex; flex-wrap: wrap; gap: .3rem; margin: 0; padding: 0; }
.nh-tags a { white-space: nowrap; }
.nh-tags a {
  display: inline-block;
  font-family: var(--codeFont);
  font-size: .68rem;
  /* Mono carries wide sidebearings already, so it wants about half the
     tracking an uppercase Archivo label does. */
  letter-spacing: .07em;
  text-transform: uppercase;
  border: 1px solid var(--lightgray);
  padding: .1rem .38rem;
  text-decoration: none;
  /* letter-spacing adds trailing space after the last glyph, which makes the
     right padding read wider than the left. Pull it back optically. */
  margin-right: 0;
  text-indent: 0;
}
.nh-tags a::after { content: ""; margin-left: -.07em; }
.nh-label {
  display: inline-flex;
  align-items: center;
  background: var(--accent);
  color: var(--light);
  font-family: var(--headerFont);
  font-weight: 800;
  font-size: 1rem;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  padding: 0.34rem 0.8rem 0.3rem;
  text-decoration: none;
  max-width: 22rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: opacity 120ms ease;
}
a.nh-label:hover { opacity: 0.86; text-decoration: none; }
.nh-label--none, .nh-label--moc {
  font-family: var(--codeFont);
  font-weight: 400;
  font-size: 0.78rem;
  letter-spacing: 0.1em;
}
@media all and (max-width: 800px) {
  .nh-label { font-size: 0.86rem; max-width: 60vw; }
}
`
  return Component
}

export default NoteHeader
export { NoteHeader }
