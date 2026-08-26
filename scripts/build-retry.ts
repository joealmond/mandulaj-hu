/** Errors worth retrying; deterministic build/configuration failures are not. */
export function isTransientBuildFailure(output: string): boolean {
  return /fonts\.(googleapis|gstatic)\.com|fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|network socket disconnected/i.test(
    output,
  )
}
