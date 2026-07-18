import { useMemo } from 'react'
import { AreaChart, Area, YAxis } from 'recharts'
import { MeasuredChartFrame } from './MeasuredChartFrame'

type SparklineColor = 'green' | 'red' | 'accent' | 'auto'

interface SparklineProps {
  values: number[]
  /** `auto` derives green/red from sign of (last - first); fallback `accent`. */
  color?: SparklineColor
  height?: number
  /** Width is fluid by default; set to fix the chart at a specific size. */
  width?: number
  className?: string
}

/**
 * Compact area chart for in-card "trend at a glance" rendering. No axes,
 * no tooltip, no legend — pure visual cue. Use `<Sparkline values={...} />`
 * inside a sized container; pass `width` only when the parent doesn't
 * provide an intrinsic size (recharts ResponsiveContainer needs one or
 * the other).
 *
 * Empty / single-point series renders nothing — the caller decides what
 * to show in that slot (microcopy, a dash, etc.).
 */
export function Sparkline({
  values,
  color = 'auto',
  height = 28,
  width,
  className,
}: SparklineProps) {
  const data = useMemo(() => values.map((v, i) => ({ i, v })), [values])

  const stroke = useMemo(() => {
    if (color === 'green') return 'var(--oa-market-up)'
    if (color === 'red') return 'var(--oa-market-down)'
    if (color === 'accent') return 'var(--color-accent)'
    if (values.length < 2) return 'var(--color-accent)'
    return values[values.length - 1] >= values[0]
      ? 'var(--oa-market-up)'
      : 'var(--oa-market-down)'
  }, [color, values])

  if (values.length < 2) return null

  // Unique gradient id per render so multiple sparklines in one tree don't
  // clobber each other's <linearGradient> defs.
  const gradId = useMemo(
    () => `sparkline-grad-${Math.random().toString(36).slice(2, 9)}`,
    [],
  )

  const containerStyle = width != null
    ? { width, height }
    : { width: '100%', height }

  return (
    <div style={containerStyle} className={className}>
      <MeasuredChartFrame className="h-full w-full">
        {({ width: measuredWidth, height: measuredHeight }) => (
          <AreaChart width={measuredWidth} height={measuredHeight} data={data} margin={{ top: 1, right: 0, bottom: 1, left: 0 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={['dataMin', 'dataMax']} />
            <Area
              type="monotone"
              dataKey="v"
              stroke={stroke}
              strokeWidth={1.25}
              fill={`url(#${gradId})`}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        )}
      </MeasuredChartFrame>
    </div>
  )
}
