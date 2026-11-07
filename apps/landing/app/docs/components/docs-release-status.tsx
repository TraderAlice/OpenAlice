import { Beaker, CheckCircle2, GitBranch } from "lucide-react"
import {
  STABLE_DOCS_VERSION,
  type DocsPageMetadata,
  resolveDocsRelease,
} from "@/lib/docs/release-channel"

export function DocsReleaseStatus({ metadata }: { metadata: DocsPageMetadata }) {
  const release = resolveDocsRelease(metadata)
  if (!release) return null
  const isDev = release.channel === "dev"

  return (
    <aside
      className={`docs-release-status${isDev ? " docs-release-status-dev" : ""}`}
      aria-label={`${isDev ? "Development" : "Stable"} documentation status`}
      data-docs-channel={release.channel}
    >
      <span className="docs-release-status-icon" aria-hidden="true">
        {isDev ? <Beaker /> : <CheckCircle2 />}
      </span>
      <div className="docs-release-status-copy">
        <p className="docs-release-status-title">
          {isDev ? "Dev channel" : release.isCurrent ? "Stable" : "Reviewed release"}
          <span>{release.version}</span>
        </p>
        <p>
          {isDev
            ? release.hasTargetVersion
              ? `This page includes unreleased behavior planned for ${release.version}. Stable ${STABLE_DOCS_VERSION} may not have these controls yet.`
              : `This page includes unreleased behavior from the dev branch after ${STABLE_DOCS_VERSION}. Stable installations may not have these controls yet.`
            : release.isCurrent
              ? `This guide was checked against the OpenAlice ${release.version} release source. Some features remain beta; follow the page's own cautions.`
              : `This guide was checked against OpenAlice ${release.version}. The current stable release is ${STABLE_DOCS_VERSION}; steps may have changed.`}
        </p>
      </div>
      <a
        href={isDev
          ? "https://github.com/TraderAlice/OpenAlice/tree/dev"
          : `https://github.com/TraderAlice/OpenAlice/tree/v${release.version}`}
        target="_blank"
        rel="noopener noreferrer"
        data-evt="docs_release_channel_link"
        data-target={release.channel}
        data-location="docs_article"
      >
        <GitBranch aria-hidden="true" />
        {isDev ? "View dev" : "View tag"}
      </a>
    </aside>
  )
}
