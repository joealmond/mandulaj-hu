import type {
  QuartzComponent,
  QuartzComponentConstructor,
  QuartzComponentProps,
} from "@quartz-community/types"

interface FileLike {
  slug?: string
  frontmatter?: Record<string, unknown>
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null

const order = (file: FileLike): number => {
  const value = file.frontmatter?.seriesOrder
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}

const title = (file: FileLike): string => text(file.frontmatter?.title) ?? file.slug ?? "Untitled"

const SeriesNav: QuartzComponentConstructor = () => {
  const Component: QuartzComponent = ({ fileData, allFiles }: QuartzComponentProps) => {
    const here = fileData?.slug
    const series = text(fileData?.frontmatter?.series)
    if (!here || !series) return null

    const items = (allFiles as FileLike[])
      .filter((file) => file.slug && text(file.frontmatter?.series) === series)
      .sort((left, right) => order(left) - order(right) || title(left).localeCompare(title(right)))
    if (items.length < 2) return null

    const position = items.findIndex((file) => file.slug === here)
    if (position < 0) return null
    const previous = items[position - 1]
    const next = items[position + 1]

    const Link = ({ file, direction }: { file: FileLike; direction: "Previous" | "Next" }) =>
      file.slug ? (
        <a class={`sn-link sn-link--${direction.toLowerCase()}`} href={`/${file.slug}`}>
          <span class="sn-direction">{direction}</span>
          <strong>{title(file)}</strong>
        </a>
      ) : null

    return (
      <nav class="sn" aria-label={`${series} series navigation`}>
        <p class="sn-meta">
          <span>{series}</span>
          <span>
            {position + 1} of {items.length}
          </span>
        </p>
        <div class="sn-links">
          {previous ? <Link file={previous} direction="Previous" /> : <span />}
          {next ? <Link file={next} direction="Next" /> : <span />}
        </div>
      </nav>
    )
  }

  Component.css = `
.sn { margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid var(--lightgray); }
.sn-meta { display: flex; justify-content: space-between; gap: 1rem; margin: 0 0 .75rem; color: var(--gray); font-family: var(--codeFont); font-size: .68rem; letter-spacing: .08em; text-transform: uppercase; }
.sn-links { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; }
.sn-link { display: flex; flex-direction: column; min-width: 0; padding: .75rem; border: 1px solid var(--lightgray); text-decoration: none; }
.sn-link--next { text-align: right; }
.sn-direction { color: var(--gray); font-family: var(--codeFont); font-size: .65rem; letter-spacing: .08em; text-transform: uppercase; }
.sn-link strong { overflow-wrap: anywhere; }
@media all and (max-width: 520px) {
  .sn-links { grid-template-columns: 1fr; }
  .sn-link--next { text-align: left; }
  .sn-links > span:empty { display: none; }
}
`
  return Component
}

export default SeriesNav
export { SeriesNav }
