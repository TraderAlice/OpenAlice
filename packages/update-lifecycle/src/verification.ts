import { isVersion } from './index.js'

/** Evidence of an installed or active release, not an installer URL/selector.
 * Commit and payload evidence is required when it was part of the approved target.
 * Platform-specific artifacts must be compared only within the same target unit. */
export interface ReleaseEvidence {
  readonly version: string
  readonly commit?: string
  readonly artifactSha256?: string
  readonly contentIdentity?: string
}
export interface ReleaseVerification {
  readonly status: 'matched' | 'mismatched' | 'unknown'
  readonly fields: readonly (keyof ReleaseEvidence)[]
}

/** Exact activation check. SemVer ordering is deliberately irrelevant: launching
 * a newer but unapproved release is not successful execution of this plan.
 * Build metadata is identity here, even though it is ignored for precedence. */
export function verifyReleaseEvidence(expected: ReleaseEvidence, observed: ReleaseEvidence | null): ReleaseVerification {
  if (!observed) return { status: 'unknown', fields: ['version'] }
  const missing: (keyof ReleaseEvidence)[] = []
  const different: (keyof ReleaseEvidence)[] = []
  if (!isVersion(expected.version) || !isVersion(observed.version)) missing.push('version')
  else if (expected.version.replace(/^v/, '') !== observed.version.replace(/^v/, '')) different.push('version')
  for (const field of ['commit', 'artifactSha256', 'contentIdentity'] as const) {
    const target = expected[field]
    if (target === undefined) continue
    // Abbreviated commits cannot prove exact identity; adapters must resolve the
    // full target before approval. Hash casing has no semantic significance.
    const valid = field === 'commit' ? /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i
      : field === 'contentIdentity' ? /^[a-f0-9]{16}$/i : /^[a-f0-9]{64}$/i
    if (!valid.test(target) || !observed[field] || !valid.test(observed[field]!)) missing.push(field)
    else if (target.toLowerCase() !== observed[field]!.toLowerCase()) different.push(field)
  }
  return different.length ? { status: 'mismatched', fields: different }
    : missing.length ? { status: 'unknown', fields: missing }
      : { status: 'matched', fields: [] }
}
