import { useEffect, useState } from 'react'
import type { BarMeta } from '../../api/market'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { formatRelativeTime } from '../../lib/intl'

/** Deliberately describes record age, never guesses an exchange's trading calendar. */
export function BarFreshness({ meta }: { meta: BarMeta }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => tick(n => n + 1), 30_000)
    return () => clearInterval(timer)
  }, [])
  const freshness = meta.freshness
  const latest = freshness?.latestRecordAt ?? meta.to
  if (!latest) return null
  const instant = freshness?.timestampKind === 'instant'
  const age = instant && freshness.recordAgeSeconds !== null && !freshness.historical
    ? formatRelativeTime(new Date(latest)) : null
  const explanation = [
    'Time since the latest bar timestamp is not measured feed delay. Bar intervals, market closures and publication schedules affect this gap.',
    freshness?.fetchedAt ? `Fetched: ${freshness.fetchedAt}` : null,
    freshness?.delay?.explanation ?? (meta.barCapability === 'delayed' ? 'OpenAlice classifies this source as potentially delayed; actual delay is unknown.' : null),
    freshness?.timestampKind === 'date' ? 'Daily record: intraday delay cannot be inferred.' : null,
  ].filter(Boolean).join(' ')
  return <Tooltip>
    <TooltipTrigger render={<span tabIndex={0} className="block w-fit max-w-full text-[11px] leading-5 text-muted-foreground tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring" />}>
      {freshness?.historical ? 'Historical · ' : ''}Latest record: {instant ? new Date(latest).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : latest}
      {age && ` · ${age}`}
    </TooltipTrigger>
    <TooltipContent className="max-w-sm">{explanation}</TooltipContent>
  </Tooltip>
}
