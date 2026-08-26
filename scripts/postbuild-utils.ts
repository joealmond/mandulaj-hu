/**
 * Normalize headings inside <article> so the shallowest becomes <h2> beneath
 * the page title. Relative structure, attributes, ids, and outside chrome stay
 * unchanged.
 */
export function normaliseArticleHeadings(html: string): string {
  const start = html.indexOf("<article")
  if (start === -1) return html
  const end = html.indexOf("</article>", start)
  if (end === -1) return html

  const article = html.slice(start, end)
  const levels = [...article.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]))
  if (!levels.length) return html

  const shallowest = Math.min(...levels)
  if (shallowest === 2) return html
  const delta = 2 - shallowest
  const fixed = article.replace(
    /<(\/?)h([1-6])\b/g,
    (_match, close: string, level: string) =>
      `<${close}h${Math.min(6, Math.max(2, Number(level) + delta))}`,
  )
  return html.slice(0, start) + fixed + html.slice(end)
}
