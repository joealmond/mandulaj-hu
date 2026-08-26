import fs from "node:fs/promises"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"

/**
 * Stable, vault-relative attachment name.
 *
 * Every attachment gets a path hash, rather than only the second duplicate.
 * That makes the result independent of filesystem traversal order and makes
 * identical basenames unable to overwrite each other.
 */
export function attachmentName(absPath: string, vaultRoot: string): string {
  const rel = path.relative(vaultRoot, absPath).split(path.sep).join("/")
  const base = path.basename(absPath)
  const ext = path.extname(base)
  const stem = base.slice(0, base.length - ext.length)
  const digest = createHash("sha256").update(rel).digest("hex").slice(0, 16)
  return `${stem}-${digest}${ext}`
}

/** Claim a generated destination without ever replacing another source. */
export function claimAttachment(
  destinationToSource: Map<string, string>,
  destination: string,
  source: string,
): boolean {
  const existing = destinationToSource.get(destination)
  if (existing && existing !== source) return false
  destinationToSource.set(destination, source)
  return true
}

/** Copy only explicitly public source properties; unknown keys fail closed. */
export function publicFrontmatter(
  source: Record<string, unknown>,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const key of allowedKeys) {
    if (Object.hasOwn(source, key) && source[key] !== undefined) output[key] = source[key]
  }
  return output
}

/** Keep generated metadata byte-stable when its public payload did not change. */
export function stableGeneratedAt(
  previous: unknown,
  next: Record<string, unknown>,
  now: string,
): string {
  if (!previous || typeof previous !== "object" || Array.isArray(previous)) return now
  const { generatedAt, ...previousPayload } = previous as Record<string, unknown>
  return typeof generatedAt === "string" && JSON.stringify(previousPayload) === JSON.stringify(next)
    ? generatedAt
    : now
}

export interface StagedArtifact {
  staged: string
  live: string
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

/**
 * Promote a set of staged files/directories as one rollback-safe operation.
 *
 * Filesystems do not provide a multi-path atomic rename, so live artifacts are
 * first moved to unique backups. If any promotion fails, every already-moved
 * artifact is removed and all backups are restored before the error escapes.
 */
export async function replaceArtifacts(artifacts: StagedArtifact[]): Promise<void> {
  const suffix = `.sync-backup-${process.pid}-${randomUUID()}`
  const states = artifacts.map((artifact) => ({
    ...artifact,
    backup: `${artifact.live}${suffix}`,
    hadLive: false,
    promoted: false,
  }))

  try {
    for (const state of states) {
      state.hadLive = await exists(state.live)
      if (state.hadLive) await fs.rename(state.live, state.backup)
    }
    for (const state of states) {
      await fs.rename(state.staged, state.live)
      state.promoted = true
    }
  } catch (promotionError) {
    const rollbackErrors: unknown[] = []
    for (const state of states.toReversed()) {
      try {
        if (state.promoted) await fs.rm(state.live, { recursive: true, force: true })
        if (state.hadLive && (await exists(state.backup))) {
          await fs.rename(state.backup, state.live)
        }
      } catch (error) {
        rollbackErrors.push(error)
      }
    }
    if (rollbackErrors.length) {
      throw new AggregateError(
        [promotionError, ...rollbackErrors],
        "Sync promotion failed and rollback was incomplete",
      )
    }
    throw promotionError
  }

  await Promise.all(states.map((state) => fs.rm(state.backup, { recursive: true, force: true })))
}
