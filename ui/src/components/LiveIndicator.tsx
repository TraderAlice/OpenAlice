import { useEffect, useState } from 'react'
import { Clock3 } from 'lucide-react'
import { formatRelativeTime } from '../lib/intl'

interface LiveIndicatorProps {
  lastUpdated: Date | null
  hideIcon?: boolean
  label?: string
  className?: string
}

export function LiveIndicator({ lastUpdated, hideIcon, className, label = 'updated' }: LiveIndicatorProps) {
  const [, refreshTimestamp] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => refreshTimestamp(value => value + 1), 5000)
    return () => clearInterval(timer)
  }, [])

  const ago = lastUpdated ? formatRelativeTime(lastUpdated) : '—'

  return (
    <span className={`inline-flex items-center gap-2 text-sm leading-5 text-muted-foreground ${className ?? ''}`}>
      {!hideIcon && <Clock3 className="size-4 shrink-0" aria-hidden />}
      <span className="tabular-nums">{label} {ago}</span>
    </span>
  )
}
