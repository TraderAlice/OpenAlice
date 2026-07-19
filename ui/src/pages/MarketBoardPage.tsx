import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LineChart, Line, YAxis, XAxis, Tooltip } from 'recharts'
import { useReferenceBoard } from '../components/market/useReferenceBoard'
import { BoardMeta } from '../components/market/BoardMeta'
import { PageHeader } from '../components/PageHeader'
import { CenteredLoading } from '../components/StateViews'
import { SeriesCard } from '../components/market/SeriesCard'
import { MeasuredChartFrame } from '../components/MeasuredChartFrame'
import {
  referenceApi,
  type MoversBoard, type MoverRow, type ReferenceMeta, type CalendarBoard,
  type MacroBoard, type MacroSeriesCard, type TermStructureBoard, type TermCurve,
  type GlobalMacroBoard, type GlobalMacroCell, type ShippingBoard, type ShippingCurve,
  type FedBoard,
} from '../api/reference'
import { useWorkspace } from '../tabs/store'
import type { ViewSpec } from '../tabs/types'

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
    case 'global-macro':
      return <GlobalMacroBoardView />
    case 'shipping':
      return <ShippingBoardView />
    case 'fed':
      return <FedBoardView />
  }
}

// ==================== Movers ====================

type MoversList = 'gainers' | 'losers' | 'active' | 'undervaluedGrowth' | 'growthTech' | 'smallCaps' | 'undervaluedLarge'

function MoversBoardView() {
  const { t } = useTranslation()
  const { data, updatedAt, loading, error } = useReferenceBoard<MoversBoard>(referenceApi.movers, REFRESH_MS)
  const [list, setList] = useState<MoversList>('gainers')

  const rows = data?.[list] ?? []

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('market.boardMovers')}
        description={
          <>
            {t('market.moversSubtitle')}
            {data && <BoardMeta meta={data.meta} />}
          </>
        }
        live={{ lastUpdated: updatedAt }}
      />
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 flex flex-col gap-4 min-h-0">
        <div className="flex items-center gap-1">
          {(['gainers', 'losers', 'active', 'undervaluedGrowth', 'growthTech', 'smallCaps', 'undervaluedLarge'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setList(k)}
              className={`px-3 py-1 rounded-md text-[12px] font-medium transition-colors ${
                list === k
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              {t(listLabelKey(k))}
            </button>
          ))}
        </div>

        {loading && !data && <CenteredLoading label={t('common.loading')} />}
        {error && (
          <div className="text-[13px] text-destructive border border-destructive/30 rounded-md px-3 py-2 bg-destructive/5">{error}</div>
        )}
        {data && rows.length === 0 && !loading && (
          <div className="text-[13px] text-muted-foreground">{t('market.noMatches')}</div>
        )}
        {rows.length > 0 && <MoversTable rows={rows} />}
      </div>
    </div>
  )
}

function listLabelKey(k: MoversList) {
  switch (k) {
    case 'gainers': return 'market.moversGainers' as const
    case 'losers': return 'market.moversLosers' as const
    case 'active': return 'market.moversActive' as const
    case 'undervaluedGrowth': return 'market.moversUndervaluedGrowth' as const
    case 'growthTech': return 'market.moversGrowthTech' as const
    case 'smallCaps': return 'market.moversSmallCaps' as const
    case 'undervaluedLarge': return 'market.moversUndervaluedLarge' as const
  }
}

function MoversTable({ rows }: { rows: MoverRow[] }) {
  const { t } = useTranslation()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr className="text-muted-foreground/70 text-left border-b border-border">
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
              className="border-b border-border/50 hover:bg-secondary/40 cursor-pointer"
              onClick={() => openOrFocus({ kind: 'market-detail', params: { assetClass: 'equity', symbol: r.symbol } })}
            >
              <td className="py-1.5 pr-3">
                <span className="font-mono font-semibold text-foreground">{r.symbol}</span>
                {r.name && <span className="ml-2 text-muted-foreground">{r.name}</span>}
              </td>
              <td className="py-1.5 px-3 text-right font-mono text-foreground">{fmtPrice(r.price)}</td>
              <td className={`py-1.5 px-3 text-right font-mono ${signColor(r.percent_change)}`}>{fmtPct(r.percent_change)}</td>
              <td className="py-1.5 px-3 text-right text-foreground">{fmtCompact(r.volume)}</td>
              <td className={`py-1.5 px-3 text-right ${rvolColor(r.relative_volume)}`}>{r.relative_volume?.toFixed(2) ?? '—'}</td>
              <td className="py-1.5 pl-3 text-right text-foreground">{fmtCompact(r.dollar_volume, '$')}</td>
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
  const { data, updatedAt, loading, slow, error, retry } = useReferenceBoard<CalendarBoard>(referenceApi.calendar, 30 * 60 * 1000)
  const [list, setList] = useState<CalendarList>('earnings')

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('market.boardCalendar')}
        description={
          <>
            {t('market.calendarSubtitle')}
            {data && <BoardMeta meta={data.meta} extra={`${data.window.start} → ${data.window.end}`} />}
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
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              {t(calendarLabelKey(k))} ({data?.[k].length ?? 0})
            </button>
          ))}
        </div>

        {loading && !data && (
          <CenteredLoading label={slow ? t('market.calendarSlowLoading') : t('common.loading')} />
        )}
        {error && (
          <div className="flex items-center justify-between gap-3 text-[13px] text-destructive border border-destructive/30 rounded-md px-3 py-2 bg-destructive/5">
            <span className="min-w-0 break-words">{error}</span>
            <button
              type="button"
              onClick={retry}
              className="shrink-0 text-[12px] font-medium text-destructive hover:text-destructive/80"
            >
              {t('common.retry')}
            </button>
          </div>
        )}
        {/* Per-list upstream failure — loud, with the provider's own message. */}
        {data?.errors?.[list] && (
          <div className="text-[13px] text-destructive border border-destructive/30 rounded-md px-3 py-2 bg-destructive/5">{data.errors[list]}</div>
        )}
        {data && data[list].length === 0 && !loading && !data.errors?.[list] && (
          <div className="text-[13px] text-muted-foreground">{t('market.noMatches')}</div>
        )}
        {data && list === 'earnings' && data.earnings.length > 0 && <EarningsTable board={data} />}
        {data && list === 'ipos' && data.ipos.length > 0 && <IpoTable board={data} />}
        {data && list === 'dividends' && data.dividends.length > 0 && <DividendTable board={data} />}
      </div>
    </div>
  )
}

function calendarLabelKey(k: CalendarList) {
  switch (k) {
    case 'earnings': return 'market.calEarnings' as const
    case 'ipos': return 'market.calIpos' as const
    case 'dividends': return 'market.calDividends' as const
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
        <tr key={`${r.symbol}-${i}`} className="border-b border-border/50 hover:bg-secondary/40 cursor-pointer" onClick={() => open(r.symbol)}>
          <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{r.report_date}</td>
          <td className="py-1.5 px-3">
            <span className="font-mono font-semibold text-foreground">{r.symbol}</span>
            {r.name && <span className="ml-2 text-muted-foreground">{r.name}</span>}
          </td>
          <td className="py-1.5 px-3 text-right font-mono text-foreground">{r.eps_previous ?? '—'}</td>
          <td className="py-1.5 pl-3 text-right font-mono text-foreground">{r.eps_consensus ?? '—'}</td>
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
        <tr key={`${r.symbol}-${i}`} className="border-b border-border/50 hover:bg-secondary/40 cursor-pointer" onClick={() => open(r.symbol)}>
          <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{r.ipo_date ?? '—'}</td>
          <td className="py-1.5 px-3">
            <span className="font-mono font-semibold text-foreground">{r.symbol ?? '—'}</span>
            {typeof r.name === 'string' && r.name && <span className="ml-2 text-muted-foreground">{r.name}</span>}
          </td>
          <td className="py-1.5 pl-3 text-muted-foreground">{typeof r.exchange === 'string' ? r.exchange : '—'}</td>
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
        <tr key={`${r.symbol}-${i}`} className="border-b border-border/50 hover:bg-secondary/40 cursor-pointer" onClick={() => open(r.symbol)}>
          <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{r.ex_dividend_date}</td>
          <td className="py-1.5 px-3">
            <span className="font-mono font-semibold text-foreground">{r.symbol}</span>
            {r.name && <span className="ml-2 text-muted-foreground">{r.name}</span>}
          </td>
          <td className="py-1.5 px-3 text-right font-mono text-foreground">{r.amount ?? '—'}</td>
          <td className="py-1.5 pl-3 text-muted-foreground whitespace-nowrap">{r.payment_date ?? '—'}</td>
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
          <tr className="text-muted-foreground/70 text-left border-b border-border">
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
  const { data, updatedAt, loading, error } = useReferenceBoard<MacroBoard>(referenceApi.macro, 30 * 60 * 1000)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('market.boardMacro')}
        description={
          <>
            {t('market.macroSubtitle')}
            {data && <BoardMeta meta={data.meta} />}
          </>
        }
        live={{ lastUpdated: updatedAt }}
      />
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 min-h-0">
        {loading && !data && <CenteredLoading label={t('common.loading')} />}
        {error && (
          <div className="text-[13px] text-destructive border border-destructive/30 rounded-md px-3 py-2 bg-destructive/5">{error}</div>
        )}
        {data && (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {data.cards.map((c) => {
              const labelKey = MACRO_LABEL_KEYS[c.id as keyof typeof MACRO_LABEL_KEYS]
              return (
                <SeriesCard key={c.id} card={c} label={labelKey ? t(labelKey) : c.label} emptyText={t('market.noMatches')} />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/** Known FRED ids → localized labels; anything else falls back to the
 *  English label the contract carries. */
const MACRO_LABEL_KEYS = {
  DFF: 'market.macroFedFunds',
  DGS2: 'market.macro2y',
  DGS10: 'market.macro10y',
  T10Y2Y: 'market.macroSpread',
  UNRATE: 'market.macroUnemployment',
  CPI_YOY: 'market.macroCpiYoy',
  ICSA: 'market.macroClaims',
  DCOILWTICO: 'market.macroWti',
  DTWEXBGS: 'market.macroDollar',
  PAYEMS: 'market.macroPayrolls',
  M2SL: 'market.macroM2',
  UMCSENT: 'market.macroSentiment',
  T10YIE: 'market.macroBreakeven',
  DRTSCILM: 'market.macroSloos',
} as const

// ==================== Term structure ====================

function TermStructureBoardView() {
  const { t } = useTranslation()
  const { data, updatedAt, loading, error } = useReferenceBoard<TermStructureBoard>(referenceApi.termStructure, 5 * 60 * 1000)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('market.boardTermStructure')}
        description={
          <>
            {t('market.termSubtitle')}
            {data && <BoardMeta meta={data.meta} />}
          </>
        }
        live={{ lastUpdated: updatedAt }}
      />
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 flex flex-col gap-6 min-h-0">
        {loading && !data && <CenteredLoading label={t('common.loading')} />}
        {error && (
          <div className="text-[13px] text-destructive border border-destructive/30 rounded-md px-3 py-2 bg-destructive/5">{error}</div>
        )}
        {data?.errors && Object.entries(data.errors).map(([sym, msg]) => (
          <div key={sym} className="text-[13px] text-destructive border border-destructive/30 rounded-md px-3 py-2 bg-destructive/5">{sym}: {msg}</div>
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
    <div className="border border-border rounded-md bg-secondary/40 px-4 py-3 flex flex-col gap-2">
      <div className="flex items-baseline gap-3">
        <span className="text-[15px] font-semibold font-mono text-foreground">{curve.symbol}</span>
        {curve.spot != null && (
          <span className="text-[12px] text-muted-foreground">{t('market.termSpotPerp')} <span className="font-mono text-foreground">{curve.spot.toLocaleString('en-US')}</span></span>
        )}
        {regime && <span className="text-[11px] uppercase tracking-wide text-muted-foreground/70">{regime}</span>}
      </div>
      <MeasuredChartFrame className="h-40">
        {({ width, height }) => (
          <LineChart width={width} height={height} data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--chart-axis)' }} stroke="var(--chart-axis)" />
            <YAxis domain={['dataMin', 'dataMax']} tick={{ fontSize: 10, fill: 'var(--chart-axis)' }} stroke="var(--chart-axis)" width={70}
              tickFormatter={(v: number) => v.toLocaleString('en-US')} />
            <Tooltip
              formatter={(v) => [Number(v).toLocaleString('en-US'), '']}
              labelFormatter={(l) => `20${l}`}
              contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', fontSize: 11 }}
            />
            <Line type="monotone" dataKey="price" stroke="var(--primary)" strokeWidth={1.5} dot={{ r: 2.5 }} isAnimationActive={false} />
          </LineChart>
        )}
      </MeasuredChartFrame>
      <div className="flex flex-wrap gap-1.5">
        {curve.points.map((p) => (
          <span key={p.expiration} className="text-[11px] px-1.5 py-0.5 rounded bg-muted/60 font-mono" title={`${p.daysToExpiry ?? '—'}d`}>
            {p.expiration.slice(2)}{' '}
            <span className={p.annualizedBasis == null ? 'text-muted-foreground' : p.annualizedBasis >= 0 ? 'text-success' : 'text-destructive'}>
              {p.annualizedBasis == null ? '—' : `${p.annualizedBasis >= 0 ? '+' : ''}${p.annualizedBasis.toFixed(1)}%`}
            </span>
          </span>
        ))}
        {curve.points.length > 0 && (
          <span className="text-[10px] text-muted-foreground/60 self-center ml-1">{t('market.termBasisNote')}</span>
        )}
      </div>
    </div>
  )
}

// ==================== Global macro ====================

function GlobalMacroBoardView() {
  const { t } = useTranslation()
  const { data, updatedAt, loading, error } = useReferenceBoard<GlobalMacroBoard>(referenceApi.globalMacro, 60 * 60 * 1000)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('market.boardGlobalMacro')}
        description={
          <>
            {t('market.globalMacroSubtitle')}
            {data && <BoardMeta meta={data.meta} />}
          </>
        }
        live={{ lastUpdated: updatedAt }}
      />
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 min-h-0">
        {loading && !data && <CenteredLoading label={t('common.loading')} />}
        {error && (
          <div className="text-[13px] text-destructive border border-destructive/30 rounded-md px-3 py-2 bg-destructive/5">{error}</div>
        )}
        {data && (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr className="text-muted-foreground/70 text-left border-b border-border">
                  <th className="py-1.5 pr-3 font-medium">{t('market.colCountry')}</th>
                  <th className="py-1.5 px-3 font-medium text-right">{t('market.colCpiYoy')}</th>
                  <th className="py-1.5 px-3 font-medium text-right">{t('market.colShortRate')}</th>
                  <th className="py-1.5 px-3 font-medium text-right">{t('market.colCli')}</th>
                  <th className="py-1.5 px-3 font-medium text-right">{t('market.colHousePrice')}</th>
                  <th className="py-1.5 pl-3 font-medium text-right">{t('market.colSharePrice')}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.country} className="border-b border-border/50 hover:bg-secondary/40">
                    <td className="py-1.5 pr-3 text-foreground font-medium">{r.label}</td>
                    <GlobalCell cell={r.cpiYoy} fmt={(v) => `${v.toFixed(2)}%`} colorBy="cpi" />
                    <GlobalCell cell={r.shortRate} fmt={(v) => `${v.toFixed(2)}%`} />
                    <GlobalCell cell={r.cli} fmt={(v) => v.toFixed(1)} colorBy="cli" />
                    <GlobalCell cell={r.housePrice} fmt={(v) => v.toFixed(1)} />
                    <GlobalCell cell={r.sharePrice} fmt={(v) => v.toFixed(1)} />
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[10px] text-muted-foreground/60">{t('market.globalMacroNote')}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function GlobalCell({ cell, fmt, colorBy }: { cell: GlobalMacroCell; fmt: (v: number) => string; colorBy?: 'cpi' | 'cli' }) {
  if (cell.value == null) {
    return <td className="py-1.5 px-3 text-right text-muted-foreground/50" title={cell.error ?? 'no data'}>—</td>
  }
  let color = 'text-foreground'
  if (colorBy === 'cpi') color = cell.value >= 4 ? 'text-destructive' : cell.value <= 1 ? 'text-muted-foreground' : 'text-foreground'
  if (colorBy === 'cli') color = cell.value >= 100 ? 'text-success' : 'text-destructive'
  return (
    <td className={`py-1.5 px-3 text-right font-mono ${color}`} title={cell.date ?? ''}>{fmt(cell.value)}</td>
  )
}

// ==================== Shipping ====================

function ShippingBoardView() {
  const { t } = useTranslation()
  const { data, updatedAt, loading, error } = useReferenceBoard<ShippingBoard>(referenceApi.shipping, 60 * 60 * 1000)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('market.boardShipping')}
        description={
          <>
            {t('market.shippingSubtitle')}
            {data && <BoardMeta meta={data.meta} />}
          </>
        }
        live={{ lastUpdated: updatedAt }}
      />
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 min-h-0">
        {loading && !data && <CenteredLoading label={t('common.loading')} />}
        {error && (
          <div className="text-[13px] text-destructive border border-destructive/30 rounded-md px-3 py-2 bg-destructive/5">{error}</div>
        )}
        {data?.errors && Object.entries(data.errors).map(([key, msg]) => (
          <div key={key} className="mb-3 text-[13px] text-destructive border border-destructive/30 rounded-md px-3 py-2 bg-destructive/5">{key}: {msg}</div>
        ))}
        {data && (
          <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
            {data.curves.map((c) => <ChokepointCard key={c.key} curve={c} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function ChokepointCard({ curve }: { curve: ShippingCurve }) {
  const { t } = useTranslation()
  const chartData = curve.points
    .filter((p) => p.tons != null)
    .map((p) => ({ ...p, mt: (p.tons as number) / 1e6, label: p.date.slice(5) }))
  return (
    <div className="border border-border rounded-md bg-secondary/40 px-4 py-3 flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-foreground">{curve.name}</span>
        {curve.latest && (
          <span className="text-[11px] text-muted-foreground">
            {curve.latest.date} · {curve.latest.vessels ?? '—'} {t('market.shippingVessels')} · {curve.latest.tons != null ? (curve.latest.tons / 1e6).toFixed(2) + 'M t' : '—'}
          </span>
        )}
      </div>
      <MeasuredChartFrame className="h-28">
        {({ width, height }) => (
          <LineChart width={width} height={height} data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--chart-axis)' }} stroke="var(--chart-axis)" minTickGap={28} />
            <YAxis tick={{ fontSize: 9, fill: 'var(--chart-axis)' }} stroke="var(--chart-axis)" width={36}
              tickFormatter={(v: number) => v.toFixed(1)} domain={['auto', 'auto']} />
            <Tooltip
              formatter={(v) => [`${Number(v).toFixed(2)}M t`, '']}
              contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', fontSize: 11 }}
            />
            <Line type="monotone" dataKey="mt" stroke="var(--primary)" strokeWidth={1.25} dot={false} isAnimationActive={false} />
          </LineChart>
        )}
      </MeasuredChartFrame>
    </div>
  )
}

// ==================== Fed ====================

function FedBoardView() {
  const { t } = useTranslation()
  const { data, updatedAt, loading, error } = useReferenceBoard<FedBoard>(referenceApi.fed, 60 * 60 * 1000)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('market.boardFed')}
        description={
          <>
            {t('market.fedSubtitle')}
            {data && <BoardMeta meta={data.meta} />}
          </>
        }
        live={{ lastUpdated: updatedAt }}
      />
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 flex flex-col gap-5 min-h-0">
        {loading && !data && <CenteredLoading label={t('common.loading')} />}
        {error && (
          <div className="text-[13px] text-destructive border border-destructive/30 rounded-md px-3 py-2 bg-destructive/5">{error}</div>
        )}
        {data?.errors && Object.entries(data.errors).map(([k, msg]) => (
          <div key={k} className="text-[13px] text-destructive border border-destructive/30 rounded-md px-3 py-2 bg-destructive/5">{k}: {msg}</div>
        ))}
        {data && data.cards.length > 0 && (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {data.cards.map((c) => {
              const labelKey = FED_LABEL_KEYS[c.id as keyof typeof FED_LABEL_KEYS]
              return (
                <SeriesCard key={c.id} card={c} label={labelKey ? t(labelKey) : c.label} emptyText={t('market.noMatches')} />
              )
            })}
          </div>
        )}
        {data && data.documents.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">{t('market.fedDocuments')}</h3>
            {data.documents.map((d) => (
              <a
                key={`${d.type}-${d.date}`}
                href={d.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 px-3 py-1.5 rounded-md border border-border/60 bg-secondary/30 hover:bg-secondary text-[12px]"
              >
                <span className="font-mono text-muted-foreground shrink-0">{d.date}</span>
                <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0 ${
                  d.type === 'statement' ? 'bg-primary/15 text-primary'
                  : d.type === 'minutes' ? 'bg-success/15 text-success'
                  : 'bg-muted text-muted-foreground'
                }`}>{d.type}</span>
                <span className="text-foreground truncate">{d.title}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const FED_LABEL_KEYS = {
  WALCL: 'market.fedTotalAssets',
  TREAST: 'market.fedTreasuries',
  WSHOMCB: 'market.fedMbs',
  PD_NET: 'market.fedDealerNet',
  PD_UST: 'market.fedDealerTreasuries',
} as const

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
  if (x == null) return 'text-muted-foreground'
  return x > 0 ? 'text-success' : x < 0 ? 'text-destructive' : 'text-muted-foreground'
}
function rvolColor(x: number | null): string {
  if (x == null) return 'text-muted-foreground'
  return x >= 2 ? 'text-warning font-semibold' : 'text-foreground'
}
