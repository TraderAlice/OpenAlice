import { useMemo, useState } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts'
import type { ChartSeries } from '../../api/lean'
import { SegmentedControl } from '../SegmentedControl'

interface LeanEquityCurveProps {
  equitySeries?: ChartSeries
  benchmarkSeries?: ChartSeries
  initialCash?: number
}

const RANGES = ['ALL', '1Y', '6M', '3M', '1M'] as const
type Range = (typeof RANGES)[number]

export function LeanEquityCurve({
  equitySeries,
  benchmarkSeries,
  initialCash = 100000
}: LeanEquityCurveProps) {
  const [range, setRange] = useState<Range>('ALL')

  const chartData = useMemo(() => {
    if (!equitySeries || !equitySeries.values || equitySeries.values.length === 0) {
      return []
    }

    const eqMap = new Map<number, number>()
    for (const pt of equitySeries.values) {
      eqMap.set(pt.x, pt.y)
    }

    const bmMap = new Map<number, number>()
    if (benchmarkSeries?.values) {
      for (const pt of benchmarkSeries.values) {
        bmMap.set(pt.x, pt.y)
      }
    }

    let peak = initialCash
    const rawData = equitySeries.values.map((pt) => {
      const equity = pt.y
      if (equity > peak) peak = equity
      const drawdown = peak > 0 ? ((equity - peak) / peak) * 100 : 0
      const benchmark = bmMap.get(pt.x)

      return {
        timestamp: pt.x * 1000,
        date: new Date(pt.x * 1000).toLocaleDateString(),
        equity,
        drawdown: Number(drawdown.toFixed(2)),
        benchmark
      }
    })

    if (range === 'ALL' || rawData.length === 0) return rawData

    const lastTime = rawData[rawData.length - 1].timestamp
    let cutoff = lastTime
    if (range === '1Y') cutoff = lastTime - 365 * 24 * 3600 * 1000
    if (range === '6M') cutoff = lastTime - 180 * 24 * 3600 * 1000
    if (range === '3M') cutoff = lastTime - 90 * 24 * 3600 * 1000
    if (range === '1M') cutoff = lastTime - 30 * 24 * 3600 * 1000

    return rawData.filter((d) => d.timestamp >= cutoff)
  }, [equitySeries, benchmarkSeries, initialCash, range])

  if (chartData.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-card p-6 text-muted-foreground text-sm">
        No equity curve series available
      </div>
    )
  }

  const latest = chartData[chartData.length - 1]
  const first = chartData[0]
  const netProfit = latest.equity - initialCash
  const returnPct = ((latest.equity - initialCash) / initialCash) * 100
  const isPositive = netProfit >= 0

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Portfolio Equity Curve
          </div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold font-mono tracking-tight">
              ${latest.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span
              className={`text-sm font-semibold font-mono ${
                isPositive ? 'text-success' : 'text-destructive'
              }`}
            >
              {isPositive ? '+' : ''}
              ${netProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (
              {isPositive ? '+' : ''}
              {returnPct.toFixed(2)}%)
            </span>
          </div>
        </div>

        <SegmentedControl
          value={range}
          options={RANGES.map((r) => ({ value: r, label: r }))}
          onChange={(val) => setRange(val as Range)}
          ariaLabel="Equity curve timeframe"
          compact
        />
      </div>

      {/* Main Equity Chart */}
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={isPositive ? 'var(--chart-2)' : 'var(--destructive)'} stopOpacity={0.3} />
                <stop offset="95%" stopColor={isPositive ? 'var(--chart-2)' : 'var(--destructive)'} stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              stroke="var(--muted-foreground)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              minTickGap={40}
            />
            <YAxis
              stroke="var(--muted-foreground)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              domain={['auto', 'auto']}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload
                  return (
                    <div className="rounded-lg border border-border bg-popover p-2.5 shadow-md text-xs">
                      <div className="font-semibold text-foreground mb-1">{data.date}</div>
                      <div className="flex items-center justify-between gap-4 font-mono text-muted-foreground">
                        <span>Equity:</span>
                        <span className="font-bold text-foreground">
                          ${data.equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4 font-mono text-muted-foreground">
                        <span>Drawdown:</span>
                        <span className="text-destructive">{data.drawdown}%</span>
                      </div>
                    </div>
                  )
                }
                return null
              }}
            />
            <ReferenceLine y={initialCash} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
            <Area
              type="monotone"
              dataKey="equity"
              stroke={isPositive ? 'var(--chart-2)' : 'var(--destructive)'}
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#equityGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Underwater Drawdown Chart */}
      <div>
        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
          Drawdown Underwater (%)
        </div>
        <div className="h-20 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--destructive)" stopOpacity={0.0} />
                  <stop offset="95%" stopColor="var(--destructive)" stopOpacity={0.4} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" hide />
              <YAxis
                stroke="var(--muted-foreground)"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                domain={['auto', 0]}
                tickFormatter={(v) => `${v}%`}
              />
              <Area
                type="monotone"
                dataKey="drawdown"
                stroke="var(--destructive)"
                strokeWidth={1.5}
                fillOpacity={1}
                fill="url(#ddGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
