import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, ArrowRightLeft, ArrowUpRight, CalendarDays, Globe2, Landmark, TrendingUp } from 'lucide-react'
import { BoardMeta } from '../components/market/BoardMeta'
import { PageHeader } from '../components/PageHeader'
import { SearchBox } from '../components/market/SearchBox'
import { SeriesCard } from '../components/market/SeriesCard'
import { Skeleton } from '../components/StateViews'
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
      <PageHeader title="Market" description="Search assets and view price history." />
      <div className="flex-1 flex flex-col gap-6 px-4 md:px-8 py-4 min-h-0 overflow-y-auto">
        <SearchBox />

        <section className="relative overflow-hidden rounded-xl border border-success/25 bg-success/5 p-4 md:p-5">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,var(--success-muted),transparent_56%)]" />
          <div className="relative flex flex-col gap-4">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between lg:gap-8">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-success">FX desk</p>
                <h2 className="mt-1 text-[17px] font-semibold text-foreground">From spot to carry and macro — in one pair view.</h2>
                <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted-foreground">
                  Open a major pair for price risk, rate and inflation divergence, indicative forwards, and a manual exposure scenario. No broker or bank-account connection required.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {FX_MAJORS.map((pair) => (
                  <button
                    key={pair}
                    type="button"
                    onClick={() => openOrFocus({ kind: 'market-detail', params: { assetClass: 'currency', symbol: pair } })}
                    className="min-h-8 rounded-md border border-success/25 bg-background/75 px-2.5 font-mono text-[11px] font-semibold text-foreground transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-success/55 hover:bg-background"
                  >
                    {pair.slice(0, 3)}/{pair.slice(3)}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <FxDeskEntry
                icon={<Globe2 size={15} />}
                title="Cross-country macro"
                description="Rates, inflation and growth momentum by currency economy."
                onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'global-macro' } })}
              />
              <FxDeskEntry
                icon={<Activity size={15} />}
                title="US regime"
                description="Dollar, Treasury curve, inflation and labor inputs."
                onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'macro' } })}
              />
              <FxDeskEntry
                icon={<Landmark size={15} />}
                title="Fed policy"
                description="Balance sheet, dealer positioning and FOMC documents."
                onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'fed' } })}
              />
            </div>
          </div>
        </section>

        {/* S&P 500 valuation strip — the market-level regime read. */}
        <div className="flex flex-col gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('market.valuationTitle')}
            {strip && <span className="ml-2 normal-case font-normal tracking-normal"><BoardMeta meta={strip.meta} /></span>}
          </h3>
          {stripError && (
            <div className="rounded-md border border-border px-3 py-2 text-[12px] text-muted-foreground">{stripError}</div>
          )}
          {!strip && !stripError && (
            <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(210px,1fr))]" aria-hidden="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="border border-border rounded-md bg-secondary/40 px-3 py-2.5 flex flex-col gap-1.5">
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

        <section className="relative overflow-hidden rounded-xl border border-border/80 bg-secondary/55 p-4 md:p-5">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,var(--primary-muted),transparent_52%)]"
          />
          <div className="relative">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
              {t('market.overviewEyebrow')}
            </p>
            <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
              <h2 className="text-[17px] font-semibold text-foreground">{t('market.overviewTitle')}</h2>
              <p className="max-w-xl text-[12px] leading-relaxed text-muted-foreground">{t('market.overviewHint')}</p>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <MarketLaunchCard
                icon={<TrendingUp size={17} strokeWidth={1.75} />}
                title={t('market.boardMovers')}
                description={t('market.moversSubtitle')}
                onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'movers' } })}
              />
              <MarketLaunchCard
                icon={<Globe2 size={17} strokeWidth={1.75} />}
                title={t('market.boardMacro')}
                description={t('market.macroSubtitle')}
                onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'macro' } })}
              />
              <MarketLaunchCard
                icon={<ArrowUpRight size={17} strokeWidth={1.75} />}
                title={t('market.sectorRotation')}
                description={t('market.rotationSubtitle')}
                onClick={() => openOrFocus({ kind: 'market-rotation', params: {} })}
              />
              <MarketLaunchCard
                icon={<CalendarDays size={17} strokeWidth={1.75} />}
                title={t('market.boardCalendar')}
                description={t('market.calendarSubtitle')}
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

function FxDeskEntry({ icon, title, description, onClick }: {
  icon: ReactNode
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-[58px] items-center gap-3 rounded-lg border border-border/70 bg-background/65 px-3 py-2 text-left transition-colors hover:border-success/35 hover:bg-background"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-success/10 text-success">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-[12px] font-semibold text-foreground">
          {title}<ArrowRightLeft size={11} className="text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </span>
        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}

function MarketLaunchCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ReactNode
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-[92px] flex-col rounded-lg border border-border/70 bg-background/75 p-3 text-left transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-primary/45 hover:bg-background"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
        {icon}
      </span>
      <span className="mt-2 text-[13px] font-semibold text-foreground">{title}</span>
      <span className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{description}</span>
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
