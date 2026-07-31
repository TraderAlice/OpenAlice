import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { LineChart, Line, YAxis, XAxis, Tooltip } from 'recharts'
import { Search } from 'lucide-react'
import { useReferenceBoard } from '../components/market/useReferenceBoard'
import { BoardMeta } from '../components/market/BoardMeta'
import { PageHeader } from '../components/PageHeader'
import { CenteredLoading } from '../components/StateViews'
import { SeriesCard } from '../components/market/SeriesCard'
import { MeasuredChartFrame } from '../components/MeasuredChartFrame'
import {
  referenceApi,
  type MoversBoard, type MoverRow, type ReferenceMeta, type CalendarBoard,
  type EarningsEvent, type IpoEvent, type DividendEvent,
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
        <div
          className="flex flex-wrap items-center gap-1"
          role="group"
          aria-label={t('market.boardMovers')}
        >
          {(['gainers', 'losers', 'active', 'undervaluedGrowth', 'growthTech', 'smallCaps', 'undervaluedLarge'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setList(k)}
              aria-pressed={list === k}
              className={`shrink-0 whitespace-nowrap px-3 py-1 rounded-md text-[12px] font-medium transition-colors ${
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
  const open = useOpenEquity()
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full table-fixed md:table-auto text-[12px] border-collapse">
        <thead>
          <tr className="text-muted-foreground/70 text-left border-b border-border">
            <th className="w-1/2 md:w-auto py-1.5 pr-2 md:pr-3 font-medium">{t('market.colSymbol')}</th>
            <th className="w-1/4 md:w-auto py-1.5 px-1.5 md:px-3 font-medium text-right">{t('market.colPrice')}</th>
            <th className="w-1/4 md:w-auto py-1.5 pl-1.5 md:px-3 font-medium text-right">{t('market.colChangePct')}</th>
            <th className="hidden md:table-cell py-1.5 px-3 font-medium text-right">{t('market.colVolume')}</th>
            <th className="hidden md:table-cell py-1.5 px-3 font-medium text-right">{t('market.colRvol')}</th>
            <th className="hidden md:table-cell py-1.5 pl-3 font-medium text-right">{t('market.colDollarVolume')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.symbol}
              className="border-b border-border/50 hover:bg-secondary/40 cursor-pointer"
              onClick={() => open(r.symbol)}
            >
              <td className="min-w-0 py-1.5 pr-2 md:pr-3">
                <EquityDetailButton symbol={r.symbol} name={r.name} />
              </td>
              <td className="py-1.5 px-1.5 md:px-3 text-right font-mono text-foreground">{fmtPrice(r.price)}</td>
              <td className={`py-1.5 pl-1.5 md:px-3 text-right font-mono ${signColor(r.percent_change)}`}>{fmtPct(r.percent_change)}</td>
              <td className="hidden md:table-cell py-1.5 px-3 text-right text-foreground">{fmtCompact(r.volume)}</td>
              <td className={`hidden md:table-cell py-1.5 px-3 text-right ${rvolColor(r.relative_volume)}`}>{r.relative_volume?.toFixed(2) ?? '—'}</td>
              <td className="hidden md:table-cell py-1.5 pl-3 text-right text-foreground">{fmtCompact(r.dollar_volume, '$')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ==================== Calendar ====================

type CalendarList = 'earnings' | 'ipos' | 'dividends'
const CALENDAR_PAGE_SIZE = 50

function CalendarBoardView() {
  const { t } = useTranslation()
  const { data, updatedAt, loading, slow, error, retry } = useReferenceBoard<CalendarBoard>(referenceApi.calendar, 30 * 60 * 1000)
  const [list, setList] = useState<CalendarList>('earnings')
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(CALENDAR_PAGE_SIZE)
  const sortedRows = useMemo(() => ({
    earnings: data ? [...data.earnings].sort((a, b) => a.report_date.localeCompare(b.report_date)) : [],
    ipos: data ? [...data.ipos].sort((a, b) => (a.ipo_date ?? '').localeCompare(b.ipo_date ?? '')) : [],
    dividends: data ? [...data.dividends].sort((a, b) => a.ex_dividend_date.localeCompare(b.ex_dividend_date)) : [],
  }), [data])
  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return sortedRows
    const includesQuery = (...parts: unknown[]) =>
      parts.some((part) => String(part ?? '').toLocaleLowerCase().includes(normalized))
    return {
      earnings: sortedRows.earnings.filter((row) =>
        includesQuery(row.report_date, row.symbol, row.name)),
      ipos: sortedRows.ipos.filter((row) =>
        includesQuery(row.ipo_date, row.symbol, row.name, row.exchange)),
      dividends: sortedRows.dividends.filter((row) =>
        includesQuery(row.ex_dividend_date, row.payment_date, row.symbol, row.name)),
    }
  }, [query, sortedRows])
  const activeRows = filteredRows[list]
  const activeVisibleCount = Math.min(visibleCount, activeRows.length)

  useEffect(() => {
    setVisibleCount(CALENDAR_PAGE_SIZE)
  }, [list, query])

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
        <div
          className="grid grid-cols-3 gap-1 rounded-lg bg-secondary/50 p-1"
          role="group"
          aria-label={t('market.boardCalendar')}
        >
          {(['earnings', 'ipos', 'dividends'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setList(k)}
              aria-pressed={list === k}
              aria-label={`${t(calendarLabelKey(k))} (${data?.[k].length ?? 0})`}
              className={`oa-pressable flex min-h-11 min-w-0 flex-col items-center justify-center rounded-md px-2 py-1 text-[12px] font-medium transition-colors sm:flex-row sm:gap-1.5 ${
                list === k
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              <span className="truncate">{t(calendarLabelKey(k))}</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {data?.[k].length ?? 0}
              </span>
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

        {data && data[list].length > 0 && !data.errors?.[list] && (
          <div className="space-y-2">
            <label htmlFor="market-calendar-search" className="sr-only">
              {t('market.calendarSearch')}
            </label>
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60"
              />
              <input
                id="market-calendar-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('market.calendarSearchPlaceholder')}
                className="min-h-11 w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60"
              />
            </div>
            {activeRows.length > 0 && (
              <div className="text-[11px] text-muted-foreground">
                {t('market.calendarShowing', {
                  visible: activeVisibleCount,
                  total: activeRows.length,
                })}
              </div>
            )}
          </div>
        )}

        {data && activeRows.length === 0 && !loading && !data.errors?.[list] && (
          <div className="text-[13px] text-muted-foreground">{t('market.noMatches')}</div>
        )}
        {data && list === 'earnings' && filteredRows.earnings.length > 0 && (
          <EarningsTable rows={filteredRows.earnings.slice(0, visibleCount)} />
        )}
        {data && list === 'ipos' && filteredRows.ipos.length > 0 && (
          <IpoTable rows={filteredRows.ipos.slice(0, visibleCount)} />
        )}
        {data && list === 'dividends' && filteredRows.dividends.length > 0 && (
          <DividendTable rows={filteredRows.dividends.slice(0, visibleCount)} />
        )}
        {activeVisibleCount < activeRows.length && (
          <button
            type="button"
            onClick={() => setVisibleCount((count) => count + CALENDAR_PAGE_SIZE)}
            className="oa-pressable min-h-11 w-full rounded-lg border border-border bg-secondary/50 px-4 py-2 text-[12px] font-medium text-foreground hover:border-primary/40 hover:bg-secondary"
          >
            {t('market.calendarShowMore', {
              count: Math.min(CALENDAR_PAGE_SIZE, activeRows.length - activeVisibleCount),
            })}
          </button>
        )}
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

function EquityDetailButton({
  symbol,
  name,
}: {
  symbol: string | null
  name?: string | null
}) {
  const { t } = useTranslation()
  const open = useOpenEquity()

  if (!symbol) return <span className="font-mono text-muted-foreground">—</span>

  return (
    <button
      type="button"
      aria-label={t('market.openSymbol', { symbol })}
      onClick={(event) => {
        event.stopPropagation()
        open(symbol)
      }}
      className="inline-flex max-w-full items-baseline gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      <span className="shrink-0 font-mono font-semibold text-foreground">{symbol}</span>
      {name && <span className="min-w-0 truncate text-muted-foreground">{name}</span>}
    </button>
  )
}

function EarningsTable({ rows }: { rows: EarningsEvent[] }) {
  const { t } = useTranslation()
  const open = useOpenEquity()
  return (
    <>
      <CalendarMobileList
        rows={rows}
        date={(row) => row.report_date}
        symbol={(row) => row.symbol}
        name={(row) => row.name}
        metrics={(row) => [
          { label: t('market.colEpsPrev'), value: row.eps_previous ?? '—' },
          { label: t('market.colEpsEst'), value: row.eps_consensus ?? '—' },
        ]}
      />
      <CalTable head={[t('market.colDate'), t('market.colSymbol'), t('market.colEpsPrev'), t('market.colEpsEst')]} rightCols={[2, 3]}>
        {rows.map((r, i) => (
          <tr key={`${r.symbol}-${i}`} className="border-b border-border/50 hover:bg-secondary/40 cursor-pointer" onClick={() => open(r.symbol)}>
            <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{r.report_date}</td>
            <td className="py-1.5 px-3">
              <EquityDetailButton symbol={r.symbol} name={r.name} />
            </td>
            <td className="py-1.5 px-3 text-right font-mono text-foreground">{r.eps_previous ?? '—'}</td>
            <td className="py-1.5 pl-3 text-right font-mono text-foreground">{r.eps_consensus ?? '—'}</td>
          </tr>
        ))}
      </CalTable>
    </>
  )
}

function IpoTable({ rows }: { rows: IpoEvent[] }) {
  const { t } = useTranslation()
  const open = useOpenEquity()
  return (
    <>
      <CalendarMobileList
        rows={rows}
        date={(row) => row.ipo_date ?? '—'}
        symbol={(row) => typeof row.symbol === 'string' ? row.symbol : null}
        name={(row) => typeof row.name === 'string' ? row.name : null}
        metrics={(row) => [{
          label: t('market.colExchange'),
          value: typeof row.exchange === 'string' ? row.exchange : '—',
        }]}
      />
      <CalTable head={[t('market.colDate'), t('market.colSymbol'), t('market.colExchange')]}>
        {rows.map((r, i) => {
          const symbol = typeof r.symbol === 'string' ? r.symbol : null
          const name = typeof r.name === 'string' ? r.name : null
          return (
            <tr
              key={`${r.symbol}-${i}`}
              className={`border-b border-border/50 hover:bg-secondary/40 ${symbol ? 'cursor-pointer' : ''}`}
              onClick={symbol ? () => open(symbol) : undefined}
            >
              <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{r.ipo_date ?? '—'}</td>
              <td className="py-1.5 px-3">
                <EquityDetailButton symbol={symbol} name={name} />
              </td>
              <td className="py-1.5 pl-3 text-muted-foreground">{typeof r.exchange === 'string' ? r.exchange : '—'}</td>
            </tr>
          )
        })}
      </CalTable>
    </>
  )
}

function DividendTable({ rows }: { rows: DividendEvent[] }) {
  const { t } = useTranslation()
  const open = useOpenEquity()
  return (
    <>
      <CalendarMobileList
        rows={rows}
        date={(row) => row.ex_dividend_date}
        symbol={(row) => row.symbol}
        name={(row) => row.name}
        metrics={(row) => [
          { label: t('market.colDivAmount'), value: row.amount ?? '—' },
          { label: t('market.colPayDate'), value: row.payment_date ?? '—' },
        ]}
      />
      <CalTable head={[t('market.colExDate'), t('market.colSymbol'), t('market.colDivAmount'), t('market.colPayDate')]} rightCols={[2]}>
        {rows.map((r, i) => (
          <tr key={`${r.symbol}-${i}`} className="border-b border-border/50 hover:bg-secondary/40 cursor-pointer" onClick={() => open(r.symbol)}>
            <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{r.ex_dividend_date}</td>
            <td className="py-1.5 px-3">
              <EquityDetailButton symbol={r.symbol} name={r.name} />
            </td>
            <td className="py-1.5 px-3 text-right font-mono text-foreground">{r.amount ?? '—'}</td>
            <td className="py-1.5 pl-3 text-muted-foreground whitespace-nowrap">{r.payment_date ?? '—'}</td>
          </tr>
        ))}
      </CalTable>
    </>
  )
}

function CalTable({ head, rightCols = [], children }: { head: string[]; rightCols?: number[]; children: React.ReactNode }) {
  return (
    <div data-testid="calendar-desktop" className="hidden overflow-x-auto md:block">
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

function CalendarMobileList<T>({
  rows,
  date,
  symbol,
  name,
  metrics,
}: {
  rows: T[]
  date: (row: T) => string
  symbol: (row: T) => string | null
  name: (row: T) => string | null
  metrics: (row: T) => Array<{ label: string; value: ReactNode }>
}) {
  const { t } = useTranslation()
  const open = useOpenEquity()
  const groups = useMemo(() => {
    const next: Array<{ date: string; rows: Array<{ row: T; index: number }> }> = []
    rows.forEach((row, index) => {
      const rowDate = date(row)
      const current = next.at(-1)
      if (current?.date === rowDate) current.rows.push({ row, index })
      else next.push({ date: rowDate, rows: [{ row, index }] })
    })
    return next
  }, [date, rows])

  return (
    <div data-testid="calendar-mobile" className="space-y-4 md:hidden">
      {groups.map((group) => (
        <section key={group.date} className="space-y-1.5">
          <div className="border-b border-border/70 pb-1 text-[11px] font-medium text-muted-foreground">
            {group.date}
          </div>
          <div className="overflow-hidden rounded-lg border border-border/70 bg-secondary/25">
            {group.rows.map(({ row, index }) => {
              const rowSymbol = symbol(row)
              const rowName = name(row)
              const content = (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[13px] font-semibold text-foreground">
                      {rowSymbol ?? '—'}
                    </div>
                    {rowName && (
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {rowName}
                      </div>
                    )}
                  </div>
                  <dl className="grid shrink-0 grid-cols-2 gap-x-3 text-right">
                    {metrics(row).map((metric) => (
                      <div key={metric.label}>
                        <dt className="text-[9px] uppercase tracking-wide text-muted-foreground/70">
                          {metric.label}
                        </dt>
                        <dd className="mt-0.5 whitespace-nowrap font-mono text-[11px] text-foreground">
                          {metric.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </>
              )
              const className = 'oa-pressable flex min-h-14 w-full min-w-0 items-center gap-3 border-b border-border/50 px-3 py-2 text-left last:border-b-0'
              return rowSymbol ? (
                <button
                  key={`${rowSymbol}-${index}`}
                  type="button"
                  aria-label={t('market.openSymbol', { symbol: rowSymbol })}
                  onClick={() => open(rowSymbol)}
                  className={`${className} hover:bg-secondary/60`}
                >
                  {content}
                </button>
              ) : (
                <div key={`unknown-${index}`} className={className}>
                  {content}
                </div>
              )
            })}
          </div>
        </section>
      ))}
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
    <div className="border border-border rounded-md bg-secondary/40 px-3 sm:px-4 py-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="shrink-0 text-[15px] font-semibold font-mono text-foreground">{curve.symbol}</span>
        {curve.spot != null && (
          <span className="whitespace-nowrap text-[12px] text-muted-foreground">{t('market.termSpotPerp')} <span className="font-mono text-foreground">{curve.spot.toLocaleString('en-US')}</span></span>
        )}
        {regime && <span className="whitespace-nowrap text-[11px] uppercase tracking-wide text-muted-foreground/70">{regime}</span>}
      </div>
      <MeasuredChartFrame className="h-40">
        {({ width, height }) => {
          const compact = width < 420
          return (
            <LineChart width={width} height={height} data={chartData} margin={{ top: 8, right: compact ? 8 : 16, bottom: 0, left: 0 }}>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: 'var(--chart-axis)' }}
                stroke="var(--chart-axis)"
                interval="preserveStartEnd"
                minTickGap={compact ? 18 : 28}
                tickFormatter={(label: string) => formatTermAxisLabel(label, width)}
              />
              <YAxis
                domain={['dataMin', 'dataMax']}
                tick={{ fontSize: 10, fill: 'var(--chart-axis)' }}
                stroke="var(--chart-axis)"
                width={compact ? 48 : 70}
                tickFormatter={(value: number) => formatTermAxisPrice(value, width)}
              />
              <Tooltip
                formatter={(v) => [Number(v).toLocaleString('en-US'), '']}
                labelFormatter={(l) => `20${l}`}
                contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', fontSize: 11 }}
              />
              <Line type="monotone" dataKey="price" stroke="var(--primary)" strokeWidth={1.5} dot={{ r: 2.5 }} isAnimationActive={false} />
            </LineChart>
          )
        }}
      </MeasuredChartFrame>
      <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap">
        {curve.points.map((p) => (
          <span key={p.expiration} className="flex items-center justify-between gap-2 whitespace-nowrap text-[11px] px-1.5 py-0.5 rounded bg-muted/60 font-mono" title={`${p.daysToExpiry ?? '—'}d`}>
            {p.expiration.slice(2)}{' '}
            <span className={p.annualizedBasis == null ? 'text-muted-foreground' : p.annualizedBasis >= 0 ? 'text-success' : 'text-destructive'}>
              {p.annualizedBasis == null ? '—' : `${p.annualizedBasis >= 0 ? '+' : ''}${p.annualizedBasis.toFixed(1)}%`}
            </span>
          </span>
        ))}
        {curve.points.length > 0 && (
          <span className="col-span-2 text-[10px] text-muted-foreground/60 self-center sm:ml-1">{t('market.termBasisNote')}</span>
        )}
      </div>
    </div>
  )
}

export function formatTermAxisLabel(label: string, chartWidth: number) {
  return chartWidth < 420 ? label.slice(-5) : label
}

export function formatTermAxisPrice(value: number, chartWidth: number) {
  if (chartWidth >= 420) return value.toLocaleString('en-US')
  return Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
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
          <>
            <div
              data-testid="global-macro-mobile"
              className="divide-y divide-border/60 border-y border-border/70 md:hidden"
            >
              {data.rows.map((r) => (
                <article key={r.country} className="py-3">
                  <h3 className="truncate text-[13px] font-semibold text-foreground">{r.label}</h3>
                  <dl className="mt-2 grid grid-cols-3 gap-x-3">
                    <GlobalMetric
                      label={t('market.colCpiYoy')}
                      cell={r.cpiYoy}
                      fmt={(v) => `${v.toFixed(2)}%`}
                      colorBy="cpi"
                    />
                    <GlobalMetric
                      label={t('market.colShortRate')}
                      cell={r.shortRate}
                      fmt={(v) => `${v.toFixed(2)}%`}
                    />
                    <GlobalMetric
                      label={t('market.colCli')}
                      cell={r.cli}
                      fmt={(v) => v.toFixed(1)}
                      colorBy="cli"
                    />
                  </dl>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 border-t border-border/40 pt-2">
                    <GlobalMetric
                      label={t('market.colHousePrice')}
                      cell={r.housePrice}
                      fmt={(v) => v.toFixed(1)}
                    />
                    <GlobalMetric
                      label={t('market.colSharePrice')}
                      cell={r.sharePrice}
                      fmt={(v) => v.toFixed(1)}
                    />
                  </dl>
                </article>
              ))}
            </div>

            <div data-testid="global-macro-desktop" className="hidden overflow-x-auto md:block">
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
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground/60">{t('market.globalMacroNote')}</p>
          </>
        )}
      </div>
    </div>
  )
}

type GlobalCellColor = 'cpi' | 'cli'

function globalCellColor(cell: GlobalMacroCell, colorBy?: GlobalCellColor): string {
  if (cell.value == null) return 'text-muted-foreground/50'
  if (colorBy === 'cpi') {
    return cell.value >= 4 ? 'text-destructive' : cell.value <= 1 ? 'text-muted-foreground' : 'text-foreground'
  }
  if (colorBy === 'cli') return cell.value >= 100 ? 'text-success' : 'text-destructive'
  return 'text-foreground'
}

function globalCellTitle(cell: GlobalMacroCell): string {
  return cell.value == null ? cell.error ?? 'no data' : cell.date ?? ''
}

function GlobalMetric({
  label,
  cell,
  fmt,
  colorBy,
}: {
  label: string
  cell: GlobalMacroCell
  fmt: (v: number) => string
  colorBy?: GlobalCellColor
}) {
  const value = cell.value == null ? '—' : fmt(cell.value)
  const title = globalCellTitle(cell)
  return (
    <div className="min-w-0" title={title}>
      <dt className="min-h-8 text-[10px] leading-4 text-muted-foreground">{label}</dt>
      <dd
        className={`truncate font-mono text-[13px] font-medium tabular-nums ${globalCellColor(cell, colorBy)}`}
        aria-label={`${label}: ${value}${title ? ` · ${title}` : ''}`}
      >
        {value}
      </dd>
    </div>
  )
}

function GlobalCell({ cell, fmt, colorBy }: { cell: GlobalMacroCell; fmt: (v: number) => string; colorBy?: GlobalCellColor }) {
  if (cell.value == null) {
    return <td className="py-1.5 px-3 text-right text-muted-foreground/50" title={globalCellTitle(cell)}>—</td>
  }
  return (
    <td className={`py-1.5 px-3 text-right font-mono ${globalCellColor(cell, colorBy)}`} title={globalCellTitle(cell)}>
      {fmt(cell.value)}
    </td>
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
    <div className="border border-border rounded-md bg-secondary/40 px-3 sm:px-4 py-3 flex flex-col gap-1.5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
        <span className="text-[13px] font-semibold text-foreground sm:shrink-0">{curve.name}</span>
        {curve.latest && (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground sm:justify-end">
            <span className="whitespace-nowrap">{curve.latest.date}</span>
            <span className="whitespace-nowrap">{curve.latest.vessels ?? '—'} {t('market.shippingVessels')}</span>
            <span className="whitespace-nowrap">{curve.latest.tons != null ? (curve.latest.tons / 1e6).toFixed(2) + 'M t' : '—'}</span>
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
