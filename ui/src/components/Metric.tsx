import type { ReactNode } from 'react'

export type MetricSize = 'sm' | 'md' | 'lg'
export type MetricSign = 'up' | 'down' | 'flat'

export interface MetricDelta {
  /** Pre-formatted display string, e.g. "+$201.40 (+0.84%)". */
  value: string
  sign: MetricSign
}

interface MetricProps {
  label: string
  value: ReactNode
  delta?: MetricDelta
  /** Color the value itself by sign — for PnL metrics. Falls back to neutral text. */
  valueSign?: MetricSign
  size?: MetricSize
  className?: string
}

/**
 * Label + big-number + optional delta block. Replaces the per-page inline
 * `Metric` components in UTADetailPage / SnapshotDetail / etc. Sign-driven
 * color logic (green up, red down, neutral flat) lives in one place so
 * the visual contract is consistent.
 *
 * Sizes:
 *   sm — secondary metrics row (Cash, Buying Power, etc.). 16px value.
 *   md — card-level metric (UTA card NLV). 22px value.
 *   lg — page hero (UTA detail page NLV). 28→36px responsive.
 */
export function Metric({ label, value, delta, valueSign, size = 'md', className }: MetricProps) {
  const valueClass = (() => {
    const color = signColor(valueSign)
    switch (size) {
      case 'sm': return `text-[16px] font-semibold tabular-nums ${color}`
      case 'lg': return `text-[28px] md:text-[36px] font-bold tabular-nums leading-tight ${color}`
      case 'md':
      default:   return `text-[22px] font-bold tabular-nums ${color}`
    }
  })()

  return (
    <div className={className}>
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={valueClass}>{value}</p>
      {delta && (
        <p className={`text-[12px] tabular-nums mt-0.5 ${signColor(delta.sign)}`}>
          {arrowFor(delta.sign)} {delta.value}
        </p>
      )}
    </div>
  )
}

function signColor(sign?: MetricSign): string {
  if (sign === 'up') return 'text-success'
  if (sign === 'down') return 'text-destructive'
  return 'text-foreground'
}

function arrowFor(sign: MetricSign): string {
  if (sign === 'up') return '▲'
  if (sign === 'down') return '▼'
  return '·'
}

/** Pick a sign from a numeric delta. `flat` for `0` (or NaN). */
export function signFromDelta(n: number | null | undefined): MetricSign {
  if (n == null || !Number.isFinite(n) || n === 0) return 'flat'
  return n > 0 ? 'up' : 'down'
}
