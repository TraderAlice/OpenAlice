import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, ArrowUpRight, CalendarDays, Globe2, Landmark, TrendingUp } from 'lucide-react'
import { BoardMeta } from '../components/market/BoardMeta'
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
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title={t('market.pageTitle')} description={t('market.pageDescription')} />
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4 md:px-8">
        <SearchBox />

        <section className="border-y border-border/60 py-4">
          <div className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between lg:gap-8">
              <div>
                <h2 className="text-[14px] leading-[19px] font-semibold text-foreground">{t('market.fxTitle')}</h2>
                <p className="mt-0.5 max-w-2xl text-[12px] leading-5 text-muted-foreground">
                  {t('market.fxDescription')}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5" aria-label={t('market.fxTitle')}>
                {FX_MAJORS.map((pair) => (
                  <Button
                    key={pair}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openOrFocus({ kind: 'market-detail', params: { assetClass: 'currency', symbol: pair } })}
                    className="font-mono text-[11px] leading-[15px]"
                  >
                    {pair.slice(0, 3)}/{pair.slice(3)}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <FxDeskEntry
                icon={<Globe2 size={15} />}
                title={t('market.fxGlobalTitle')}
                onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'global-macro' } })}
              />
              <FxDeskEntry
                icon={<Activity size={15} />}
                title={t('market.fxUsTitle')}
                onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'macro' } })}
              />
              <FxDeskEntry
                icon={<Landmark size={15} />}
                title={t('market.fxFedTitle')}
                onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'fed' } })}
              />
            </div>
          </div>
        </section>

        {/* S&P 500 valuation strip — the market-level regime read. */}
        <div className="flex flex-col gap-2">
          <h3 className="text-caption font-semibold text-foreground">
            {t('market.valuationTitle')}
            {strip && <span className="ml-2 normal-case font-normal tracking-normal"><BoardMeta meta={strip.meta} /></span>}
          </h3>
          {stripError && (
            <div className="rounded-lg border border-border bg-card px-3 py-2 text-[12px] text-muted-foreground">{stripError}</div>
          )}
          {!strip && !stripError && (
            <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(210px,1fr))]" aria-hidden="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5">
                  <Skeleton className="h-3 w-20 rounded" />
                  <Skeleton className="h-6 w-24 rounded" />
                </div>
              ))}
            </div>
          )}
          {strip && (
            <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(210px,1fr))]">
              {strip.cards.map((c) => {
                const labelKey = valuationLabelKey(c.id)
                return (
                  <SeriesCard key={c.id} card={c} label={labelKey ? t(labelKey) : c.label} emptyText={t('market.noMatches')} />
                )
              })}
            </div>
          )}
        </div>

        <section className="border-y border-border/60 py-4">
          <div>
            <div className="flex items-end justify-between gap-6">
              <h2 className="text-[14px] leading-[19px] font-semibold text-foreground">{t('market.overviewTitle')}</h2>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
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

function FxDeskEntry({ icon, title, onClick }: {
  icon: ReactNode
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="oa-pressable group flex min-h-12 items-center gap-2.5 rounded-lg border border-border/70 bg-card px-3 py-2 text-left transition-[border-color,background-color] duration-[var(--motion-fast)] hover:border-success/30 hover:bg-success/5"
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center text-success">
        {icon}
      </span>
      <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{title}</span>
    </button>
  )
}

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
      className="oa-pressable group flex min-h-12 items-center gap-2.5 rounded-lg border border-border/70 bg-card px-3 py-2 text-left transition-[border-color,background-color] duration-[var(--motion-fast)] hover:border-primary/30 hover:bg-primary/[0.045]"
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center text-primary">
        {icon}
      </span>
      <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{title}</span>
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
