import { useState, useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine,
} from 'recharts'
import type { EquityCurvePoint } from '../api'
import { getIntlLocale } from '../lib/intl'
import { MeasuredChartFrame } from './MeasuredChartFrame'
import { SegmentedControl } from './SegmentedControl'

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
  points: EquityCurvePoint[]
  accounts: Array<{ id: string; label: string }>
  selectedAccountId: string | 'all'
  onAccountChange: (id: string | 'all') => void
  onPointClick?: (point: EquityCurvePoint) => void
  selectedTimestamp?: string | null
}

// ==================== Component ====================

export function EquityCurve({
  points, accounts, selectedAccountId, onAccountChange,
  onPointClick, selectedTimestamp,
}: EquityCurveProps) {
  const [range, setRange] = useState<RangeLabel>('24H')

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
      formatter: makeCurrencyTickFormatter(max - min, (hi - lo) / 3),
    }
  }, [chartData])

  // Explicit X ticks aligned to round time boundaries (whole hours, local
  // midnights) instead of recharts' arbitrary data-point positions.
  const xTicks = useMemo(() => computeTimeTicks(chartData), [chartData])

  if (chartData.length === 0) return null

  const isAllView = selectedAccountId === 'all'

  return (
    <div className="border border-border rounded-lg bg-bg-secondary p-4">
      {/* Header */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-[13px] font-semibold text-text-muted uppercase tracking-wide">
          Equity Curve
        </h3>
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
        <div className="mb-3 flex max-w-full items-center gap-2">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Account</span>
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
      <MeasuredChartFrame className="h-[220px] w-full">
        {({ width, height }) => (
          <AreaChart
            width={width}
            height={height}
            data={chartData}
            onClick={(state) => {
              if (!onPointClick || state?.activeTooltipIndex == null) return
              const point = chartData[Number(state.activeTooltipIndex)]
              if (point) onPointClick(point)
            }}
          >
          <defs>
            <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="time"
            type="number"
            domain={['dataMin', 'dataMax']}
            ticks={xTicks}
            tickFormatter={formatTime}
            tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
            axisLine={{ stroke: 'var(--color-border)' }}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            tickFormatter={yAxis?.formatter ?? formatCurrency}
            tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
            axisLine={false}
            tickLine={false}
            width={70}
            domain={yAxis?.domain ?? ['auto', 'auto']}
            ticks={yAxis?.ticks}
          />
          <Tooltip content={<CustomTooltip isAllView={isAllView} accounts={accounts} />} />
          <Area
            type="monotone"
            dataKey="equityNum"
            stroke="var(--color-accent)"
            strokeWidth={1.5}
            fill="url(#equityGradient)"
            dot={false}
            activeDot={{ r: 4, fill: 'var(--color-accent)', stroke: 'var(--color-bg-secondary)', strokeWidth: 2 }}
          />
          {selectedTimestamp && (
            <ReferenceLine
              x={new Date(selectedTimestamp).getTime()}
              stroke="var(--color-accent)"
              strokeDasharray="3 3"
              strokeOpacity={0.6}
            />
          )}
          </AreaChart>
        )}
      </MeasuredChartFrame>
    </div>
  )
}

// ==================== Custom Tooltip ====================

function CustomTooltip({ active, payload, isAllView, accounts }: any) {
  if (!active || !payload?.[0]) return null
  const data = payload[0].payload as EquityCurvePoint & { time: number }
  const accountMap = new Map((accounts as Array<{ id: string; label: string }>).map(a => [a.id, a.label]))

  return (
    <div className="bg-bg-secondary border border-border rounded-md px-3 py-2 shadow-lg text-[12px]">
      <p className="text-text-muted mb-1">
        {new Date(data.time).toLocaleString()}
      </p>
      <p className="text-text font-semibold tabular-nums">
        ${Number(data.equity).toLocaleString(getIntlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>
      {isAllView && data.accounts && Object.keys(data.accounts).length > 1 && (
        <div className="mt-1.5 pt-1.5 border-t border-border space-y-0.5">
          {Object.entries(data.accounts).map(([id, val]) => (
            <div key={id} className="flex justify-between gap-4">
              <span className="text-text-muted">{accountMap.get(id) ?? id}</span>
              <span className="text-text tabular-nums">
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
function makeCurrencyTickFormatter(range: number, tickSpacing: number): (val: number) => string {
  return (val: number) => {
    if (range < 2000) {
      const decimals = range < 10 ? 2 : 0
      return `$${val.toLocaleString(getIntlLocale(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
    }
    if (Math.abs(val) < 1_000) return `$${val.toFixed(0)}`
    const unit = Math.abs(val) >= 1_000_000 ? 1_000_000 : 1_000
    const suffix = unit === 1_000_000 ? 'M' : 'K'
    // Enough fractional digits that one tick step is resolvable at this unit.
    const decimals = Math.min(4, Math.max(1, Math.ceil(-Math.log10(tickSpacing / unit))))
    return `$${(val / unit).toFixed(decimals)}${suffix}`
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
