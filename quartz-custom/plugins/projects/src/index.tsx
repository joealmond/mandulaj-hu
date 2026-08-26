import type {
  QuartzComponent,
  QuartzComponentConstructor,
  QuartzComponentProps,
} from "@quartz-community/types"

/**
 * Portfolio listing, rendered only on the /projects page.
 *
 * A project is any published note whose frontmatter has `type: project`.
 * Nothing else distinguishes it — projects live in the vault under Projects/
 * and go through the same publish gate as every other note, so the portfolio
 * cannot accidentally contain something unpublished.
 *
 * Sorted newest first by `year`, then title.
 */
interface ProjectData {
  slug: string
  frontmatter?: Record<string, unknown>
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null)

const list = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : typeof v === "string"
      ? v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : []

const ProjectsList: QuartzComponentConstructor = () => {
  const Component: QuartzComponent = ({ fileData, allFiles }: QuartzComponentProps) => {
    // Only ever renders on the projects page.
    if (fileData?.slug !== "projects") return null

    const projects = (allFiles as ProjectData[])
      .filter((f) => f.frontmatter?.type === "project")
      .sort((a, b) => {
        const ya = Number(a.frontmatter?.year ?? 0)
        const yb = Number(b.frontmatter?.year ?? 0)
        if (ya !== yb) return yb - ya
        return String(a.frontmatter?.title ?? "").localeCompare(String(b.frontmatter?.title ?? ""))
      })

    if (projects.length === 0) {
      return (
        <p class="pj-empty">
          No projects published yet. Add <code>type: project</code> and <code>publish: true</code>{" "}
          to a note under <code>Projects/</code> in the vault.
        </p>
      )
    }

    return (
      <ol class="pj">
        {projects.map((p) => {
          const fm = p.frontmatter ?? {}
          const title = str(fm.title) ?? p.slug
          const year = str(String(fm.year ?? "")) ?? ""
          const stack = list(fm.stack)
          const link = str(fm.link)
          const summary = str(fm.description)

          return (
            <li class="pj-item" key={p.slug}>
              <div class="pj-year">{year}</div>
              <div class="pj-body">
                <h3 class="pj-title">
                  <a href={`./${p.slug}`}>{title}</a>
                </h3>
                {summary && <p class="pj-summary">{summary}</p>}
                {stack.length > 0 && (
                  <ul class="pj-stack">
                    {stack.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                )}
                {link && (
                  <a class="pj-link" href={link} rel="noopener">
                    Source ↗
                  </a>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    )
  }

  Component.css = `
.pj { list-style: none; padding: 0; margin: 2rem 0 0; max-width: var(--measure, 34rem); }
.pj-item {
  display: grid; grid-template-columns: 4.5rem 1fr; gap: 1rem;
  padding: 1.4rem 0; border-top: 1px solid var(--lightgray);
}
.pj-item:first-child { border-top: var(--rule-weight, 3px) solid var(--dark); }
.pj-year {
  font-family: var(--codeFont); font-size: .75rem; letter-spacing: .06em;
  color: var(--gray); padding-top: .25rem;
}
.pj-title { margin: 0 0 .3rem; font-size: 1.1rem; }
.pj-title a { text-decoration: none; color: var(--dark); }
.pj-title a:hover { color: var(--accent); }
.pj-summary { margin: 0 0 .5rem; font-size: .92rem; line-height: 1.55; color: var(--darkgray); }
.pj-stack { list-style: none; display: flex; flex-wrap: wrap; gap: .35rem; padding: 0; margin: 0 0 .5rem; }
.pj-stack > li {
  font-family: var(--codeFont); font-size: .68rem; letter-spacing: .04em;
  text-transform: uppercase; color: var(--gray);
  border: 1px solid var(--lightgray); padding: .1rem .4rem;
}
.pj-link { font-family: var(--codeFont); font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; }
.pj-empty { font-size: .92rem; color: var(--gray); }
@media all and (max-width: 800px) {
  .pj-item { grid-template-columns: 1fr; gap: .3rem; }
  .pj-year { padding-top: 0; }
}
`
  return Component
}

export default ProjectsList
export { ProjectsList }
