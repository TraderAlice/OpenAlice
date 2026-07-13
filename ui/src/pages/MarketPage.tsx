import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, CalendarDays, Globe2, TrendingUp } from 'lucide-react'
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

        {/* S&P 500 valuation strip — the market-level regime read. */}
        <div className="flex flex-col gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            {t('market.valuationTitle')}
            {strip && <span className="ml-2 normal-case font-normal tracking-normal"><BoardMeta meta={strip.meta} /></span>}
          </h3>
          {stripError && (
            <div className="rounded-md border border-border px-3 py-2 text-[12px] text-text-muted">{stripError}</div>
          )}
          {!strip && !stripError && (
            <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(210px,1fr))]" aria-hidden="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="border border-border rounded-md bg-bg-secondary/40 px-3 py-2.5 flex flex-col gap-1.5">
                  <Skeleton className="h-3 w-20 rounded" />
                  <Skeleton className="h-6 w-24 rounded" />
                </div>
              ))}
            </div>
          )}
          {strip && (
            <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(210px,1fr))]">
              {strip.cards.map((c) => (
                <SeriesCard key={c.id} card={c} label={valuationLabel(c.id, t) ?? c.label} emptyText={t('market.noMatches')} />
              ))}
            </div>
          )}
        </div>

        <section className="relative overflow-hidden rounded-xl border border-border/80 bg-bg-secondary/55 p-4 md:p-5">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,var(--color-accent-dim),transparent_52%)]"
          />
          <div className="relative">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
              {t('market.overviewEyebrow')}
            </p>
            <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
              <h2 className="text-[17px] font-semibold text-text">{t('market.overviewTitle')}</h2>
              <p className="max-w-xl text-[12px] leading-relaxed text-text-muted">{t('market.overviewHint')}</p>
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
      className="group flex min-h-[92px] flex-col rounded-lg border border-border/70 bg-bg/75 p-3 text-left transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-accent/45 hover:bg-bg"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/10 text-accent transition-colors group-hover:bg-accent/15">
        {icon}
      </span>
      <span className="mt-2 text-[13px] font-semibold text-text">{title}</span>
      <span className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-text-muted">{description}</span>
    </button>
  )
}

function valuationLabel(id: string, t: ReturnType<typeof useTranslation>['t']): string | null {
  switch (id) {
    case 'pe_month': return t('market.valPe')
    case 'shiller_pe_month': return t('market.valCape')
    case 'earnings_yield_month': return t('market.valEarningsYield')
    case 'dividend_yield_month': return t('market.valDividendYield')
    default: return null
  }
}
