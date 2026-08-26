import type {
  QuartzComponent,
  QuartzComponentConstructor,
  QuartzComponentProps,
} from "@quartz-community/types"
import mentions from "../../../data/webmentions.json" with { type: "json" }

/**
 * Displays webmentions received via webmention.io.
 *
 * The data is fetched at build time by scripts/webmentions.ts, never at
 * runtime — readers make no third-party request, and a webmention.io outage
 * cannot affect a page that is already deployed.
 *
 * Renders nothing at all when there are no mentions for the page, so an
 * unconfigured or unreachable endpoint leaves no empty heading behind.
 */
interface Mention {
  type: "like" | "repost" | "reply" | "mention"
  target: string
  url: string
  published: string | null
  author: { name: string; photo: string | null; url: string | null }
  content: string | null
}

const ALL = mentions as Mention[]

const Webmentions: QuartzComponentConstructor = () => {
  const Component: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
    const slug = fileData?.slug ?? ""

    // webmention.io stores absolute targets; match on the path so the site
    // works the same on a preview URL as on the custom domain.
    const forThisPage = ALL.filter((m) => {
      try {
        const p = new URL(m.target).pathname.replace(/^\/|\/$/g, "")
        return p === slug || p === `${slug}.html`
      } catch {
        return false
      }
    })

    if (forThisPage.length === 0) return null

    const reactions = forThisPage.filter((m) => m.type === "like" || m.type === "repost")
    const replies = forThisPage.filter((m) => m.type === "reply" || m.type === "mention")

    return (
      <section class="wm">
        <h2 class="wm-title">Mentions</h2>

        {reactions.length > 0 && (
          <ul class="wm-faces">
            {reactions.map((m) => (
              <li key={m.url}>
                <a href={m.url} rel="nofollow ugc" title={`${m.author.name} — ${m.type}`}>
                  {m.author.photo ? (
                    <img src={m.author.photo} alt="" width="32" height="32" loading="lazy" />
                  ) : (
                    <span class="wm-initial">{m.author.name.slice(0, 1)}</span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        )}

        {replies.length > 0 && (
          <ul class="wm-replies">
            {replies.map((m) => (
              <li key={m.url}>
                <a class="wm-who" href={m.author.url ?? m.url} rel="nofollow ugc">
                  {m.author.name}
                </a>
                {m.content && <p class="wm-body">{m.content}</p>}
                <a class="wm-src" href={m.url} rel="nofollow ugc">
                  {m.published ? new Date(m.published).toISOString().slice(0, 10) : "source"}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  Component.css = `
.wm { margin-top: 3rem; max-width: var(--measure, 34rem); }
.wm-title {
  font-family: var(--codeFont); font-size: .72rem; letter-spacing: .1em;
  text-transform: uppercase; color: var(--accent); font-weight: 400;
  display: flex; align-items: center; gap: .75rem; border: 0; padding: 0; margin: 0 0 1rem;
}
.wm-title::after { content: ""; flex: 1; height: 2px; background: var(--accent); }
.wm-faces { list-style: none; display: flex; flex-wrap: wrap; gap: .4rem; padding: 0; margin: 0 0 1.5rem; }
.wm-faces img, .wm-initial {
  width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--lightgray); background: var(--light);
  font-family: var(--headerFont); font-size: .8rem; color: var(--gray);
}
.wm-replies { list-style: none; padding: 0; margin: 0; }
.wm-replies > li { border-top: 1px solid var(--lightgray); padding: .9rem 0; }
.wm-who { font-family: var(--headerFont); font-weight: 700; font-size: .9rem; text-decoration: none; }
.wm-body { margin: .3rem 0 .35rem; font-size: .9rem; line-height: 1.55; }
.wm-src { font-family: var(--codeFont); font-size: .7rem; color: var(--gray); text-decoration: none; }
.wm-src:hover { color: var(--accent); }
`
  return Component
}

export default Webmentions
export { Webmentions }
