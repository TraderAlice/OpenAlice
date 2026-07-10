import type { ReferenceMeta } from '../../api/reference'

/**
 * The one meta line for board headers — single source word, not a badge
 * parade. Grammar:
 *
 *   hub-served  → "· hub"      (upstream provider lives in the tooltip)
 *   local build → "· <provider>"
 *   stale       → amber STALE chip — the only chip, because it's the only
 *                 state that should interrupt reading.
 *
 * Full provenance (provider · origin · asOf) is always on hover.
 */
export function BoardMeta({ meta, extra }: { meta: ReferenceMeta; extra?: string }) {
  const sourceWord = meta.origin === 'hub' ? 'hub' : meta.provider
  const detail = [
    `upstream: ${meta.provider}`,
    meta.origin ? `served by: ${meta.origin}` : null,
    meta.asOf ? `asOf: ${meta.asOf}` : null,
    meta.cachedAt ? `cached: ${meta.cachedAt}` : null,
  ].filter(Boolean).join(' · ')
  return (
    <span className="text-text-muted" title={detail}>
      {extra && <> · {extra}</>}
      {' · '}{sourceWord}
      {meta.stale && (
        <span className="ml-1.5 rounded bg-amber-500/15 px-1 py-px text-[9px] uppercase tracking-wide text-amber-700 dark:text-amber-300">stale</span>
      )}
    </span>
  )
}
