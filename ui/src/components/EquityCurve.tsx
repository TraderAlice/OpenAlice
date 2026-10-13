import { useId, useState, useMemo, type Ref } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine,
} from 'recharts'
import type { EquityCurvePoint } from '../api'
import { getIntlLocale } from '../lib/intl'
import { MeasuredChartFrame } from './MeasuredChartFrame'
import { SegmentedControl } from './SegmentedControl'
import { ContextHelp } from './ContextHelp'
import { currencySymbol, fmt } from '../lib/format'
import { cn } from '../lib/utils'
import { Button } from './ui/button'

// ==================== Time ranges ====================

const RANGES = [
  { label: '1H', ms: 60 * 60 * 1000 },
  { label: '6H', ms: 6 * 60 * 60 * 1000 },
  { label: '24H', ms: 24 * 60 * 60 * 1000 },
  { label: '7D', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30D', ms: 30 * 24 * 60 * 60 * 1000 },
  { label: 'All', ms: 0 },
] as const

type RangeLabel = (typeof RANGES)[number]['label']

// ==================== Props ====================

interface EquityCurveProps {
  ref?: Ref<HTMLDivElement>
  points: EquityCurvePoint[]
  accounts: Array<{ id: string; label: string }>
  selectedAccountId: string | 'all'
  onAccountChange: (id: string | 'all') => void
  onPointClick?: (point: EquityCurvePoint) => void
  selectedTimestamp?: string | null
  historical?: boolean
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  currency?: string
  className?: string
}

// ==================== Component ====================

export function EquityCurve({
  ref, points, accounts, selectedAccountId, onAccountChange,
  onPointClick, selectedTimestamp,
  historical = false, loading = false, error, onRetry, currency = 'USD', className,
}: EquityCurveProps) {
  const [range, setRange] = useState<RangeLabel>('24H')
  const gradientId = useId()

  const filtered = useMemo(() => {
    const r = RANGES.find(r => r.label === range)
    if (!r || r.ms === 0) return points
    const cutoff = Date.now() - r.ms
    return points.filter(p => new Date(p.timestamp).getTime() >= cutoff)
  }, [points, range])

  // Convert to chart data
  const chartData = useMemo(() =>
    filtered.map(p => ({
      ...p,
      time: new Date(p.timestamp).getTime(),
      equityNum: Number(p.equity),
    })),
  [filtered])

  // Explicit Y domain + ticks. Recharts' default 'auto' domain rounds tick
  // values so coarsely that tight ranges render duplicate labels
  // ("$100.7K $100.7K $100.6K …") — compute our own 4 ticks with a
  // formatter precise enough to keep them distinct.
  const yAxis = useMemo(() => {
    const vals = chartData.map(d => d.equityNum).filter(v => Number.isFinite(v))
    if (vals.length === 0) return null
    let min = Math.min(...vals)
    let max = Math.max(...vals)
    if (min === max) { min -= 1; max += 1 }
    const pad = (max - min) * 0.08
    const lo = min - pad
    const hi = max + pad
    const ticks = [0, 1, 2, 3].map(i => lo + ((hi - lo) * i) / 3)
    return {
      domain: [lo, hi] as [number, number],
      ticks,
      formatter: makeCurrencyTickFormatter(max - min, (hi - lo) / 3, currency),
    }
  }, [chartData, currency])

  // Explicit X ticks aligned to round time boundaries (whole hours, local
  // midnights) instead of recharts' arbitrary data-point positions.
  const xTicks = useMemo(() => computeTimeTicks(chartData), [chartData])

  const isAllView = selectedAccountId === 'all'

  return (
    <div ref={ref} tabIndex={onPointClick ? -1 : undefined} aria-label="Equity curve" className={cn('oa-data-surface flex min-w-0 flex-col rounded-lg border border-border bg-card p-(--oa-panel-inset) outline-none', className)} aria-busy={loading}>
      {/* Header */}
      <div className="mb-3 flex min-h-(--oa-control-height) flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-semibold leading-5 text-foreground">
            Equity Curve
          </h3>
          <ContextHelp label={error ? 'Snapshot refresh failed' : historical ? 'Historical snapshot' : 'Equity Curve'} className={error ? 'text-destructive' : historical ? 'text-warning' : undefined}>
            {error ? `Unable to refresh snapshots: ${error}` : historical ? 'Historical snapshot. Broker support is unavailable on this Runtime. This chart shows recorded values.' : onPointClick ? 'Recorded account equity. Select a point to inspect its snapshot.' : 'Recorded account equity across all wallets.'}
          </ContextHelp>
          <span className="sr-only" role="alert">{error ?? ''}</span>
          <span className="sr-only" role="status">{historical ? 'Historical snapshot. Live broker data is unavailable.' : ''}</span>
        </div>
        <SegmentedControl
          value={range}
          options={RANGES.map((r) => ({ value: r.label, label: r.label }))}
          onChange={setRange}
          ariaLabel="Equity curve time range"
          compact
        />
      </div>

      {/* Account switcher */}
      {accounts.length > 1 && (
        <div className="mb-4 flex max-w-full flex-wrap items-center gap-2">
          <span className="shrink-0 text-sm font-medium leading-5 text-muted-foreground">Account</span>
          <SegmentedControl
            value={selectedAccountId}
            options={[
              ...accounts.map((account) => ({ value: account.id, label: account.label })),
              { value: 'all', label: 'All' },
            ]}
            onChange={onAccountChange}
            ariaLabel="Equity curve account"
            compact
          />
        </div>
      )}

      {/* Chart */}
      {loading || chartData.length === 0 ? (
        <div className="flex min-h-[240px] flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground" role="status">
          <span>{loading ? 'Loading snapshots…' : error ? 'Snapshots are unavailable.' : 'No snapshots in this range.'}</span>
          {!loading && error && onRetry && <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>}
        </div>
      ) : <MeasuredChartFrame className="min-h-[240px] w-full flex-1">
        {({ width, height }) => (
          <AreaChart
            accessibilityLayer
            width={width}
            height={height}
            data={chartData}
            onClick={(event) => {
              if (event.activeIndex == null) return
              const point = filtered[Number(event.activeIndex)]
              if (point) onPointClick?.(point)
            }}
          >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="time"
            type="number"
            domain={['dataMin', 'dataMax']}
            ticks={xTicks}
            tickFormatter={formatTime}
            tick={{ fontSize: 14, fill: 'var(--chart-axis)' }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
            minTickGap={32}
            height={36}
            tickMargin={8}
          />
          <YAxis
            tickFormatter={yAxis?.formatter ?? formatCurrency}
            tick={{ fontSize: 14, fill: 'var(--chart-axis)' }}
            axisLine={false}
            tickLine={false}
            width="auto"
            domain={yAxis?.domain ?? ['auto', 'auto']}
            ticks={yAxis?.ticks}
            tickMargin={8}
          />
          <Tooltip
            isAnimationActive={false}
            content={<CustomTooltip isAllView={isAllView} accounts={accounts} currency={currency} />}
          />
          <Area
            type="monotone"
            dataKey="equityNum"
            stroke="var(--chart-1)"
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            dot={chartData.length === 1 ? { r: 3, fill: 'var(--chart-1)' } : false}
            isAnimationActive={false}
            activeDot={{ r: 4, fill: 'var(--chart-1)', stroke: 'var(--secondary)', strokeWidth: 2 }}
          />
          {selectedTimestamp && (
            <ReferenceLine
              x={new Date(selectedTimestamp).getTime()}
              stroke="var(--chart-1)"
              strokeDasharray="3 3"
              strokeOpacity={0.6}
            />
          )}
          </AreaChart>
        )}
      </MeasuredChartFrame>}
    </div>
  )
}

// ==================== Custom Tooltip ====================

function CustomTooltip({ active, payload, isAllView, accounts, currency }: any) {
  if (!active || !payload?.[0]) return null
  const data = payload[0].payload as EquityCurvePoint & { time: number }
  const accountMap = new Map((accounts as Array<{ id: string; label: string }>).map(a => [a.id, a.label]))

  return (
    <div className="oa-chart-tooltip px-3 py-2 text-sm leading-5">
      <p className="text-muted-foreground mb-1">
        {new Date(data.time).toLocaleString()}
      </p>
      <p className="text-foreground font-semibold tabular-nums">
        {fmt(data.equity, currency)}
      </p>
      {isAllView && data.accounts && Object.keys(data.accounts).length > 1 && (
        <div className="mt-1.5 pt-1.5 border-t border-border space-y-0.5">
          {Object.entries(data.accounts).map(([id, val]) => (
            <div key={id} className="flex justify-between gap-4">
              <span className="text-muted-foreground">{accountMap.get(id) ?? id}</span>
              <span className="text-foreground tabular-nums">
                ${Number(val).toLocaleString(getIntlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ==================== Formatters ====================

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(getIntlLocale(), { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString(getIntlLocale(), { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(getIntlLocale(), { hour: '2-digit', minute: '2-digit' })
}

function formatCurrency(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`
  return `$${val.toFixed(0)}`
}

/**
 * Tick formatter with range-aware precision: tight ranges (< $2,000 across
 * the visible window) render full dollars with thousands separators
 * ("$100,680"); wider ranges keep the compact K/M form but with enough
 * decimals that adjacent ticks stay distinct ("$100.68K").
 */
function makeCurrencyTickFormatter(range: number, tickSpacing: number, currency: string): (val: number) => string {
  const prefix = currencySymbol(currency)
  return (val: number) => {
    if (range < 2000) {
      const decimals = range < 10 ? 2 : 0
      return `${prefix}${val.toLocaleString(getIntlLocale(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
    }
    if (Math.abs(val) < 1_000) return `${prefix}${val.toFixed(0)}`
    const unit = Math.abs(val) >= 1_000_000 ? 1_000_000 : 1_000
    const suffix = unit === 1_000_000 ? 'M' : 'K'
    // Enough fractional digits that one tick step is resolvable at this unit.
    const decimals = Math.min(4, Math.max(1, Math.ceil(-Math.log10(tickSpacing / unit))))
    return `${prefix}${(val / unit).toFixed(decimals)}${suffix}`
  }
}

// ==================== X-axis round ticks ====================

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Candidate tick steps, smallest first. */
const TICK_STEPS = [5 * MINUTE, 15 * MINUTE, HOUR, 3 * HOUR, 6 * HOUR, DAY] as const

/**
 * Pick the smallest step that yields ≤ 6 ticks across the visible range and
 * align tick values to round boundaries — epoch-aligned for sub-day steps
 * (whole hours / 5-minute marks), local midnight for day-sized steps. For
 * ranges beyond what 1-day steps can cover in 6 ticks, step by N days.
 */
function computeTimeTicks(data: Array<{ time: number }>): number[] | undefined {
  if (data.length < 2) return undefined
  const t0 = data[0].time
  const t1 = data[data.length - 1].time
  const span = t1 - t0
  if (span <= 0) return undefined

  const step = TICK_STEPS.find(s => span / s <= 6) ?? DAY
  const ticks: number[] = []
  if (step >= DAY) {
    const stride = Math.max(1, Math.ceil(span / (6 * DAY)))
    const d = new Date(t0)
    d.setHours(0, 0, 0, 0)
    if (d.getTime() < t0) d.setDate(d.getDate() + 1)
    for (; d.getTime() <= t1; d.setDate(d.getDate() + stride)) ticks.push(d.getTime())
  } else {
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) ticks.push(t)
  }
  return ticks.length >= 2 ? ticks : undefined
}
