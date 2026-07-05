/**
 * L1 update check — compare the running app version against the latest
 * GitHub Release and report when a newer one exists.
 *
 * Deliberately the *lightest* rung of the update ladder: no auto-download,
 * no updater infrastructure, no code signing. (Full auto-update would need
 * Squirrel.Mac, which hard-rejects unsigned updates — blocked until we have
 * a Developer ID cert.) The caller shows a one-shot "Download" dialog that
 * links to the release page; the user installs the new build manually.
 *
 * Best-effort by design: offline, rate-limited, or malformed responses
 * resolve to null and never surface an error — a failed update check must
 * never disrupt launch.
 *
 * Beta-aware: we query the releases *list*, not `/releases/latest` — that
 * endpoint excludes prereleases, and OpenAlice ships `-beta.N` builds with
 * no formal (non-prerelease) release on the near horizon. Skipping
 * prereleases would make the whole check dead weight during the beta period.
 * We take the highest-versioned non-draft release, prereleases included.
 */

const RELEASES_API = 'https://api.github.com/repos/TraderAlice/OpenAlice/releases?per_page=30'
const CHECK_TIMEOUT_MS = 5_000

interface GithubRelease {
  tag_name?: string
  html_url?: string
  draft?: boolean
}

export interface UpdateInfo {
  /** Latest release version, leading "v" stripped (e.g. "0.42.0"). */
  version: string
  /** The release page to open in the user's browser. */
  url: string
}

export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS)
  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'OpenAlice-desktop' },
      signal: ctrl.signal,
    })
    if (!res.ok) return null
    const body = (await res.json()) as unknown
    if (!Array.isArray(body)) return null
    // Highest-versioned non-draft release (prereleases included).
    let best: UpdateInfo | null = null
    for (const rel of body as GithubRelease[]) {
      if (rel.draft || !rel.tag_name || !rel.html_url) continue
      const version = rel.tag_name.replace(/^v/, '')
      if (!best || compareVersions(version, best.version) > 0) {
        best = { version, url: rel.html_url }
      }
    }
    if (!best || compareVersions(best.version, currentVersion) <= 0) return null
    return best
  } catch {
    // offline / rate-limited / aborted / malformed — update check is optional
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Semver-ish compare. Returns >0 if `a` is newer than `b`, <0 if older,
 * 0 if equal. A release outranks a prerelease at the same core version
 * (1.0.0 > 1.0.0-rc.1); prereleases compare lexicographically. Dependency-
 * free — the desktop package stays lean.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] - pb.core[i]
  }
  if (!pa.pre && pb.pre) return 1
  if (pa.pre && !pb.pre) return -1
  if (pa.pre && pb.pre) return pa.pre < pb.pre ? -1 : pa.pre > pb.pre ? 1 : 0
  return 0
}

function parseVersion(v: string): { core: [number, number, number]; pre: string } {
  const [core, ...preParts] = v.split('-')
  const nums = core.split('.').map((n) => Number.parseInt(n, 10) || 0)
  return { core: [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0], pre: preParts.join('-') }
}
