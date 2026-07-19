import { useEffect, useState } from 'react'
import { formatRelativeTime } from '../lib/intl'

interface LiveIndicatorProps {
  /** Pass `null` to render the pulse without a timestamp (i.e. before the
   *  first successful fetch lands). */
  lastUpdated: Date | null
  /** Hide the breathing dot — only show "updated Xs ago" microcopy. */
  hideDot?: boolean
  className?: string
}

/**
 * "This surface is alive" badge — a small breathing green dot plus a
 * relative-time microcopy ("updated 14s ago") that re-renders every 5s
 * so the number stays honest even when the parent isn't re-rendering.
 *
 * Trading-app convention: the dot communicates "data is auto-refreshing"
 * without taking real estate. Drop it next to a PageHeader title or any
 * place a user might wonder "is this live?".
 */
export function LiveIndicator({ lastUpdated, hideDot, className }: LiveIndicatorProps) {
  // Tick once every 5s so "Xs ago" doesn't go stale visually.
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 5000)
    return () => clearInterval(id)
  }, [])

  const ago = lastUpdated ? formatRelativeTime(lastUpdated) : '—'

  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] text-muted-foreground ${className ?? ''}`}>
      {!hideDot && (
        <span className="relative inline-block w-1.5 h-1.5 rounded-full bg-success live-pulse" aria-hidden />
      )}
      <span className="tabular-nums">updated {ago}</span>
    </span>
  )
}
