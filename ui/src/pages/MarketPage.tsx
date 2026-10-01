import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, ArrowUpRight, CalendarDays, Globe2, Landmark, TrendingUp } from 'lucide-react'
import { BoardMeta } from '../components/market/BoardMeta'
import { ContextHelp } from '../components/ContextHelp'
import { PageHeader } from '../components/PageHeader'
import { SearchBox } from '../components/market/SearchBox'
import { SeriesCard } from '../components/market/SeriesCard'
import { Skeleton } from '../components/StateViews'
import { Button } from '../components/ui/button'
import { referenceApi, type ValuationStrip } from '../api/reference'
import { useWorkspace } from '../tabs/store'

export function MarketPage() {
  const { t } = useTranslation()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const [strip, setStrip] = useState<ValuationStrip | null>(null)
  const [stripError, setStripError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    referenceApi.valuation()
      .then((res) => { if (alive) setStrip(res) })
      .catch((err) => { if (alive) setStripError(err instanceof Error ? err.message : 'Failed to load') })
    return () => { alive = false }
  }, [])

  return (
    <div className="@container/market-overview flex flex-col flex-1 min-h-0">
      <PageHeader title={t('market.pageTitle')} help={t('market.pageDescription')} />
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-5 pb-8 pt-2 md:px-8">
        <SearchBox />

        <section className="py-2">
          <div className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-2 @min-[40rem]/market-overview:flex-row @min-[40rem]/market-overview:items-end @min-[40rem]/market-overview:justify-between @min-[40rem]/market-overview:gap-8">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">{t('market.fxTitle')}</h2>
                <ContextHelp label={t('market.fxTitle')}>{t('market.fxDescription')}</ContextHelp>
              </div>
              <div className="flex flex-wrap gap-1.5" aria-label={t('market.fxTitle')}>
                {FX_MAJORS.map((pair) => (
                  <Button
                    key={pair}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openOrFocus({ kind: 'market-detail', params: { assetClass: 'currency', symbol: pair } })}
                    className="tabular-nums text-sm leading-5"
                  >
                    {pair.slice(0, 3)}/{pair.slice(3)}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 @min-[32rem]/market-overview:grid-cols-2 @min-[48rem]/market-overview:grid-cols-3">
              <MarketLaunchCard
                icon={<Globe2 size={15} />}
                title={t('market.fxGlobalTitle')}
                onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'global-macro' } })}
              />
              <MarketLaunchCard
                icon={<Activity size={15} />}
                title={t('market.fxUsTitle')}
                onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'macro' } })}
              />
              <MarketLaunchCard
                icon={<Landmark size={15} />}
                title={t('market.fxFedTitle')}
                onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'fed' } })}
              />
            </div>
          </div>
        </section>

        {/* S&P 500 valuation strip — the market-level regime read. */}
        <div className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold text-foreground">
            {t('market.valuationTitle')}
            {strip && <span className="ml-2 normal-case font-normal tracking-normal"><BoardMeta meta={strip.meta} /></span>}
          </h3>
          {stripError && (
            <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">{stripError}</div>
          )}
          {!strip && !stripError && (
            <div className="grid grid-cols-1 gap-3 @min-[28rem]/market-overview:grid-cols-2 @min-[60rem]/market-overview:grid-cols-4" aria-hidden="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5">
                  <Skeleton className="h-3 w-20 rounded" />
                  <Skeleton className="h-6 w-24 rounded" />
                </div>
              ))}
            </div>
          )}
          {strip && (
            <div className="grid grid-cols-1 gap-3 @min-[28rem]/market-overview:grid-cols-2 @min-[60rem]/market-overview:grid-cols-4">
              {strip.cards.map((c) => {
                const labelKey = valuationLabelKey(c.id)
                return (
                  <SeriesCard key={c.id} card={c} label={labelKey ? t(labelKey) : c.label} emptyText={t('market.noMatches')} />
                )
              })}
            </div>
          )}
        </div>

        <section className="py-2">
          <div>
            <div className="flex items-end justify-between gap-6">
              <h2 className="text-lg leading-6 font-semibold text-foreground">{t('market.overviewTitle')}</h2>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 @min-[28rem]/market-overview:grid-cols-2 @min-[64rem]/market-overview:grid-cols-4">
              <MarketLaunchCard
                icon={<TrendingUp size={17} strokeWidth={1.75} />}
                title={t('market.boardMovers')}
                onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'movers' } })}
              />
              <MarketLaunchCard
                icon={<Globe2 size={17} strokeWidth={1.75} />}
                title={t('market.boardMacro')}
                onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'macro' } })}
              />
              <MarketLaunchCard
                icon={<ArrowUpRight size={17} strokeWidth={1.75} />}
                title={t('market.sectorRotation')}
                onClick={() => openOrFocus({ kind: 'market-rotation', params: {} })}
              />
              <MarketLaunchCard
                icon={<CalendarDays size={17} strokeWidth={1.75} />}
                title={t('market.boardCalendar')}
                onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'calendar' } })}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

const FX_MAJORS = ['EURUSD', 'USDJPY', 'GBPUSD', 'USDCNH'] as const

function MarketLaunchCard({
  icon,
  title,
  onClick,
}: {
  icon: ReactNode
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="oa-data-surface oa-pressable group flex min-h-20 items-center gap-4 rounded-2xl px-5 py-4 text-left hover:border-foreground/20 hover:bg-muted/50"
    >
      <span className="flex h-10 w-10 shrink-0 rounded-full bg-background items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 text-base font-medium text-foreground">{title}</span>
    </button>
  )
}

function valuationLabelKey(id: string):
  | 'market.valPe'
  | 'market.valCape'
  | 'market.valEarningsYield'
  | 'market.valDividendYield'
  | null {
  switch (id) {
    case 'pe_month': return 'market.valPe'
    case 'shiller_pe_month': return 'market.valCape'
    case 'earnings_yield_month': return 'market.valEarningsYield'
    case 'dividend_yield_month': return 'market.valDividendYield'
    default: return null
  }
}
