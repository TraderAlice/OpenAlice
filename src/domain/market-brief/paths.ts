/**
 * Suggest write-once paths under the Workspace research/briefs tree.
 * Agents must use alice CLI `--output` (wx) or equivalent create-only writes.
 */

export type BriefArtifactKind =
  | 'facts'
  | 'facts.derived'
  | 'judgments'
  | 'analysis'
  | 'report'
  | 'report.draft'

function sanitizeSegment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'run'
}

/**
 * @param asofDate YYYY-MM-DD session label (not necessarily calendar today)
 * @param runId short id to avoid collisions within the same day (e.g. HHMM or slug)
 */
export function suggestBriefPath(opts: {
  asofDate: string
  runId: string
  kind: BriefArtifactKind
}): string {
  const date = sanitizeSegment(opts.asofDate)
  const run = sanitizeSegment(opts.runId)
  const file =
    opts.kind === 'report'
      ? 'report.md'
      : opts.kind === 'report.draft'
        ? 'report.draft.md'
        : opts.kind === 'facts.derived'
          ? 'facts.derived.json'
          : opts.kind === 'judgments'
            ? 'judgments.json'
            : opts.kind === 'analysis'
              ? 'analysis.json'
              : 'facts.json'
  return `research/briefs/${date}/${run}/${file}`
}

export function briefWriteOnceContract(): string {
  return [
    'Write-once contract:',
    '- Prefer `alice brief <verb> ... --output <path>` (CLI uses O_EXCL / wx).',
    '- Never overwrite an existing facts/judgments/analysis/report for the same run.',
    '- On collision, bump runId or create a new dated folder.',
    '- Derived metrics must come from `alice brief derive`, not hand-edited numbers.',
    '- Editorial polish must not mutate analysis.json; validate with editorial-check.',
  ].join('\n')
}
