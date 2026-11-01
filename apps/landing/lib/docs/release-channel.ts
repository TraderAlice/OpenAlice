export const STABLE_DOCS_VERSION = "0.94.1"
export const DEV_DOCS_VERSION_LABEL = "Unreleased"

export type DocsReleaseChannel = "stable" | "dev"

export interface DocsPageMetadata {
  title: string
  description: string
  releaseChannel?: DocsReleaseChannel
  targetVersion?: string
}

export function resolveDocsRelease(metadata: DocsPageMetadata) {
  if (!metadata.releaseChannel) return null

  if (metadata.releaseChannel === "dev") {
    return {
      channel: "dev" as const,
      version: metadata.targetVersion ?? DEV_DOCS_VERSION_LABEL,
      hasTargetVersion: Boolean(metadata.targetVersion),
      isCurrent: false,
    }
  }

  // A stable review is pinned to the source version actually checked. A later
  // manifest/version bump must not silently relabel an old page.
  if (!metadata.targetVersion) return null
  return {
    channel: "stable" as const,
    version: metadata.targetVersion,
    hasTargetVersion: true,
    isCurrent: metadata.targetVersion === STABLE_DOCS_VERSION,
  }
}
