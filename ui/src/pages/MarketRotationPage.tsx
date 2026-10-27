import { useMemo, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import {
  ScatterChart, Scatter, Cell, LabelList, ReferenceLine,
  XAxis, YAxis, Tooltip,
} from 'recharts'
import { BoardMeta } from '../components/market/BoardMeta'
import { MeasuredChartFrame } from '../components/MeasuredChartFrame'
import { PageHeader } from '../components/PageHeader'
import { CenteredLoading } from '../components/StateViews'
import { Button } from '../components/ui/button'
import { ArrowDown, ArrowUp, ArrowUpDown, RefreshCw } from 'lucide-react'
import { useReferenceBoard } from '../components/market/useReferenceBoard'
import { compareNumbers, type SortDirection } from '../lib/compare-numbers'
import { useWorkspace } from '../tabs/store'
import { marketApi, type RotationPeriod, type SectorRotationRow } from '../api/market'

const GREEN = 'var(--success)'
const RED = 'var(--destructive)'
const MUTED = 'var(--chart-axis)'
const REFRESH_MS = 5 * 60 * 1000

function pct(x: number | null | undefined, places = 1): string {
  return signed(x == null ? null : x * 100, places, '%')
}
function pp(x: number | null | undefined, places = 1): string {
  return signed(x == null ? null : x * 100, places, ' pp')
}
function signed(x: number | null | undefined, places: number, suffix: string): string {
  return x == null || !Number.isFinite(x) ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(places)}${suffix}`
}
function signColor(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return 'text-muted-foreground'
  return x > 0 ? 'text-success' : x < 0 ? 'text-destructive' : 'text-muted-foreground'
}
function dotColor(score: number | null): string {
  if (score == null || !Number.isFinite(score)) return MUTED
  return score > 0 ? GREEN : score < 0 ? RED : MUTED
}

interface Point {
  symbol: string
  sector: string
  x: number // selected-period relative return, percentage points
  y: number // dollar-volume share change, percentage points
  score: number | null
  rvol: number | null
}

export function MarketRotationPage() {
  const { t } = useTranslation()
  const { data, updatedAt, loading, error, retry } = useReferenceBoard(marketApi.sectorRotation, REFRESH_MS)
  const [period, setPeriod] = useState<RotationPeriod>('1M')

  const points = useMemo<Point[]>(() => {
    if (!data) return []
    return data.sectors
      .map((s) => {
        const x = s.rel_strength[period]
        const y = s.dv_share_change
        if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return null
        return { symbol: s.symbol, sector: t(`news.market.sectorNames.${s.symbol}`, { defaultValue: s.sector }), x: x * 100, y: y * 100, score: s.rotation_score, rvol: s.rvol }
      })
      .filter((p): p is Point => p !== null)
  }, [data, period, t])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('market.sectorRotation')}
        right={<Button size="xs" variant="ghost" onClick={retry} disabled={loading} aria-label={t('common.refresh')}><RefreshCw className={`size-3.5 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden /></Button>}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>{t('market.rotationSubtitle')}</span>
            {data && <span className="text-muted-foreground/70">{t('market.asOf')} {data.asOf}</span>}
            {data?.meta && <BoardMeta meta={data.meta} />}
          </span>
        }
        live={{ lastUpdated: updatedAt, label: 'Fetched', hideDot: true }}
      />
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 flex flex-col gap-4 min-h-0">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <div role="group" aria-label={t('news.market.performancePeriod')} className="flex gap-0.5">
            {(['1D', '1W', '1M', '3M', '6M'] as const).map(value => <Button key={value} size="xs" variant={period === value ? 'secondary' : 'ghost'} aria-pressed={period === value} onClick={() => setPeriod(value)}>{value}</Button>)}
          </div>
          {data && <span className="tabular-nums">{data.benchmark.symbol} · {period} {pct(data.benchmark.returns[period])}</span>}
        </div>
        {loading && !data && <CenteredLoading label={t('common.loading')} />}
        {error && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] leading-5 text-destructive"
          >
            <span className="min-w-0 break-words">{error}</span>
            <Button
              type="button"
              className="shrink-0"
              variant="destructive"
              size="sm"
              onClick={retry}
            >
              {t('common.retry')}
            </Button>
          </div>
        )}

        {data && !data.sectors.length && <p role="status" className="text-xs text-muted-foreground">{t('market.noMatches')}</p>}
        {data && data.sectors.length > 0 && (
          <>
            <QuadrantChart points={points} period={period} benchmark={data.benchmark.symbol} t={t} />
            <RotationTable rows={data.sectors} period={period} benchmarkSymbol={data.benchmark.symbol} t={t} />
            <details className="max-w-3xl text-xs text-muted-foreground"><summary className="cursor-pointer rounded-sm py-1 focus-visible:outline-2 focus-visible:outline-ring">{t('market.rotationMethodology')}</summary><p className="mt-1 break-words text-[11px] leading-relaxed">{data.methodology}</p></details>
          </>
        )}
      </div>
    </div>
  )
}

function QuadrantChart({ points, period, benchmark, t }: { points: Point[]; period: RotationPeriod; benchmark: string; t: TFunction }) {
  const extentX = Math.max(1, ...points.map(point => Math.abs(point.x))) * 1.15
  const extentY = Math.max(0.1, ...points.map(point => Math.abs(point.y))) * 1.15
  const strengthLabel = t('market.rotationStrengthAxis', { symbol: benchmark, period })
  if (!points.length) return <p role="status" className="text-xs text-muted-foreground">{t('market.rotationNoComparable')}</p>
  return (
    <div className="relative shrink-0">
      {/* Quadrant corner labels */}
      <div className="pointer-events-none absolute inset-0 z-10">
        <CornerLabel className="top-1 right-2 text-success/70" text={t('market.quadRotatingIn')} />
        <CornerLabel className="top-1 left-12 text-muted-foreground/60" text={t('market.quadImproving')} />
        <CornerLabel className="bottom-7 right-2 text-muted-foreground/60" text={t('market.quadWeakening')} />
        <CornerLabel className="bottom-7 left-12 text-destructive/70" text={t('market.quadRotatingOut')} />
      </div>
      <MeasuredChartFrame className="h-[280px] w-full">
        {({ width, height }) => (
          <ScatterChart accessibilityLayer width={width} height={height} margin={{ top: 24, right: 28, bottom: 28, left: 8 }}>
          <XAxis
            type="number" dataKey="x" name={strengthLabel}
            tickFormatter={(v: number) => v.toFixed(0)}
            tick={{ fontSize: 11, fill: MUTED }} stroke={MUTED}
            domain={[-extentX, extentX]}
          >
          </XAxis>
          <YAxis
            type="number" dataKey="y" name={t('market.rotationShareAxis')}
            tickFormatter={(v: number) => v.toFixed(1)}
            tick={{ fontSize: 11, fill: MUTED }} stroke={MUTED}
            domain={[-extentY, extentY]}
          />
          <ReferenceLine x={0} stroke="var(--border)" strokeDasharray="4 4" />
          <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="4 4" />
          <Tooltip
            isAnimationActive={false}
            cursor={{ strokeDasharray: '3 3' }}
            content={<PointTooltip t={t} strengthLabel={strengthLabel} />}
          />
          <Scatter data={points} isAnimationActive={false}>
            {points.map((p) => <Cell key={p.symbol} fill={dotColor(p.score)} />)}
            <LabelList dataKey="symbol" position="top" style={{ fontSize: 10, fill: 'var(--foreground)', fontWeight: 600 }} />
          </Scatter>
          </ScatterChart>
        )}
      </MeasuredChartFrame>
      <div className="flex flex-wrap justify-between gap-x-3 px-2 -mt-1 text-[10px] text-muted-foreground">
        <span>{strengthLabel} →</span>
        <span>↑ {t('market.rotationShareAxis')}</span>
      </div>
    </div>
  )
}

function CornerLabel({ className, text }: { className: string; text: string }) {
  return <span className={`absolute text-[11px] font-medium ${className}`}>{text}</span>
}

function PointTooltip({ active, payload, t, strengthLabel }: { active?: boolean; payload?: Array<{ payload: Point }>; t: TFunction; strengthLabel: string }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="oa-chart-tooltip px-2.5 py-1.5 text-[11px] leading-[15px]">
      <div className="font-mono font-semibold text-foreground">{p.symbol} <span className="text-muted-foreground font-sans font-normal">{p.sector}</span></div>
      <div className="mt-0.5 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
        <span className="text-muted-foreground">{t('market.colScore')}</span><span className={signColor(p.score)}>{signed(p.score, 2, '')}</span>
        <span className="text-muted-foreground">{strengthLabel}</span><span className={signColor(p.x)}>{signed(p.x, 1, ' pp')}</span>
        <span className="text-muted-foreground">{t('market.rotationShareAxis')}</span><span className={signColor(p.y)}>{signed(p.y, 2, ' pp')}</span>
        <span className="text-muted-foreground">{t('market.colRvol')}</span><span className="text-foreground">{signed(p.rvol, 2, '')}</span>
      </div>
    </div>
  )
}

function RotationTable({ rows, period, benchmarkSymbol, t }: { rows: SectorRotationRow[]; period: RotationPeriod; benchmarkSymbol: string; t: TFunction }) {
  const open = useWorkspace(state => state.openOrFocus)
  const [sort, setSort] = useState<{ key: 'score' | 'return' | 'relative' | 'rvol' | 'share'; direction: SortDirection } | null>(null)
  const columns = [
    { key: 'score', label: t('market.colScore') }, { key: 'return', label: `${t('market.rotationReturn')} · ${period}` },
    { key: 'relative', label: `${t('market.colVsBench', { sym: benchmarkSymbol })} · ${period}` },
    { key: 'rvol', label: t('market.colRvol') }, { key: 'share', label: t('market.colVolShareDelta') },
  ] as const
  const sorted = useMemo(() => {
    if (!sort) return rows
    const value = (row: SectorRotationRow) => ({ score: row.rotation_score, return: row.returns[period], relative: row.rel_strength[period], rvol: row.rvol, share: row.dv_share_change })[sort.key]
    return [...rows].sort((a, b) => compareNumbers(value(a), value(b), sort.direction))
  }, [rows, period, sort])
  return (
    <div className="-mx-4 shrink-0 overflow-x-auto px-4 md:mx-0 md:px-0" data-testid="sector-rotation-table-scroll">
      {/* The page owns vertical scrolling; horizontal overflow must not let flex shrink the table's height. */}
      {/* Keep the market columns readable; narrow screens scroll instead of compressing headers together. */}
      <table className="w-full min-w-[640px] border-collapse text-caption tabular-nums" data-testid="sector-rotation-table">
        <thead>
          <tr className="whitespace-nowrap border-b border-border text-left text-muted-foreground/70">
            <th className="w-[220px] py-1.5 pr-3 font-medium">{t('market.colSector')}</th>
            {columns.map(column => {
              const direction = sort?.key === column.key ? sort.direction : undefined
              const Icon = direction === 'ascending' ? ArrowUp : direction === 'descending' ? ArrowDown : ArrowUpDown
              return <th key={column.key} scope="col" aria-sort={direction ?? 'none'} className="px-3 py-1 font-medium text-right"><button type="button" className="flex min-h-8 w-full items-center justify-end gap-1 rounded-sm focus-visible:outline-2 focus-visible:outline-ring" onClick={() => {
                if (sort?.key !== column.key) setSort({ key: column.key, direction: 'descending' })
                else if (sort.direction === 'descending') setSort({ key: column.key, direction: 'ascending' })
                else setSort(null)
              }}>{column.label}<Icon className="size-3 text-muted-foreground" aria-hidden /></button></th>
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.symbol} className="whitespace-nowrap border-b border-border/50 hover:bg-secondary/40">
              <td className="py-1.5 pr-3">
                <button type="button" aria-label={t('market.openSymbol', { symbol: r.symbol })} onClick={() => open({ kind: 'market-detail', params: { assetClass: 'equity', symbol: r.symbol } })} className="inline-flex max-w-60 items-baseline gap-2 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring"><span className="font-mono font-semibold text-foreground">{r.symbol}</span><span className="truncate text-muted-foreground">{t(`news.market.sectorNames.${r.symbol}`, { defaultValue: r.sector })}</span></button>
              </td>
              <td className={`py-1.5 px-3 text-right font-mono ${signColor(r.rotation_score)}`}>{signed(r.rotation_score, 2, '')}</td>
              <td className={`py-1.5 px-3 text-right ${signColor(r.returns[period])}`}>{pct(r.returns[period])}</td>
              <td className={`py-1.5 px-3 text-right ${signColor(r.rel_strength[period])}`}>{pp(r.rel_strength[period])}</td>
              <td className="py-1.5 px-3 text-right text-foreground">{signed(r.rvol, 2, '')}</td>
              <td className={`py-1.5 pl-3 text-right ${signColor(r.dv_share_change)}`}>{pp(r.dv_share_change, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
