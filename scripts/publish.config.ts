import os from "node:os"
import path from "node:path"

/**
 * Publishing policy for mandulaj.hu.
 *
 * This file is the single source of truth for "what is allowed to become
 * public". Both `sync` and `audit` read it. Changing it changes what can
 * leave the vault, so treat edits here with the same care as a secret.
 */

export interface PublishConfig {
  /** Absolute path to the Obsidian vault. Override with VAULT_PATH. */
  vaultPath: string

  /**
   * Optional source properties allowed to cross the private/public boundary.
   *
   * Structural properties (`publish`, `title`, `slug`, tags, category, accent)
   * are normalized by sync itself and do not belong here. Everything not in
   * this list is dropped, even when the note is deliberately published.
   */
  publicFrontmatter: string[]

  /** Where synced notes land. Fully regenerated on every sync. */
  contentDir: string

  /** Subfolder of contentDir for traced attachments. */
  attachmentsSubdir: string

  /**
   * Repo-owned pages copied into content/ on every sync.
   *
   * These are site furniture, not notes: the home page, the projects index,
   * a colophon. They live in git rather than the vault because they are part
   * of the site's structure. They still require `publish: true`, so the audit
   * treats them exactly like any other page.
   */
  pagesDir: string

  /**
   * Wikilinks pointing at notes that are NOT published become dead links on
   * the public site. When true they are flattened to plain text.
   *
   * Caveat worth knowing: this removes the LINK, not the TEXT. `[[NestJS]]`
   * becomes the word "NestJS", which was already visible prose in your note.
   * `npm run sync` prints every flattened title so you can spot the case
   * where a private note's title is itself the sensitive part.
   */
  stripUnpublishedLinks: boolean

  /**
   * Link targets whose TEXT is removed entirely rather than flattened.
   *
   * `stripUnpublishedLinks` removes the link but keeps the words, because those
   * words were visible prose in your note. That is right for `[[NestJS]]`, and
   * wrong for `[[Journal/2025-03-04]]` — there the text is a private path, and
   * leaving it publishes the fact that a journal entry exists for that date.
   *
   * Each entry is matched against the raw link target as a prefix, case
   * insensitively. Empty by default: removing text changes your prose, so it is
   * opt-in. `npm run privacy` shows what is currently visible.
   */
  redactLinkPrefixes: string[]
}

export const config: PublishConfig = {
  vaultPath: process.env.VAULT_PATH ?? path.join(os.homedir(), "Documents", "Base"),
  // Toggle-only policy: any note can be published, but only these optional
  // properties may accompany its body into the public artifact.
  publicFrontmatter: ["description", "type", "year", "stack", "link"],
  contentDir: "content",
  attachmentsSubdir: "attachments",
  pagesDir: "quartz-custom/pages",
  stripUnpublishedLinks: true,
  // e.g. ["Journal/", "Daily/"] — see `npm run privacy`
  redactLinkPrefixes: [],
}

export default config
