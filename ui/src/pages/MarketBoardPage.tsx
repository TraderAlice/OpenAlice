import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LineChart, Line, ResponsiveContainer, YAxis, XAxis, Tooltip } from 'recharts'
import { PageHeader } from '../components/PageHeader'
import {
  referenceApi,
  type MoversBoard, type MoverRow, type ReferenceMeta, type CalendarBoard,
  type MacroBoard, type MacroSeriesCard, type TermStructureBoard, type TermCurve,
} from '../api/reference'
import { useWorkspace } from '../tabs/store'
import type { ViewSpec } from '../tabs/types'

type BoardKind = Extract<ViewSpec, { kind: 'market-board' }>['params']['board']

/** Tab titles (plain English, matching the registry's other title strings). */
export const MARKET_BOARD_TITLES: Record<BoardKind, string> = {
  movers: 'Movers',
  calendar: 'Calendar',
  macro: 'Macro',
  'term-structure': 'Term Structure',
}

const REFRESH_MS = 5 * 60 * 1000

interface PageProps {
  spec: Extract<ViewSpec, { kind: 'market-board' }>
  visible: boolean
}

export function MarketBoardPage({ spec }: PageProps) {
  switch (spec.params.board) {
    case 'movers':
      return <MoversBoardView />
    case 'calendar':
      return <CalendarBoardView />
    case 'macro':
      return <MacroBoardView />
    case 'term-structure':
      return <TermStructureBoardView />
  }
}

// ==================== Movers ====================

type MoversList = 'gainers' | 'losers' | 'active'

function MoversBoardView() {
  const { t } = useTranslation()
  const [data, setData] = useState<MoversBoard | null>(null)
  const [list, setList] = useState<MoversList>('gainers')
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await referenceApi.movers()
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

  const rows = data?.[list] ?? []

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('market.boardMovers')}
        description={
          <>
            {t('market.moversSubtitle')}
            {data && <ProviderBadge meta={data.meta} />}
          </>
        }
        live={{ lastUpdated: updatedAt }}
      />
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 flex flex-col gap-4 min-h-0">
        <div className="flex items-center gap-1">
          {(['gainers', 'losers', 'active'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setList(k)}
              className={`px-3 py-1 rounded-md text-[12px] font-medium transition-colors ${
                list === k
                  ? 'bg-bg-tertiary text-text'
                  : 'text-text-muted hover:text-text hover:bg-bg-secondary'
              }`}
            >
              {listLabel(k, t)}
            </button>
          ))}
        </div>

        {loading && !data && <div className="text-[13px] text-text-muted">{t('common.loading')}</div>}
        {error && (
          <div className="text-[13px] text-red border border-red/30 rounded-md px-3 py-2 bg-red/5">{error}</div>
        )}
        {data && rows.length === 0 && !loading && (
          <div className="text-[13px] text-text-muted">{t('market.noMatches')}</div>
        )}
        {rows.length > 0 && <MoversTable rows={rows} />}
      </div>
    </div>
  )
}

function listLabel(k: MoversList, t: ReturnType<typeof useTranslation>['t']): string {
  switch (k) {
    case 'gainers': return t('market.moversGainers')
    case 'losers': return t('market.moversLosers')
    case 'active': return t('market.moversActive')
  }
}

/** Explicit provider label — same disambiguation philosophy as bar sources. */
function ProviderBadge({ meta }: { meta: ReferenceMeta }) {
  return (
    <span className="text-text-muted/50"> · {meta.provider}</span>
  )
}

function MoversTable({ rows }: { rows: MoverRow[] }) {
  const { t } = useTranslation()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr className="text-text-muted/70 text-left border-b border-border">
            <th className="py-1.5 pr-3 font-medium">{t('market.colSymbol')}</th>
            <th className="py-1.5 px-3 font-medium text-right">{t('market.colPrice')}</th>
            <th className="py-1.5 px-3 font-medium text-right">{t('market.colChangePct')}</th>
            <th className="py-1.5 px-3 font-medium text-right">{t('market.colVolume')}</th>
            <th className="py-1.5 px-3 font-medium text-right">{t('market.colRvol')}</th>
            <th className="py-1.5 pl-3 font-medium text-right">{t('market.colDollarVolume')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.symbol}
              className="border-b border-border/50 hover:bg-bg-secondary/40 cursor-pointer"
              onClick={() => openOrFocus({ kind: 'market-detail', params: { assetClass: 'equity', symbol: r.symbol } })}
            >
              <td className="py-1.5 pr-3">
                <span className="font-mono font-semibold text-text">{r.symbol}</span>
                {r.name && <span className="ml-2 text-text-muted">{r.name}</span>}
              </td>
              <td className="py-1.5 px-3 text-right font-mono text-text">{fmtPrice(r.price)}</td>
              <td className={`py-1.5 px-3 text-right font-mono ${signColor(r.percent_change)}`}>{fmtPct(r.percent_change)}</td>
              <td className="py-1.5 px-3 text-right text-text">{fmtCompact(r.volume)}</td>
              <td className={`py-1.5 px-3 text-right ${rvolColor(r.relative_volume)}`}>{r.relative_volume?.toFixed(2) ?? '—'}</td>
              <td className="py-1.5 pl-3 text-right text-text">{fmtCompact(r.dollar_volume, '$')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ==================== Calendar ====================

type CalendarList = 'earnings' | 'ipos' | 'dividends'

function CalendarBoardView() {
  const { t } = useTranslation()
  const [data, setData] = useState<CalendarBoard | null>(null)
  const [list, setList] = useState<CalendarList>('earnings')
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await referenceApi.calendar()
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
    const timer = setInterval(load, 30 * 60 * 1000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('market.boardCalendar')}
        description={
          <>
            {t('market.calendarSubtitle')}
            {data && <span className="text-text-muted/50"> · {data.window.start} → {data.window.end} · {data.meta.provider}</span>}
          </>
        }
        live={{ lastUpdated: updatedAt }}
      />
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 flex flex-col gap-4 min-h-0">
        <div className="flex items-center gap-1">
          {(['earnings', 'ipos', 'dividends'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setList(k)}
              className={`px-3 py-1 rounded-md text-[12px] font-medium transition-colors ${
                list === k
                  ? 'bg-bg-tertiary text-text'
                  : 'text-text-muted hover:text-text hover:bg-bg-secondary'
              }`}
            >
              {calendarLabel(k, t)} ({data?.[k].length ?? 0})
            </button>
          ))}
        </div>

        {loading && !data && <div className="text-[13px] text-text-muted">{t('common.loading')}</div>}
        {error && (
          <div className="text-[13px] text-red border border-red/30 rounded-md px-3 py-2 bg-red/5">{error}</div>
        )}
        {/* Per-list upstream failure — loud, with the provider's own message. */}
        {data?.errors?.[list] && (
          <div className="text-[13px] text-red border border-red/30 rounded-md px-3 py-2 bg-red/5">{data.errors[list]}</div>
        )}
        {data && data[list].length === 0 && !loading && !data.errors?.[list] && (
          <div className="text-[13px] text-text-muted">{t('market.noMatches')}</div>
        )}
        {data && list === 'earnings' && data.earnings.length > 0 && <EarningsTable board={data} />}
        {data && list === 'ipos' && data.ipos.length > 0 && <IpoTable board={data} />}
        {data && list === 'dividends' && data.dividends.length > 0 && <DividendTable board={data} />}
      </div>
    </div>
  )
}

function calendarLabel(k: CalendarList, t: ReturnType<typeof useTranslation>['t']): string {
  switch (k) {
    case 'earnings': return t('market.calEarnings')
    case 'ipos': return t('market.calIpos')
    case 'dividends': return t('market.calDividends')
  }
}

function useOpenEquity() {
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  return (symbol: string | null) => {
    if (!symbol) return
    openOrFocus({ kind: 'market-detail', params: { assetClass: 'equity', symbol } })
  }
}

function EarningsTable({ board }: { board: CalendarBoard }) {
  const { t } = useTranslation()
  const open = useOpenEquity()
  // Sorted by date so the board reads as an agenda.
  const rows = [...board.earnings].sort((a, b) => a.report_date.localeCompare(b.report_date))
  return (
    <CalTable head={[t('market.colDate'), t('market.colSymbol'), t('market.colEpsPrev'), t('market.colEpsEst')]} rightCols={[2, 3]}>
      {rows.map((r, i) => (
        <tr key={`${r.symbol}-${i}`} className="border-b border-border/50 hover:bg-bg-secondary/40 cursor-pointer" onClick={() => open(r.symbol)}>
          <td className="py-1.5 pr-3 text-text-muted whitespace-nowrap">{r.report_date}</td>
          <td className="py-1.5 px-3">
            <span className="font-mono font-semibold text-text">{r.symbol}</span>
            {r.name && <span className="ml-2 text-text-muted">{r.name}</span>}
          </td>
          <td className="py-1.5 px-3 text-right font-mono text-text">{r.eps_previous ?? '—'}</td>
          <td className="py-1.5 pl-3 text-right font-mono text-text">{r.eps_consensus ?? '—'}</td>
        </tr>
      ))}
    </CalTable>
  )
}

function IpoTable({ board }: { board: CalendarBoard }) {
  const { t } = useTranslation()
  const open = useOpenEquity()
  const rows = [...board.ipos].sort((a, b) => (a.ipo_date ?? '').localeCompare(b.ipo_date ?? ''))
  return (
    <CalTable head={[t('market.colDate'), t('market.colSymbol'), t('market.colExchange')]}>
      {rows.map((r, i) => (
        <tr key={`${r.symbol}-${i}`} className="border-b border-border/50 hover:bg-bg-secondary/40 cursor-pointer" onClick={() => open(r.symbol)}>
          <td className="py-1.5 pr-3 text-text-muted whitespace-nowrap">{r.ipo_date ?? '—'}</td>
          <td className="py-1.5 px-3">
            <span className="font-mono font-semibold text-text">{r.symbol ?? '—'}</span>
            {typeof r.name === 'string' && r.name && <span className="ml-2 text-text-muted">{r.name}</span>}
          </td>
          <td className="py-1.5 pl-3 text-text-muted">{typeof r.exchange === 'string' ? r.exchange : '—'}</td>
        </tr>
      ))}
    </CalTable>
  )
}

function DividendTable({ board }: { board: CalendarBoard }) {
  const { t } = useTranslation()
  const open = useOpenEquity()
  const rows = [...board.dividends].sort((a, b) => a.ex_dividend_date.localeCompare(b.ex_dividend_date))
  return (
    <CalTable head={[t('market.colExDate'), t('market.colSymbol'), t('market.colDivAmount'), t('market.colPayDate')]} rightCols={[2]}>
      {rows.map((r, i) => (
        <tr key={`${r.symbol}-${i}`} className="border-b border-border/50 hover:bg-bg-secondary/40 cursor-pointer" onClick={() => open(r.symbol)}>
          <td className="py-1.5 pr-3 text-text-muted whitespace-nowrap">{r.ex_dividend_date}</td>
          <td className="py-1.5 px-3">
            <span className="font-mono font-semibold text-text">{r.symbol}</span>
            {r.name && <span className="ml-2 text-text-muted">{r.name}</span>}
          </td>
          <td className="py-1.5 px-3 text-right font-mono text-text">{r.amount ?? '—'}</td>
          <td className="py-1.5 pl-3 text-text-muted whitespace-nowrap">{r.payment_date ?? '—'}</td>
        </tr>
      ))}
    </CalTable>
  )
}

function CalTable({ head, rightCols = [], children }: { head: string[]; rightCols?: number[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr className="text-text-muted/70 text-left border-b border-border">
            {head.map((h, i) => (
              <th key={h} className={`py-1.5 font-medium ${i === 0 ? 'pr-3' : i === head.length - 1 ? 'pl-3' : 'px-3'} ${rightCols.includes(i) ? 'text-right' : ''}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

// ==================== Macro ====================

function MacroBoardView() {
  const { t } = useTranslation()
  const [data, setData] = useState<MacroBoard | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await referenceApi.macro()
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
    const timer = setInterval(load, 30 * 60 * 1000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('market.boardMacro')}
        description={
          <>
            {t('market.macroSubtitle')}
            {data && <span className="text-text-muted/50"> · {data.meta.provider}</span>}
          </>
        }
        live={{ lastUpdated: updatedAt }}
      />
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 min-h-0">
        {loading && !data && <div className="text-[13px] text-text-muted">{t('common.loading')}</div>}
        {error && (
          <div className="text-[13px] text-red border border-red/30 rounded-md px-3 py-2 bg-red/5">{error}</div>
        )}
        {data && (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {data.cards.map((c) => <MacroCard key={c.id} card={c} />)}
          </div>
        )}
      </div>
    </div>
  )
}

/** Known FRED ids → localized labels; anything else falls back to the
 *  English label the contract carries. */
function macroLabel(card: MacroSeriesCard, t: ReturnType<typeof useTranslation>['t']): string {
  switch (card.id) {
    case 'DFF': return t('market.macroFedFunds')
    case 'DGS2': return t('market.macro2y')
    case 'DGS10': return t('market.macro10y')
    case 'T10Y2Y': return t('market.macroSpread')
    case 'UNRATE': return t('market.macroUnemployment')
    case 'CPI_YOY': return t('market.macroCpiYoy')
    case 'ICSA': return t('market.macroClaims')
    case 'DCOILWTICO': return t('market.macroWti')
    case 'DTWEXBGS': return t('market.macroDollar')
    default: return card.label
  }
}

function fmtMacro(card: MacroSeriesCard, v: number | null): string {
  if (v == null) return '—'
  switch (card.unit) {
    case 'percent': return `${v.toFixed(2)}%`
    case 'usd': return `$${v.toFixed(2)}`
    case 'count': return fmtCompact(v)
    case 'index': return v.toFixed(1)
  }
}

function MacroCard({ card }: { card: MacroSeriesCard }) {
  const { t } = useTranslation()
  const empty = card.points.length === 0
  return (
    <div className="border border-border rounded-md bg-bg-secondary/40 px-3 py-2.5 flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] text-text-muted truncate" title={card.id}>{macroLabel(card, t)}</span>
        <span className="text-[10px] text-text-muted/50 shrink-0">{card.latestDate ?? ''}</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[20px] font-semibold text-text font-mono">{fmtMacro(card, card.latest)}</span>
          {card.change != null && card.change !== 0 && (
            <span className={`text-[11px] font-mono ${card.change > 0 ? 'text-green' : 'text-red'}`}>
              {card.change > 0 ? '+' : ''}{card.unit === 'count' ? fmtCompact(card.change) : card.change.toFixed(2)}
            </span>
          )}
        </div>
        <div className="w-28 h-9">
          {!empty && (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={card.points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <YAxis hide domain={['dataMin', 'dataMax']} />
                <Line type="monotone" dataKey="value" stroke="var(--color-accent)" strokeWidth={1.25} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
      {empty && <span className="text-[11px] text-text-muted/60">{t('market.noMatches')}</span>}
    </div>
  )
}

// ==================== Term structure ====================

function TermStructureBoardView() {
  const { t } = useTranslation()
  const [data, setData] = useState<TermStructureBoard | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await referenceApi.termStructure()
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
    const timer = setInterval(load, 5 * 60 * 1000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('market.boardTermStructure')}
        description={
          <>
            {t('market.termSubtitle')}
            {data && <span className="text-text-muted/50"> · {data.meta.provider}</span>}
          </>
        }
        live={{ lastUpdated: updatedAt }}
      />
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 flex flex-col gap-6 min-h-0">
        {loading && !data && <div className="text-[13px] text-text-muted">{t('common.loading')}</div>}
        {error && (
          <div className="text-[13px] text-red border border-red/30 rounded-md px-3 py-2 bg-red/5">{error}</div>
        )}
        {data?.errors && Object.entries(data.errors).map(([sym, msg]) => (
          <div key={sym} className="text-[13px] text-red border border-red/30 rounded-md px-3 py-2 bg-red/5">{sym}: {msg}</div>
        ))}
        {data?.curves.map((curve) => <TermCurveCard key={curve.symbol} curve={curve} />)}
      </div>
    </div>
  )
}

function TermCurveCard({ curve }: { curve: TermCurve }) {
  const { t } = useTranslation()
  // Contango when the far end trades above spot; backwardation otherwise.
  const far = curve.points[curve.points.length - 1]
  const regime = far?.price != null && curve.spot != null
    ? (far.price >= curve.spot ? t('market.termContango') : t('market.termBackwardation'))
    : null
  const chartData = curve.points
    .filter((p) => p.price != null)
    .map((p) => ({ ...p, label: p.expiration.slice(2) }))
  return (
    <div className="border border-border rounded-md bg-bg-secondary/40 px-4 py-3 flex flex-col gap-2">
      <div className="flex items-baseline gap-3">
        <span className="text-[15px] font-semibold font-mono text-text">{curve.symbol}</span>
        {curve.spot != null && (
          <span className="text-[12px] text-text-muted">{t('market.termSpotPerp')} <span className="font-mono text-text">{curve.spot.toLocaleString('en-US')}</span></span>
        )}
        {regime && <span className="text-[11px] uppercase tracking-wide text-text-muted/70">{regime}</span>}
      </div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#7d8590' }} stroke="#7d8590" />
            <YAxis domain={['dataMin', 'dataMax']} tick={{ fontSize: 10, fill: '#7d8590' }} stroke="#7d8590" width={70}
              tickFormatter={(v: number) => v.toLocaleString('en-US')} />
            <Tooltip
              formatter={(v) => [Number(v).toLocaleString('en-US'), '']}
              labelFormatter={(l) => `20${l}`}
              contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', fontSize: 11 }}
            />
            <Line type="monotone" dataKey="price" stroke="var(--color-accent)" strokeWidth={1.5} dot={{ r: 2.5 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {curve.points.map((p) => (
          <span key={p.expiration} className="text-[11px] px-1.5 py-0.5 rounded bg-bg-tertiary/60 font-mono" title={`${p.daysToExpiry ?? '—'}d`}>
            {p.expiration.slice(2)}{' '}
            <span className={p.annualizedBasis == null ? 'text-text-muted' : p.annualizedBasis >= 0 ? 'text-green' : 'text-red'}>
              {p.annualizedBasis == null ? '—' : `${p.annualizedBasis >= 0 ? '+' : ''}${p.annualizedBasis.toFixed(1)}%`}
            </span>
          </span>
        ))}
        {curve.points.length > 0 && (
          <span className="text-[10px] text-text-muted/60 self-center ml-1">{t('market.termBasisNote')}</span>
        )}
      </div>
    </div>
  )
}

function fmtPrice(x: number | null): string {
  return x == null ? '—' : x.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
function fmtPct(x: number | null): string {
  // percent_change is normalized to a fraction in the provider (0.052 = +5.2%).
  return x == null ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(2)}%`
}
function fmtCompact(x: number | null, prefix = ''): string {
  if (x == null) return '—'
  const abs = Math.abs(x)
  if (abs >= 1e12) return `${prefix}${(x / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${prefix}${(x / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${prefix}${(x / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${prefix}${(x / 1e3).toFixed(1)}K`
  return `${prefix}${x.toFixed(0)}`
}
function signColor(x: number | null): string {
  if (x == null) return 'text-text-muted'
  return x > 0 ? 'text-green' : x < 0 ? 'text-red' : 'text-text-muted'
}
function rvolColor(x: number | null): string {
  if (x == null) return 'text-text-muted'
  return x >= 2 ? 'text-amber-400 font-semibold' : 'text-text'
}
