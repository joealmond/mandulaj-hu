/**
 * TypeScript overrides for anything quartz.config.yaml cannot express.
 *
 * YAML is static; these values are resolved at build time from the
 * environment. Everything here degrades to "feature off" when unset, so a
 * clean checkout with no .env still builds.
 *
 * See CLAUDE.md for why this file exists and what belongs in it.
 */
import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"

/** Umami: privacy-friendly and cookieless, pointed at a self-hosted instance. */
function analytics() {
  const host = process.env.UMAMI_HOST?.trim()
  const websiteId = process.env.UMAMI_WEBSITE_ID?.trim()

  // Both halves or nothing. A half-configured provider emits a script tag
  // pointing nowhere, which costs a failed request on every page load.
  if (!host || !websiteId) {
    if (host || websiteId) {
      console.warn(
        "[analytics] UMAMI_HOST and UMAMI_WEBSITE_ID must BOTH be set. Analytics disabled.",
      )
    }
    return null
  }

  return { provider: "umami" as const, host, websiteId }
}

const config = await loadQuartzConfig({
  analytics: analytics(),
})

export default config
export const layout = await loadQuartzLayout()
