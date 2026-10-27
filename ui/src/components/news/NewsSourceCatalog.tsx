import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { NewsCollectorFeed, NewsCollectorPreset } from '../../api/types'
import { Button } from '../ui/button'
import { inputClass } from '../form'

const REGIONS = ['cn', 'hk', 'us', 'europe', 'jp', 'asia', 'global'] as const
const MARKETS = ['markets', 'macro', 'fx', 'commodities', 'bonds', 'funds', 'crypto', 'ai', 'tech'] as const

function coverage(preset?: NewsCollectorPreset) {
  return {
    regions: REGIONS.filter(value => (preset?.regions ?? preset?.categories ?? []).includes(value)),
    markets: MARKETS.filter(value => (preset?.markets ?? preset?.categories ?? []).includes(value)),
  }
}

export function NewsSourceCoverage({ preset }: { preset?: NewsCollectorPreset }) {
  const { t } = useTranslation()
  const { regions, markets } = coverage(preset)
  return <p className="flex flex-wrap gap-x-2 gap-y-1 text-[11px] leading-4 text-muted-foreground">
    <span><span className="sr-only">{t('news.sourceRegions')}: </span>{regions.length ? regions.map(value => t(`news.sourceRegion.${value}`)).join(' · ') : t('news.sourceUnclassified')}</span>
    {markets.length > 0 && <span><span className="sr-only">{t('news.sourceMarkets')}: </span>{markets.map(value => t(`news.sourceCategory.${value}`)).join(' · ')}</span>}
  </p>
}

export function isSamePresetSource(feed: NewsCollectorFeed, preset: NewsCollectorFeed): boolean {
  if (feed.source.trim().toLowerCase() !== preset.source.trim().toLowerCase()) return false
  return preset.rsshubRoute ? feed.rsshubRoute === preset.rsshubRoute : !feed.rsshubRoute && feed.url === preset.url
}

export function NewsSourceCatalog({ presets, feeds, loading, error, onRetry, onAdd, focusDirectory = false }: {
  presets: NewsCollectorPreset[]; feeds: NewsCollectorFeed[]; loading: boolean; error: string | null
  onRetry: () => void; onAdd: (preset: NewsCollectorPreset) => void
  focusDirectory?: boolean
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [region, setRegion] = useState('all')
  const [market, setMarket] = useState('all')
  useEffect(() => {
    if (loading || !focusDirectory) return
    const frame = requestAnimationFrame(() => {
      const heading = document.getElementById('news-source-directory-heading')
      heading?.focus()
      heading?.scrollIntoView?.({ block: 'start' })
    })
    return () => cancelAnimationFrame(frame)
  }, [loading, focusDirectory])
  const visible = useMemo(() => presets.filter(preset => {
    const { regions, markets } = coverage(preset)
    return (region === 'all' || regions.some(value => value === region)) && (market === 'all' || markets.some(value => value === market)) &&
      [preset.name, preset.source, preset.description, ...(preset.categories ?? []),
        ...regions.map(value => t(`news.sourceRegion.${value}`)), ...markets.map(value => t(`news.sourceCategory.${value}`)),
      ].join(' ').toLowerCase().includes(search.trim().toLowerCase())
  }), [presets, search, region, market, t])

  return <section id="news-source-directory" aria-label={t('news.sourceDirectory')} className="mb-4 scroll-mt-4 space-y-3 border-b border-border/60 pb-4">
    <div>
      <h4 id="news-source-directory-heading" tabIndex={-1} className="text-sm font-medium">{t('news.sourceDirectory')} <span className="ml-1 tabular-nums text-muted-foreground">{presets.length}</span></h4>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('news.catalogDescription')}</p>
    </div>
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(160px,220px)]">
      <label className="space-y-1 text-xs text-muted-foreground">{t('news.findSource')}
        <input type="search" placeholder={t('news.findSource')} className={inputClass}
          value={search} onChange={event => setSearch(event.target.value)} disabled={loading || Boolean(error)} />
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">{t('news.sourceRegions')}
        <select className={inputClass} value={region} onChange={event => setRegion(event.target.value)} disabled={loading || Boolean(error)}>
          <option value="all">{t('news.sourceRegion.all')}</option>
          {REGIONS.map(value => <option key={value} value={value}>{t(`news.sourceRegion.${value}`)}</option>)}
        </select>
      </label>
    </div>
    <nav aria-label={t('news.sourceMarkets')} className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-xs text-muted-foreground">{t('news.sourceMarkets')}</span>
      {(['all', ...MARKETS] as const).map(value => <Button key={value} type="button" size="xs" variant={market === value ? 'secondary' : 'ghost'}
        className="pointer-coarse:min-h-11" aria-pressed={market === value} disabled={loading || Boolean(error)} onClick={() => setMarket(value)}>{t(`news.sourceCategory.${value}`)}</Button>)}
    </nav>
    {error ? <div role="alert" className="flex items-center justify-between gap-2 text-xs text-destructive">
      <p>{error}</p><Button type="button" variant="outline" size="sm" onClick={onRetry}>{t('common.retry')}</Button>
    </div> : loading ? <p className="text-xs text-muted-foreground">{t('common.loading')}</p> : <>
      <div role="group" aria-label={t('news.sourceDirectory')} tabIndex={0} className="grid max-h-[440px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map(preset => {
          const added = feeds.some(feed => isSamePresetSource(feed, preset))
          return <article key={preset.source + ':' + (preset.rsshubRoute ?? preset.url)} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border/60 p-3">
            <div className="flex items-start justify-between gap-2">
              <h5 className="text-[13px] font-medium [overflow-wrap:anywhere]">{preset.name}</h5>
              <span className="shrink-0 text-[10px] text-muted-foreground">{preset.rsshubRoute ? 'RSSHub' : 'RSS / Atom'}</span>
            </div>
            <NewsSourceCoverage preset={preset} />
            <p className="text-xs leading-5 text-muted-foreground">{preset.description}</p>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">{preset.rsshubRoute ? t('news.rsshubRequired') : t('news.directSource')}</span>
              <Button type="button" size="xs" variant="outline" disabled={added}
                onClick={() => onAdd(preset)}>{added ? t('news.sourceAdded') : <>{t('news.addSource')}<span className="sr-only">: {preset.name}</span></>}</Button>
            </div>
          </article>
        })}
      </div>
    </>}
    <p role="status" className="text-xs text-muted-foreground">{!loading && !error ? visible.length === 0 ? t('news.noMatchingSources') : t('news.sourceMatches', { count: visible.length, total: presets.length }) : ''}</p>
  </section>
}
