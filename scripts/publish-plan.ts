import path from "node:path"

/** The only generated files a desktop publish is allowed to stage or commit. */
export const PUBLISH_PATHS = [
  "content",
  ".publish-manifest.json",
  "quartz-custom/theme/_accents.generated.scss",
  "quartz-custom/data/webmentions.json",
] as const

export interface PublishPlan {
  added: string[]
  changed: string[]
  removed: string[]
  generated: string[]
}

/** Parse Git porcelain output without exposing private vault paths. */
export function parsePublishPlan(status: string): PublishPlan {
  const plan: PublishPlan = { added: [], changed: [], removed: [], generated: [] }
  for (const line of status.split("\n")) {
    if (!line) continue
    const code = line.slice(0, 2)
    const file = line.slice(3)
    if (file.startsWith("content/") && file.endsWith(".md")) {
      const slug = path.basename(file, ".md")
      if (code.includes("D")) plan.removed.push(slug)
      else if (code === "??" || code.includes("A")) plan.added.push(slug)
      else plan.changed.push(slug)
    } else {
      plan.generated.push(file)
    }
  }
  for (const values of [plan.added, plan.changed, plan.removed, plan.generated]) {
    values.sort((a, b) => a.localeCompare(b))
  }
  return plan
}

export function hasPublishChanges(plan: PublishPlan): boolean {
  return Object.values(plan).some((entries) => entries.length > 0)
}

export function publishSummary(plan: PublishPlan): string {
  const notes = [...plan.added, ...plan.changed, ...plan.removed]
  if (notes.length === 0) return "publish: update generated site data"
  if (notes.length <= 3) return `publish: ${notes.join(", ")}`
  return `publish: ${notes.length} notes`
}
