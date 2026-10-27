import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { LineChart, Line, YAxis, XAxis, Tooltip, ReferenceLine } from 'recharts'
import { ArrowDown, ArrowUp, ArrowUpDown, RefreshCw, Search } from 'lucide-react'
import { compareNumbers, type SortDirection } from '../lib/compare-numbers'
import { useReferenceBoard } from '../components/market/useReferenceBoard'
import { BoardMeta } from '../components/market/BoardMeta'
import { GlobalMacroMap, macroCellAtPeriod, macroCountryName } from '../components/market/GlobalMacroMap'
import { PageHeader } from '../components/PageHeader'
import { CenteredLoading } from '../components/StateViews'
import { Button } from '../components/ui/button'
import { inputClass } from '../components/form'
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
import { newsCountryCode } from '../../../src/domain/market-data/reference/countries'

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
const MOVER_COLUMNS = [
  { key: 'price', label: 'market.colPrice', className: 'w-1/4 md:w-auto' },
  { key: 'percent_change', label: 'market.colChangePct', className: 'w-1/4 md:w-auto' },
  { key: 'volume', label: 'market.colVolume', className: 'hidden md:table-cell' },
  { key: 'relative_volume', label: 'market.colRvol', className: 'hidden md:table-cell' },
  { key: 'dollar_volume', label: 'market.colDollarVolume', className: 'hidden md:table-cell' },
] as const
type MoverMetric = typeof MOVER_COLUMNS[number]['key']

function MoversBoardView() {
  const { t } = useTranslation()
  const { data, updatedAt, loading, error, retry } = useReferenceBoard<MoversBoard>(referenceApi.movers, REFRESH_MS)
  const [list, setList] = useState<MoversList>('gainers')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ key: MoverMetric; direction: SortDirection } | null>(null)
  const sourceRows = data?.[list] ?? []
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase()
    const matched = sourceRows.filter(row => !query || `${row.symbol} ${row.name ?? ''}`.toLowerCase().includes(query))
    return sort ? matched.sort((a, b) => compareNumbers(a[sort.key], b[sort.key], sort.direction)) : matched
  }, [sourceRows, search, sort])
  const sortBy = (key: MoverMetric) => {
    if (sort?.key !== key) setSort({ key, direction: 'descending' })
    else if (sort.direction === 'descending') setSort({ key, direction: 'ascending' })
    else setSort(null)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('market.boardMovers')}
        right={<Button size="xs" variant="ghost" onClick={retry} disabled={loading} aria-label={t('common.refresh')}><RefreshCw aria-hidden className={`size-3.5 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} /></Button>}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>{t('market.moversSubtitle')}</span>
            {data && <BoardMeta meta={data.meta} />}
            {data?.meta.asOf && <span>{t('market.asOf')} {data.meta.asOf}</span>}
          </span>
        }
        live={{ lastUpdated: updatedAt, label: 'Fetched', hideDot: true }}
      />
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 flex flex-col gap-4 min-h-0">
        <div
          className="flex flex-wrap items-center gap-1"
          role="group"
          aria-label={t('market.boardMovers')}
        >
          {(['gainers', 'losers', 'active', 'undervaluedGrowth', 'growthTech', 'smallCaps', 'undervaluedLarge'] as const).map((k) => (
            <Button
              key={k}
              type="button"
              onClick={() => setList(k)}
              aria-pressed={list === k}
              className="shrink-0 whitespace-nowrap text-[12px]"
              variant={list === k ? 'secondary' : 'ghost'}
              size="sm"
            >
              {t(listLabelKey(k))}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <label className="flex min-w-0 basis-full items-center gap-2 whitespace-nowrap sm:basis-0 sm:flex-1">{t('market.moversSearch')}
            <input className={`${inputClass} h-8 min-w-20 flex-1 text-xs`} value={search} onChange={event => setSearch(event.target.value)} />
          </label>
          <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">{t('market.sortBy')}
            <select className={`${inputClass} h-8 w-auto text-xs`} value={sort?.key ?? ''} onChange={event => {
              const column = MOVER_COLUMNS.find(item => item.key === event.target.value)
              setSort(column ? { key: column.key, direction: 'descending' } : null)
            }}>
              <option value="">{t('market.defaultOrder')}</option>
              {MOVER_COLUMNS.map(column => <option key={column.key} value={column.key}>{t(column.label)}</option>)}
            </select>
          </label>
          {sort && <Button size="icon-sm" variant="ghost" aria-label={t(sort.direction === 'descending' ? 'market.sortAscending' : 'market.sortDescending')} onClick={() => setSort({ ...sort, direction: sort.direction === 'descending' ? 'ascending' : 'descending' })}><ArrowUpDown className="size-3.5" aria-hidden /></Button>}
          {data && <span className="tabular-nums">{t('market.listMatches', { count: rows.length, total: sourceRows.length })}</span>}
        </div>

        {loading && !data && <CenteredLoading label={t('common.loading')} />}
        {error && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] leading-5 text-destructive"><span>{error}</span><Button size="xs" variant="ghost" onClick={retry}>{t('common.retry')}</Button></div>
        )}
        {data && rows.length === 0 && !loading && (
          <div className="text-[13px] text-muted-foreground">{t('market.noMatches')}</div>
        )}
        {rows.length > 0 && <MoversTable rows={rows} sort={sort} onSort={sortBy} />}
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

function MoversTable({ rows, sort, onSort }: { rows: MoverRow[]; sort: { key: MoverMetric; direction: SortDirection } | null; onSort: (key: MoverMetric) => void }) {
  const { t } = useTranslation()
  const open = useOpenEquity()
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full table-fixed md:table-auto text-[12px] tabular-nums border-collapse">
        <thead>
          <tr className="text-muted-foreground/70 text-left border-b border-border">
            <th className="w-1/2 md:w-auto py-1.5 pr-2 md:pr-3 font-medium">{t('market.colSymbol')}</th>
            {MOVER_COLUMNS.map(column => {
              const direction = sort?.key === column.key ? sort.direction : undefined
              const Icon = direction === 'ascending' ? ArrowUp : direction === 'descending' ? ArrowDown : ArrowUpDown
              return <th key={column.key} scope="col" aria-sort={direction ?? 'none'} className={`${column.className} px-1.5 md:px-3 py-1 font-medium text-right`}>
                <button type="button" onClick={() => onSort(column.key)} className="flex min-h-8 w-full items-center justify-end gap-1 rounded-sm focus-visible:outline-2 focus-visible:outline-ring">{t(column.label)}<Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden /></button>
              </th>
            })}
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
              <td className={`hidden md:table-cell py-1.5 px-3 text-right ${rvolColor(r.relative_volume)}`}>{r.relative_volume != null && Number.isFinite(r.relative_volume) ? r.relative_volume.toFixed(2) : '—'}</td>
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
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>{t('market.calendarSubtitle')}</span>
            {data && <BoardMeta meta={data.meta} extra={`${data.window.start} → ${data.window.end}`} />}
          </span>
        }
        live={{ lastUpdated: updatedAt, label: 'Fetched', hideDot: true }}
      />
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 flex flex-col gap-4 min-h-0">
        <div
          className="grid grid-cols-3 gap-0.5 rounded-lg border border-border/70 bg-muted/60 p-0.5"
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
              className={`oa-pressable flex min-h-11 min-w-0 flex-col items-center justify-center rounded-md px-2 py-1 text-[12px] leading-[18px] font-medium sm:flex-row sm:gap-1.5 ${
                list === k
                  ? 'bg-background text-foreground shadow-sm ring-1 ring-border/60'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              <span className="truncate">{t(calendarLabelKey(k))}</span>
              <span className="font-mono text-[10px] leading-[14px] text-muted-foreground">
                {data?.[k].length ?? 0}
              </span>
            </button>
          ))}
        </div>

        {loading && !data && (
          <CenteredLoading label={slow ? t('market.calendarSlowLoading') : t('common.loading')} />
        )}
        {error && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] leading-5 text-destructive">
            <span className="min-w-0 break-words">{error}</span>
            <Button
              type="button"
              onClick={retry}
              className="shrink-0"
              size="sm"
              variant="destructive"
            >
              {t('common.retry')}
            </Button>
          </div>
        )}
        {/* Per-list upstream failure — loud, with the provider's own message. */}
        {data?.errors?.[list] && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] leading-5 text-destructive">{data.errors[list]}</div>
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
                className={`${inputClass} min-h-11 py-2 pl-9 pr-3`}
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
          <Button
            type="button"
            onClick={() => setVisibleCount((count) => count + CALENDAR_PAGE_SIZE)}
            className="min-h-11 w-full"
            variant="outline"
          >
            {t('market.calendarShowMore', {
              count: Math.min(CALENDAR_PAGE_SIZE, activeRows.length - activeVisibleCount),
            })}
          </Button>
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
      className="inline-flex max-w-full items-baseline gap-2 rounded-sm text-left outline-none focus-visible:[box-shadow:var(--oa-focus-shadow)]"
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
          <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
            {group.rows.map(({ row, index }) => {
              const rowSymbol = symbol(row)
              const rowName = name(row)
              const content = (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[13px] leading-[18px] font-semibold text-foreground">
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
                        <dt className="text-[10px] font-medium text-muted-foreground/70">
                          {metric.label}
                        </dt>
                        <dd className="mt-0.5 whitespace-nowrap font-mono text-[11px] leading-[15px] text-foreground">
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
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>{t('market.macroSubtitle')}</span>
            {data && <BoardMeta meta={data.meta} />}
          </span>
        }
        live={{ lastUpdated: updatedAt, label: 'Fetched', hideDot: true }}
      />
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 min-h-0">
        {loading && !data && <CenteredLoading label={t('common.loading')} />}
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] leading-5 text-destructive">{error}</div>
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
  const { data, updatedAt, loading, error, retry } = useReferenceBoard<TermStructureBoard>(referenceApi.termStructure, 5 * 60 * 1000)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('market.boardTermStructure')}
        right={<Button size="xs" variant="ghost" onClick={retry} disabled={loading} aria-label={t('common.refresh')}><RefreshCw aria-hidden className={`size-3.5 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} /></Button>}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>{t('market.termSubtitle')}</span>
            {data && <BoardMeta meta={data.meta} />}
            {data?.meta.asOf && <span>{t('market.asOf')} {data.meta.asOf}</span>}
          </span>
        }
        live={{ lastUpdated: updatedAt, label: 'Fetched', hideDot: true }}
      />
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 flex flex-col gap-6 min-h-0">
        {loading && !data && <CenteredLoading label={t('common.loading')} />}
        {error && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] leading-5 text-destructive"><span>{error}</span><Button size="xs" variant="ghost" onClick={retry}>{t('common.retry')}</Button></div>
        )}
        {data?.errors && Object.entries(data.errors).map(([sym, msg]) => (
          <div key={sym} role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] leading-5 text-destructive"><span>{sym}: {msg}</span><Button size="xs" variant="ghost" onClick={retry}>{t('common.retry')}</Button></div>
        ))}
        {data && !data.curves.length && <p className="text-xs text-muted-foreground">{t('market.termNoContracts')}</p>}
        {data?.curves.map((curve) => <TermCurveCard key={curve.symbol} curve={curve} />)}
      </div>
    </div>
  )
}

function TermCurveCard({ curve }: { curve: TermCurve }) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'price' | 'basis'>('price')
  const reference = curve.spot != null && Number.isFinite(curve.spot) && curve.spot > 0 ? curve.spot : null
  const basisFor = (point: TermCurve['points'][number]) => reference !== null && point.daysToExpiry != null && point.daysToExpiry >= 7 && point.annualizedBasis != null && Number.isFinite(point.annualizedBasis) ? point.annualizedBasis : null
  const chartData = curve.points
    .map(point => ({ ...point, time: Date.parse(`${point.expiration}T00:00:00Z`), price: point.price != null && Number.isFinite(point.price) ? point.price : null, basis: basisFor(point) }))
    .filter(point => Number.isFinite(point.time))
    .sort((a, b) => a.time - b.time)
  const far = chartData.at(-1)
  const regime = far?.price != null && reference !== null ? t(far.price > reference ? 'market.termFarPremium' : far.price < reference ? 'market.termFarDiscount' : 'market.termFarParity') : null
  const baseline = mode === 'price' ? reference : 0
  const values = chartData.flatMap(point => point[mode] === null ? [] : [point[mode]!])
  const domainValues = baseline !== null ? [...values, baseline] : values
  const lower = domainValues.length ? Math.min(...domainValues) : 0
  const upper = domainValues.length ? Math.max(...domainValues) : 1
  const padding = lower === upper ? Math.abs(lower) * 0.01 || 1 : 0
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="shrink-0 text-[15px] font-semibold font-mono text-foreground">{curve.symbol}</span>
        <span className="whitespace-nowrap text-[12px] text-muted-foreground">{t('market.termSpotPerp')} <span className="font-mono tabular-nums text-foreground">{fmtPrice(reference)}</span></span>
        {regime && <span className="whitespace-nowrap text-[11px] font-medium text-muted-foreground/70">{regime}</span>}
        <div role="group" aria-label={t('market.termMode', { symbol: curve.symbol })} className="ml-auto flex gap-0.5">
          <Button size="xs" variant={mode === 'price' ? 'secondary' : 'ghost'} aria-pressed={mode === 'price'} onClick={() => setMode('price')}>{t('market.termPrice')}</Button>
          <Button size="xs" variant={mode === 'basis' ? 'secondary' : 'ghost'} aria-pressed={mode === 'basis'} onClick={() => setMode('basis')}>{t('market.termBasis')}</Button>
        </div>
      </div>
      {values.length === 0 ? <p role="status" className="flex h-40 items-center justify-center text-xs text-muted-foreground">{t(mode === 'basis' ? 'market.termNoBasis' : 'market.termNoQuotes')}</p> :
      <MeasuredChartFrame className="h-40">
        {({ width, height }) => {
          const compact = width < 420
          return (
            <LineChart accessibilityLayer width={width} height={height} data={chartData} margin={{ top: 8, right: compact ? 8 : 16, bottom: 0, left: 0 }}>
              <XAxis
                dataKey="time" type="number" scale="time" domain={['dataMin', 'dataMax']}
                tick={{ fontSize: 10, fill: 'var(--chart-axis)' }}
                stroke="var(--chart-axis)"
                interval="preserveStartEnd"
                minTickGap={compact ? 18 : 28}
                tickFormatter={(value: number) => formatTermAxisLabel(new Date(value).toISOString().slice(2, 10), width)}
              />
              <YAxis
                domain={[lower - padding, upper + padding]}
                tick={{ fontSize: 10, fill: 'var(--chart-axis)' }}
                stroke="var(--chart-axis)"
                width={compact ? 48 : 70}
                tickFormatter={(value: number) => mode === 'price' ? formatTermAxisPrice(value, width) : `${value.toFixed(1)}%`}
              />
              <Tooltip
                isAnimationActive={false}
                formatter={(value) => [mode === 'price' ? fmtPrice(Number(value)) : fmtBasis(Number(value)), t(mode === 'price' ? 'market.termPrice' : 'market.termBasis')]}
                labelFormatter={(value) => new Date(Number(value)).toISOString().slice(0, 10)}
                separator=""
                cursor={{ strokeDasharray: '3 3' }}
              />
              {baseline !== null && <ReferenceLine y={baseline} stroke="var(--chart-axis)" strokeDasharray="4 4" />}
              <Line
                type="linear"
                dataKey={mode}
                connectNulls={false}
                stroke="var(--primary)"
                strokeWidth={1.5}
                dot={{ r: 2.5 }}
                activeDot={{ r: 4, stroke: 'var(--background)', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          )
        }}
      </MeasuredChartFrame>}
      <details className="min-w-0 border-t border-border/60 pt-1 text-xs">
        <summary className="cursor-pointer rounded-sm py-1 text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">{t('market.termContracts')}</summary>
        <div className="overflow-x-auto">
          <table aria-label={`${curve.symbol} ${t('market.termContracts')}`} className="w-full text-right text-xs tabular-nums">
            <thead><tr className="border-b border-border text-muted-foreground"><th scope="col" className="py-1 text-left font-medium">{t('market.termExpiry')}</th><th scope="col" className="px-2 py-1 font-medium">{t('market.termDays')}</th><th scope="col" className="px-2 py-1 font-medium">{t('market.colPrice')}</th><th scope="col" className="py-1 font-medium">{t('market.termBasis')}</th></tr></thead>
            <tbody>{[...curve.points].sort((a, b) => a.expiration.localeCompare(b.expiration)).map(point => <tr key={point.expiration} className="border-b border-border/40"><td className="whitespace-nowrap py-1.5 text-left">{point.expiration}</td><td className="px-2">{point.daysToExpiry != null && Number.isFinite(point.daysToExpiry) ? point.daysToExpiry : '—'}</td><td className="whitespace-nowrap px-2">{fmtPrice(point.price)}</td><td className={signColor(basisFor(point))}>{fmtBasis(basisFor(point))}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="pt-2 text-[11px] text-muted-foreground">{t('market.termBasisHelp')}</p>
      </details>
    </div>
  )
}

function fmtBasis(value: number | null) {
  return value === null || !Number.isFinite(value) ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
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
  const { t, i18n } = useTranslation()
  const { data, updatedAt, loading, error } = useReferenceBoard<GlobalMacroBoard>(referenceApi.globalMacro, 60 * 60 * 1000)
  const [display, setDisplay] = useState<'map' | 'table'>('map')
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null)
  const [period, setPeriod] = useState<string | null>(null)
  const openOrFocus = useWorkspace(state => state.openOrFocus)
  const locale = i18n.resolvedLanguage ?? i18n.language
  const rows = data?.rows.map(row => period ? {
    ...row,
    cpiYoy: macroCellAtPeriod(row.cpiYoy, period),
    shortRate: macroCellAtPeriod(row.shortRate, period),
    cli: macroCellAtPeriod(row.cli, period),
    housePrice: macroCellAtPeriod(row.housePrice, period),
    sharePrice: macroCellAtPeriod(row.sharePrice, period),
  } : row) ?? []
  const selectedRow = rows.find(row => row.country === selectedCountry)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('market.boardGlobalMacro')}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>{t('market.globalMacroSubtitle')}</span>
            {data && <BoardMeta meta={data.meta} />}
          </span>
        }
        live={{ lastUpdated: updatedAt, label: 'Fetched', hideDot: true }}
      />
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 min-h-0">
        {loading && !data && <CenteredLoading label={t('common.loading')} />}
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] leading-5 text-destructive">{error}</div>
        )}
        {data && (
          <>
            <div role="group" aria-label={t('market.macroDisplay')} className="mb-4 flex gap-1">
              <Button variant={display === 'map' ? 'secondary' : 'ghost'} size="sm" aria-pressed={display === 'map'} onClick={() => setDisplay('map')}>{t('market.mapView')}</Button>
              <Button variant={display === 'table' ? 'secondary' : 'ghost'} size="sm" aria-pressed={display === 'table'} onClick={() => setDisplay('table')}>{t('market.tableView')}</Button>
            </div>
            {data.historyError && <p className="mb-3 text-xs text-muted-foreground" title={data.historyError}>{t('market.mapHistoryError')}</p>}
            <div hidden={display !== 'map'}><GlobalMacroMap rows={data.rows} selectedCountry={selectedCountry} onSelectCountry={setSelectedCountry} onPeriodChange={setPeriod} /></div>
            {display === 'table' && <>
            <div
              data-testid="global-macro-mobile"
              className="divide-y divide-border/60 border-y border-border/70 md:hidden"
            >
              {rows.map((r) => (
                <article key={r.country} className="py-3">
                  <h3 className="truncate text-[13px] leading-[18px] font-semibold text-foreground">{macroCountryName(r, locale)}</h3>
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
                  {rows.map((r) => (
                    <tr key={r.country} className="border-b border-border/50 hover:bg-secondary/40">
                      <td className="py-1.5 pr-3 text-foreground font-medium">{macroCountryName(r, locale)}</td>
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
            </>}
            {selectedRow && <section role="region" aria-label={macroCountryName(selectedRow, locale)} className="mt-5 border-t border-border pt-4">
              <h3 className="text-sm font-semibold" aria-live="polite">{macroCountryName(selectedRow, locale)}</h3>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
                <GlobalMetric label={t('market.colCpiYoy')} cell={selectedRow.cpiYoy} fmt={value => `${value.toFixed(2)}%`} colorBy="cpi" />
                <GlobalMetric label={t('market.colShortRate')} cell={selectedRow.shortRate} fmt={value => `${value.toFixed(2)}%`} />
                <GlobalMetric label={t('market.colCli')} cell={selectedRow.cli} fmt={value => value.toFixed(1)} colorBy="cli" />
                <GlobalMetric label={t('market.colHousePrice')} cell={selectedRow.housePrice} fmt={value => value.toFixed(1)} />
                <GlobalMetric label={t('market.colSharePrice')} cell={selectedRow.sharePrice} fmt={value => value.toFixed(1)} />
              </dl>
              <Button variant="link" size="sm" className="mt-3 px-0" onClick={() => openOrFocus({ kind: 'news', params: { view: 'events', ...(newsCountryCode(selectedRow.country) ? { country: newsCountryCode(selectedRow.country) } : { keyword: macroCountryName(selectedRow, locale) }) } })}>{t('market.mapSearchNews')}</Button>
            </section>}
            {display === 'table' && <p className="mt-2 text-[10px] text-muted-foreground/60">{t('market.globalMacroNote')}</p>}
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
  const { t } = useTranslation()
  const value = cell.value == null ? '—' : fmt(cell.value)
  const title = globalCellTitle(cell)
  return (
    <div className="min-w-0" title={title}>
      <dt className="min-h-8 text-[10px] leading-4 text-muted-foreground">{label}</dt>
      <dd
        className={`truncate font-mono text-[13px] leading-[18px] font-medium tabular-nums ${globalCellColor(cell, colorBy)}`}
        aria-label={`${label}: ${value}${title ? `, ${title}` : ''}`}
      >
        <span>{value}</span>
        {cell.value != null && <span className="mt-1 block font-sans text-[10px] leading-4 text-muted-foreground">{cell.date || t('market.observationUnknown')}</span>}
      </dd>
    </div>
  )
}

function GlobalCell({ cell, fmt, colorBy }: { cell: GlobalMacroCell; fmt: (v: number) => string; colorBy?: GlobalCellColor }) {
  const { t } = useTranslation()
  if (cell.value == null) {
    return <td className="py-1.5 px-3 text-right text-muted-foreground/50" title={globalCellTitle(cell)}>—</td>
  }
  return (
    <td className={`py-1.5 px-3 text-right font-mono ${globalCellColor(cell, colorBy)}`} title={globalCellTitle(cell)}>
      <span className="block">{fmt(cell.value)}</span>
      <span className="block font-sans text-[10px] leading-4 text-muted-foreground">{cell.date || t('market.observationUnknown')}</span>
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
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>{t('market.shippingSubtitle')}</span>
            {data && <BoardMeta meta={data.meta} />}
          </span>
        }
        live={{ lastUpdated: updatedAt, label: 'Fetched', hideDot: true }}
      />
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 min-h-0">
        {loading && !data && <CenteredLoading label={t('common.loading')} />}
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] leading-5 text-destructive">{error}</div>
        )}
        {data?.errors && Object.entries(data.errors).map(([key, msg]) => (
          <div key={key} className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] leading-5 text-destructive">{key}: {msg}</div>
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
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-3 sm:px-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
        <span className="text-[13px] leading-[18px] font-semibold text-foreground sm:shrink-0">{curve.name}</span>
        {curve.latest && (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-[15px] text-muted-foreground sm:justify-end">
            <span className="whitespace-nowrap">{curve.latest.date}</span>
            <span className="whitespace-nowrap">{curve.latest.vessels ?? '—'} {t('market.shippingVessels')}</span>
            <span className="whitespace-nowrap">{curve.latest.tons != null ? (curve.latest.tons / 1e6).toFixed(2) + 'M t' : '—'}</span>
          </span>
        )}
      </div>
      <MeasuredChartFrame className="h-28">
        {({ width, height }) => (
          <LineChart accessibilityLayer width={width} height={height} data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--chart-axis)' }} stroke="var(--chart-axis)" minTickGap={28} />
            <YAxis tick={{ fontSize: 9, fill: 'var(--chart-axis)' }} stroke="var(--chart-axis)" width={36}
              tickFormatter={(v: number) => v.toFixed(1)} domain={['auto', 'auto']} />
            <Tooltip
              isAnimationActive={false}
              formatter={(v) => [`${Number(v).toFixed(2)}M t`, '']}
              separator=""
              cursor={{ strokeDasharray: '3 3' }}
            />
            <Line
              type="monotone"
              dataKey="mt"
              stroke="var(--primary)"
              strokeWidth={1.25}
              dot={false}
              activeDot={{ r: 4, stroke: 'var(--background)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
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
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>{t('market.fedSubtitle')}</span>
            {data && <BoardMeta meta={data.meta} />}
          </span>
        }
        live={{ lastUpdated: updatedAt, label: 'Fetched', hideDot: true }}
      />
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 flex flex-col gap-5 min-h-0">
        {loading && !data && <CenteredLoading label={t('common.loading')} />}
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] leading-5 text-destructive">{error}</div>
        )}
        {data?.errors && Object.entries(data.errors).map(([k, msg]) => (
          <div key={k} className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] leading-5 text-destructive">{k}: {msg}</div>
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
            <h3 className="text-[12px] leading-[18px] font-semibold text-muted-foreground">{t('market.fedDocuments')}</h3>
            {data.documents.map((d) => (
              <a
                key={`${d.type}-${d.date}`}
                href={d.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-1.5 text-[12px] leading-[18px] hover:bg-secondary"
              >
                <span className="font-mono text-muted-foreground shrink-0">{d.date}</span>
                <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] leading-[14px] font-medium ${
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
  return x == null || !Number.isFinite(x) ? '—' : x.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
function fmtPct(x: number | null): string {
  // percent_change is normalized to a fraction in the provider (0.052 = +5.2%).
  return x == null || !Number.isFinite(x) ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(2)}%`
}
function fmtCompact(x: number | null, prefix = ''): string {
  if (x == null || !Number.isFinite(x)) return '—'
  const abs = Math.abs(x)
  if (abs >= 1e12) return `${prefix}${(x / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${prefix}${(x / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${prefix}${(x / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${prefix}${(x / 1e3).toFixed(1)}K`
  return `${prefix}${x.toFixed(0)}`
}
function signColor(x: number | null): string {
  if (x == null || !Number.isFinite(x)) return 'text-muted-foreground'
  return x > 0 ? 'text-success' : x < 0 ? 'text-destructive' : 'text-muted-foreground'
}
function rvolColor(x: number | null): string {
  if (x == null || !Number.isFinite(x)) return 'text-muted-foreground'
  return x >= 2 ? 'text-warning font-semibold' : 'text-foreground'
}
