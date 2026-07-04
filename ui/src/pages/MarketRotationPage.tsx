import { useEffect, useMemo, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import {
  ScatterChart, Scatter, Cell, LabelList, ReferenceLine,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import { BoardMeta } from '../components/market/BoardMeta'
import { PageHeader } from '../components/PageHeader'
import { CenteredLoading } from '../components/StateViews'
import { marketApi, type SectorRotationResult, type SectorRotationRow } from '../api/market'

const GREEN = 'var(--color-green)'
const RED = 'var(--color-red)'
const MUTED = '#7d8590'
const REFRESH_MS = 5 * 60 * 1000

function pct(x: number | null | undefined, places = 1): string {
  return x == null ? '—' : `${(x * 100).toFixed(places)}%`
}
function signColor(x: number | null | undefined): string {
  if (x == null) return 'text-text-muted'
  return x > 0 ? 'text-green' : x < 0 ? 'text-red' : 'text-text-muted'
}
function dotColor(score: number | null): string {
  if (score == null) return MUTED
  return score > 0 ? GREEN : score < 0 ? RED : MUTED
}

interface Point {
  symbol: string
  sector: string
  x: number // relative strength vs SPY (1M), %
  y: number // dollar-volume share change, %
  score: number | null
  rvol: number | null
}

export function MarketRotationPage() {
  const { t } = useTranslation()
  const [data, setData] = useState<SectorRotationResult | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await marketApi.sectorRotation()
        if (!alive) return
        setData(res)
        setUpdatedAt(new Date())
        setError(null)
      } catch (err) {
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  const points = useMemo<Point[]>(() => {
    if (!data) return []
    return data.sectors
      .map((s) => {
        const x = s.rel_strength['1M']
        const y = s.dv_share_change
        if (x == null || y == null) return null
        return { symbol: s.symbol, sector: s.sector, x: x * 100, y: y * 100, score: s.rotation_score, rvol: s.rvol }
      })
      .filter((p): p is Point => p !== null)
  }, [data])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('market.sectorRotation')}
        description={
          <>
            {t('market.rotationSubtitle')}
            {data && <><span className="text-text-muted/50"> · {t('market.asOf')} {data.asOf}</span>{data.meta && <BoardMeta meta={data.meta} />}</>}
          </>
        }
        live={{ lastUpdated: updatedAt }}
      />
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 flex flex-col gap-6 min-h-0">
        {loading && !data && <CenteredLoading label={t('common.loading')} />}
        {error && (
          <div className="text-[13px] text-red border border-red/30 rounded-md px-3 py-2 bg-red/5">{error}</div>
        )}

        {data && (
          <>
            <QuadrantChart points={points} t={t} />
            <RotationTable rows={data.sectors} benchmarkSymbol={data.benchmark.symbol} t={t} />
            <p className="max-w-3xl break-words text-[11px] leading-relaxed text-text-muted/70">
              <span className="font-semibold text-text-muted">{t('market.rotationMethodology')}: </span>
              {data.methodology}
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function QuadrantChart({ points, t }: { points: Point[]; t: TFunction }) {
  return (
    <div className="relative">
      {/* Quadrant corner labels */}
      <div className="pointer-events-none absolute inset-0 z-10">
        <CornerLabel className="top-1 right-2 text-green/70" text={t('market.quadRotatingIn')} />
        <CornerLabel className="top-1 left-12 text-text-muted/60" text={t('market.quadImproving')} />
        <CornerLabel className="bottom-7 right-2 text-text-muted/60" text={t('market.quadWeakening')} />
        <CornerLabel className="bottom-7 left-12 text-red/70" text={t('market.quadRotatingOut')} />
      </div>
      <ResponsiveContainer width="100%" height={420}>
        <ScatterChart margin={{ top: 24, right: 28, bottom: 28, left: 8 }}>
          <XAxis
            type="number" dataKey="x" name={t('market.axisRelStrength')}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            tick={{ fontSize: 11, fill: MUTED }} stroke={MUTED}
            domain={['dataMin - 1', 'dataMax + 1']}
          >
          </XAxis>
          <YAxis
            type="number" dataKey="y" name={t('market.axisVolumeShare')}
            tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            tick={{ fontSize: 11, fill: MUTED }} stroke={MUTED}
            domain={['dataMin - 0.5', 'dataMax + 0.5']}
          />
          <ReferenceLine x={0} stroke="var(--border)" strokeDasharray="4 4" />
          <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="4 4" />
          <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<PointTooltip t={t} />} />
          <Scatter data={points}>
            {points.map((p) => <Cell key={p.symbol} fill={dotColor(p.score)} />)}
            <LabelList dataKey="symbol" position="top" style={{ fontSize: 10, fill: 'var(--text)', fontWeight: 600 }} />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <div className="flex justify-between px-8 -mt-1 text-[10px] text-text-muted/50">
        <span>{t('market.axisRelStrength')} →</span>
        <span>↑ {t('market.axisVolumeShare')}</span>
      </div>
    </div>
  )
}

function CornerLabel({ className, text }: { className: string; text: string }) {
  return <span className={`absolute text-[10px] font-medium uppercase tracking-wide ${className}`}>{text}</span>
}

function PointTooltip({ active, payload, t }: { active?: boolean; payload?: Array<{ payload: Point }>; t: TFunction }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded-md border border-border bg-bg-secondary px-2.5 py-1.5 text-[11px] shadow-lg">
      <div className="font-mono font-semibold text-text">{p.symbol} <span className="text-text-muted font-sans font-normal">{p.sector}</span></div>
      <div className="mt-0.5 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
        <span className="text-text-muted">{t('market.colScore')}</span><span className={signColor(p.score)}>{p.score ?? '—'}</span>
        <span className="text-text-muted">{t('market.axisRelStrength')}</span><span className={signColor(p.x)}>{p.x.toFixed(1)}%</span>
        <span className="text-text-muted">{t('market.axisVolumeShare')}</span><span className={signColor(p.y)}>{p.y.toFixed(2)}%</span>
        <span className="text-text-muted">{t('market.colRvol')}</span><span className="text-text">{p.rvol ?? '—'}</span>
      </div>
    </div>
  )
}

function RotationTable({ rows, benchmarkSymbol, t }: { rows: SectorRotationRow[]; benchmarkSymbol: string; t: TFunction }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0" data-testid="sector-rotation-table-scroll">
      {/* Keep the market columns readable; narrow screens scroll instead of compressing headers together. */}
      <table className="w-full min-w-[820px] border-collapse text-[12px]" data-testid="sector-rotation-table">
        <thead>
          <tr className="whitespace-nowrap border-b border-border text-left text-text-muted/70">
            <th className="w-[220px] py-1.5 pr-3 font-medium">{t('market.colSector')}</th>
            <th className="w-[72px] py-1.5 px-3 font-medium text-right">{t('market.colScore')}</th>
            <th className="w-[64px] py-1.5 px-3 font-medium text-right">1W</th>
            <th className="w-[64px] py-1.5 px-3 font-medium text-right">1M</th>
            <th className="w-[64px] py-1.5 px-3 font-medium text-right">3M</th>
            <th className="w-[88px] py-1.5 px-3 font-medium text-right">{t('market.colVsBench', { sym: benchmarkSymbol })}</th>
            <th className="w-[72px] py-1.5 px-3 font-medium text-right">{t('market.colRvol')}</th>
            <th className="w-[120px] py-1.5 pl-3 font-medium text-right">{t('market.colVolShareDelta')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol} className="whitespace-nowrap border-b border-border/50 hover:bg-bg-secondary/40">
              <td className="py-1.5 pr-3">
                <span className="font-mono font-semibold text-text">{r.symbol}</span>
                <span className="ml-2 text-text-muted">{r.sector}</span>
              </td>
              <td className={`py-1.5 px-3 text-right font-mono ${signColor(r.rotation_score)}`}>{r.rotation_score ?? '—'}</td>
              <td className={`py-1.5 px-3 text-right ${signColor(r.returns['1W'])}`}>{pct(r.returns['1W'])}</td>
              <td className={`py-1.5 px-3 text-right ${signColor(r.returns['1M'])}`}>{pct(r.returns['1M'])}</td>
              <td className={`py-1.5 px-3 text-right ${signColor(r.returns['3M'])}`}>{pct(r.returns['3M'])}</td>
              <td className={`py-1.5 px-3 text-right ${signColor(r.rel_strength['1M'])}`}>{pct(r.rel_strength['1M'])}</td>
              <td className="py-1.5 px-3 text-right text-text">{r.rvol ?? '—'}</td>
              <td className={`py-1.5 pl-3 text-right ${signColor(r.dv_share_change)}`}>{pct(r.dv_share_change, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
