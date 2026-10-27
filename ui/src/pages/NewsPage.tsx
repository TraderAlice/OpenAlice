import { safeNotificationImage } from '../lib/notifications/image'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, CircleAlert, RefreshCw, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { api, type NewsArticle } from '../api'
import type { NewsQuery } from '../api/news'
import { PageHeader } from '../components/PageHeader'
import { Link, useNavigate } from 'react-router-dom'
import type { ViewSpec } from '../tabs/types'
import { EmptyState, Skeleton } from '../components/StateViews'
import { inputClass } from '../components/form'
import { Button, buttonVariants } from '../components/ui/button'
import { useNewsFeed } from '../hooks/useNewsFeed'
import { useWatchlist } from '../tabs/watchlist-store'
import { cn } from '../lib/utils'
import { NEWS_CATEGORIES } from '../components/market/news-categories.js'
import { groupNewsArticles, type NewsReadingGroup } from '../components/news/reading-groups'
import { NewsStories } from '../components/news/NewsStories'
import { NewsTopicPicker } from '../components/news/NewsTopicPicker'
import { NewsRelationshipFilters, type RelationshipFilters } from '../components/news/NewsRelationshipFilters'
import { NewsImportantEvents } from '../components/news/NewsImportantEvents'
const LOOKBACK_OPTIONS = [
  { value: '1h', labelKey: 'news.lookback1h' },
  { value: '12h', labelKey: 'news.lookback12h' },
  { value: '24h', labelKey: 'news.lookback24h' },
  { value: '7d', labelKey: 'news.lookback7d' },
] as const

const NEWS_VIEWS = [
  { id: 'latest', labelKey: 'news.viewLatest', tags: [] },
  { id: 'events', labelKey: 'news.viewEvents', tags: [] },
  { id: 'hot', labelKey: 'news.viewHot', tags: [] },
  { id: 'bookmarks', labelKey: 'news.viewBookmarks', tags: [] },
  { id: 'important', labelKey: 'news.viewImportant', tags: ['important', 'breaking', 'urgent', 'top'] },
  { id: 'positive', labelKey: 'news.viewPositive', tags: ['positive', 'bullish', 'benefit'] },
  { id: 'negative', labelKey: 'news.viewNegative', tags: ['negative', 'bearish', 'risk'] },
  { id: 'watchlist', labelKey: 'news.viewWatchlist', tags: [] },
] as const

type NewsViewId = typeof NEWS_VIEWS[number]['id']
const INITIAL_FILTERS = { startDate: '', endDate: '', symbol: '', keyword: '' }
const NEWS_PAGE_SIZE = 40
const NEWS_TAG_DEFINITIONS = new Map<string, typeof NEWS_VIEWS[number] | typeof NEWS_CATEGORIES[number]>(
  [...NEWS_VIEWS, ...NEWS_CATEGORIES].flatMap((definition) => definition.tags.map((tag) => [tag, definition] as const)),
)
const MARKET_FLAGS: Partial<Record<string, string>> = {
  'a-shares': 'cn', hk: 'hk', us: 'us',
}

export function NewsPage({ spec }: { spec: Extract<ViewSpec, { kind: 'news' }> }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const eventId = spec.params.eventId && /^[a-z0-9][a-z0-9-]{0,79}$/.test(spec.params.eventId) ? spec.params.eventId : undefined
  const relationships: RelationshipFilters = { country: spec.params.country, industry: spec.params.industry, asset: spec.params.asset }
  const selection = eventId ? 'events' : NEWS_VIEWS.find((view) => view.id === spec.params.view)?.id ?? 'latest'
  const category = NEWS_CATEGORIES.find((item) => item.id === spec.params.category)
  const storyView = ['events', 'hot', 'bookmarks', 'important'].includes(selection)
  const readStatus = spec.params.readStatus === 'unread' || spec.params.readStatus === 'updated' ? spec.params.readStatus : 'all'
  const [readingRefresh, setReadingRefresh] = useState(0)
  const [importantRevision, setImportantRevision] = useState(0)
  const [openedImportantId, setOpenedImportantId] = useState<string | null>(null)
  const consumeImportantOpen = useCallback(() => setOpenedImportantId(null), [])
  const navigationKeyword = typeof spec.params.keyword === 'string' ? spec.params.keyword.trim().slice(0, 500) : ''
  const navigationSource = spec.params.source?.trim().slice(0, 500) || undefined
  const [topic, setTopic] = useState<string | null>(null)
  const setSelection = (view: NewsViewId, status: string = readStatus, keepRelationships = true, source = query.source) => {
    setOpenedImportantId(null)
    setQuery(current => current.storyOffset ? { ...current, storyOffset: 0 } : current)
    const next = new URLSearchParams()
    if (spec.params.category) next.set('category', spec.params.category)
    if (view !== 'latest') next.set('view', view)
    if (query.keyword) next.set('keyword', query.keyword)
    if (source) next.set('source', source)
    if (status === 'unread' || status === 'updated') next.set('readStatus', status)
    if (keepRelationships) for (const [key, value] of Object.entries(relationships)) if (value) next.set(key, value)
    navigate({ pathname: '/market/news', search: next.toString() })
  }
  const [draft, setDraft] = useState(() => ({ ...INITIAL_FILTERS, keyword: navigationKeyword }))
  const [query, setQuery] = useState<NewsQuery>(() => ({ lookback: '24h', limit: 200, source: navigationSource, ...(navigationKeyword ? { keyword: navigationKeyword } : {}) }))
  useEffect(() => { setQuery(current => current.storyOffset ? { ...current, storyOffset: 0 } : current) }, [readStatus, spec.params.country, spec.params.industry, spec.params.asset])
  useEffect(() => {
    setDraft(current => current.keyword === navigationKeyword ? current : { ...current, keyword: navigationKeyword })
    setQuery(current => (current.keyword ?? '') === navigationKeyword && current.source === navigationSource ? current : { ...current, keyword: navigationKeyword || undefined, source: navigationSource, storyOffset: 0 })
  }, [navigationKeyword, navigationSource])
  const [dateError, setDateError] = useState(false)
  const dateErrorId = useId()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filtersId = useId()
  const activeFilterCount = Number(Boolean(query.startTime || query.endTime)) + Number(Boolean(query.symbol))
  const startDateRef = useRef<HTMLInputElement>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const { articles, stories, storyError, storyNextOffset, topics, sources, loading, refreshing, loadError, newArticleCount, acceptUpdates, retry } = useNewsFeed(eventId ? { lookback: '24h', limit: 200, includeStories: true, readingView: 'events', eventId } : { ...query, categories: category?.tags.join(','),
    important: selection === 'important', includeStories: storyView, ...(storyView ? { ...relationships, readingView: 'events', readStatus: readStatus === 'all' ? undefined : readStatus, storyTopics: topic ?? category?.tags.join(','), storyOrder: selection === 'hot' ? 'heat' : query.keyword ? 'relevance' : 'recent', bookmarked: selection === 'bookmarks' } : {}),
  }, autoRefresh)
  const watchlist = useWatchlist((state) => state.entries)
  const locale = i18n.resolvedLanguage ?? i18n.language
  const pageTitle = category ? t(category.labelKey) : t('nav.item.news')
  useEffect(() => {
    const previous = document.title
    document.title = `${pageTitle} · OpenAlice`
    return () => { document.title = previous }
  }, [pageTitle])
  const [grouped, setGrouped] = useState(true)
  const [sourceNames, setSourceNames] = useState<Record<string, string>>({})
  useEffect(() => {
    const controller = new AbortController()
    void api.config.getNewsPresets(controller.signal).then(({ feeds }) => {
      if (!controller.signal.aborted) setSourceNames(Object.fromEntries(feeds.map(feed => [feed.source.toLowerCase(), feed.name])))
    }).catch(() => { /* Source tags remain readable when the optional catalog is unavailable. */ })
    return () => controller.abort()
  }, [])

  const visibleArticles = useMemo(() => {
    const scoped = category ? articles.filter((article) => category.tags.some((tag) => articleTags(article).includes(tag))) : articles
    const sorted = [...scoped].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    if (selection === 'latest') return sorted
    if (selection === 'watchlist') {
      const symbols = watchlist.map((entry) => entry.symbol.trim().toLowerCase()).filter(Boolean)
      return sorted.filter((article) => {
        const words = [article.title, article.content, article.categories ?? ''].join(' ').toLowerCase().split(/[^\p{L}\p{N}.^-]+/u)
        return symbols.some((symbol) => words.includes(symbol) || article.symbols?.some(value => value.toLowerCase() === symbol || value.split(':').pop()?.toLowerCase() === symbol))
      })
    }
    const definition = NEWS_VIEWS.find((item) => item.id === selection)
    return definition ? sorted.filter((article) => definition.tags.some((tag) => articleTags(article).includes(tag))) : sorted
  }, [articles, category, selection, watchlist])
  const readingGroups = useMemo(() => groupNewsArticles(visibleArticles, grouped), [visibleArticles, grouped])
  const visibleStories = stories
  useEffect(() => { setTopic(null); setQuery(current => current.storyOffset ? { ...current, storyOffset: 0 } : current) }, [category?.id])
  const [visibleCount, setVisibleCount] = useState(NEWS_PAGE_SIZE)
  const activeVisibleCount = Math.min(visibleCount, readingGroups.length)
  const hasMore = activeVisibleCount < readingGroups.length
  const streamRef = useRef<HTMLElement>(null)
  const nextBatchRef = useRef<HTMLDivElement>(null)
  const articleDays = useMemo(() => {
    const days = new Map<string, NewsReadingGroup[]>()
    for (const group of readingGroups.slice(0, activeVisibleCount)) {
      const day = new Date(group.reports[0].time).toDateString()
      const entries = days.get(day)
      if (entries) entries.push(group)
      else days.set(day, [group])
    }
    return [...days]
  }, [readingGroups, activeVisibleCount])

  useEffect(() => {
    setVisibleCount(NEWS_PAGE_SIZE)
    if (streamRef.current) streamRef.current.scrollTop = 0
  }, [category?.id, query, selection, grouped])

  useEffect(() => {
    const root = streamRef.current
    const target = nextBatchRef.current
    if (!root || !target || !hasMore || typeof IntersectionObserver === 'undefined') return
    let active = true
    const observer = new IntersectionObserver((entries) => {
      if (!active || !entries.some((entry) => entry.isIntersecting)) return
      active = false
      observer.disconnect()
      setVisibleCount((count) => count + NEWS_PAGE_SIZE)
    }, { root, rootMargin: '0px 0px 160px 0px' })
    observer.observe(target)
    return () => {
      active = false
      observer.disconnect()
    }
  }, [activeVisibleCount, hasMore])

  const navigateKeyword = useCallback((keyword: string, status: string = readStatus, clearRelationships = false) => {
    const next = new URLSearchParams()
    if (spec.params.category) next.set('category', spec.params.category)
    if (spec.params.view) next.set('view', spec.params.view)
    if (keyword) next.set('keyword', keyword)
    if (!clearRelationships && navigationSource) next.set('source', navigationSource)
    if (status === 'unread' || status === 'updated') next.set('readStatus', status)
    if (!clearRelationships) for (const key of ['country', 'industry', 'asset'] as const) if (spec.params[key]) next.set(key, spec.params[key]!)
    navigate({ pathname: '/market/news', search: next.toString() })
  }, [navigate, spec.params.category, spec.params.view, spec.params.country, spec.params.industry, spec.params.asset, readStatus, navigationSource])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (draft.startDate && draft.endDate && draft.startDate > draft.endDate) {
      setDateError(true)
      setFiltersOpen(true)
      requestAnimationFrame(() => startDateRef.current?.focus())
      return
    }
    setDateError(false)
    if (document.getElementById(filtersId)?.contains(document.activeElement)) {
      event.currentTarget.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus()
    }
    setFiltersOpen(false)
    const start = draft.startDate ? new Date(`${draft.startDate}T00:00:00`) : null
    const end = draft.endDate ? new Date(`${draft.endDate}T00:00:00`) : null
    if (end) end.setDate(end.getDate() + 1)
    setQuery({
      ...query,
      storyOffset: 0,
      startTime: start ? new Date(start.getTime() - 1).toISOString() : undefined,
      endTime: end ? new Date(end.getTime() - 1).toISOString() : undefined,
      symbol: draft.symbol.trim() || undefined,
      keyword: draft.keyword.trim().slice(0, 500) || undefined,
    })
    navigateKeyword(draft.keyword.trim().slice(0, 500))
  }
  const clear = () => {
    setTopic(null)
    setFiltersOpen(false)
    setDraft(INITIAL_FILTERS)
    setQuery({ lookback: '24h', limit: 200 })
    setDateError(false)
    navigateKeyword('', 'all', true)
  }
  const selectTag = useCallback((tag: string) => {
    setDraft((current) => ({ ...current, keyword: tag }))
    setQuery((current) => ({ ...current, keyword: tag, storyOffset: 0 }))
    navigateKeyword(tag)
  }, [navigateKeyword])
  const revealMore = () => {
    setVisibleCount(count => count + NEWS_PAGE_SIZE)
    requestAnimationFrame(() => {
      const rows = Array.from(streamRef.current?.querySelectorAll<HTMLElement>('[role="listitem"]') ?? [])
        .filter(row => !row.parentElement?.closest('[role="listitem"]'))
      rows[activeVisibleCount]?.querySelector<HTMLHeadingElement>('h4')?.focus()
    })
  }

  return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader title={category ? t(category.labelKey) : t('nav.item.news')} right={
          <div className="flex flex-wrap gap-1">
          <Link to="/settings/news-collector#news-preparation" className={buttonVariants({ variant: 'ghost', size: 'xs' })}>{t('news.preparation')}</Link>
          <Link to="/settings/news-collector#news-source-directory" state={{ newsSourceDirectory: true }} className={buttonVariants({ variant: 'ghost', size: 'xs' })}>{t('news.manageSources')}</Link>
          </div>
        } />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {selection !== 'important' && <NewsImportantEvents query={{ ...query, ...(storyView ? relationships : {}), ...(storyView && readStatus !== 'all' ? { readStatus } : {}), categories: category?.tags.join(','), storyTopics: topic ?? category?.tags.join(',') }} autoRefresh={autoRefresh} revision={importantRevision}
            onViewAll={() => setSelection('important', storyView ? readStatus : 'all', storyView)} onOpen={id => { setSelection('important', storyView ? readStatus : 'all', storyView); setOpenedImportantId(id) }} />}
          <div className="shrink-0 border-b border-border px-3 py-2 md:px-4">
            <nav aria-label={t('news.viewsLabel')} className="mb-2 flex flex-wrap items-center gap-1">
              {NEWS_VIEWS.map((view) => <Button key={view.id} size="sm" variant={selection === view.id ? 'secondary' : 'ghost'}
                aria-pressed={selection === view.id} onClick={() => setSelection(view.id)}>{t(view.labelKey)}</Button>)}
            </nav>
            {eventId && <Button size="xs" variant="link" onClick={() => setSelection('events', 'all')}>{t('news.backToList')}</Button>}
            {storyView && !eventId && <NewsTopicPicker topics={topics} topic={topic} onChange={value => { setTopic(value); setQuery(current => ({ ...current, storyOffset: 0 })) }} />}
            <nav aria-label={t('news.topicLabel')} className="mb-2 flex flex-wrap items-center gap-1 text-xs">
              {[null, ...NEWS_CATEGORIES.filter(item => ['ai', 'technology', 'macro', 'industries', 'us', 'a-shares'].includes(item.id))].map(item => {
                const params = new URLSearchParams()
                if (item) params.set('category', item.id)
                if (selection !== 'latest') params.set('view', selection)
                if (query.keyword) params.set('keyword', query.keyword)
                if (query.source) params.set('source', query.source)
                if (readStatus !== 'all') params.set('readStatus', readStatus)
                for (const [key, value] of Object.entries(relationships)) if (value) params.set(key, value)
                return <Link key={item?.id ?? 'all'} to={{ pathname: '/market/news', search: params.toString() }} aria-current={category?.id === item?.id ? 'page' : undefined}
                  className={cn('rounded-sm px-2 py-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring', category?.id === item?.id && 'bg-muted font-medium text-foreground')}>{item ? t(item.labelKey) : t('news.allNews')}</Link>
              })}
            </nav>
            <form aria-label={t('news.filtersLabel')} onSubmit={submit} className="flex flex-wrap items-center gap-1.5">
              <label className="flex min-w-0 flex-1 basis-24 items-center gap-2">
                <span className="shrink-0 text-xs text-muted-foreground">{t('news.keywordFilter')}</span>
                <input aria-label={t('news.keywordFilter')} placeholder={t('news.keywordFilter')} value={draft.keyword} maxLength={500}
                  onChange={(event) => setDraft({ ...draft, keyword: event.target.value })}
                  className={cn(inputClass, 'h-7 min-w-0 px-2 py-1 text-xs')} />
              </label>
              <Button type="submit" variant="secondary" size="sm"><Search className="size-3.5" aria-hidden />{t('news.search')}</Button>
              <Button type="button" variant="ghost" size="sm" aria-expanded={filtersOpen} aria-controls={filtersId} onClick={() => setFiltersOpen(current => !current)}>
                {t('news.filterOptions')}{activeFilterCount > 0 && ` (${activeFilterCount})`}
                <ChevronDown className={cn('size-3.5', filtersOpen && 'rotate-180')} aria-hidden />
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={clear}>{t('news.clear')}</Button>
              {filtersOpen && <div id={filtersId} className="flex w-full flex-wrap items-end gap-2 pt-1">
                <div className="flex min-w-0 max-w-full basis-full items-end gap-1 sm:basis-auto">
                  <label className="min-w-0 flex-1">
                    <span className="mb-1 block text-xs text-muted-foreground">{t('news.startDate')}</span>
                    <input ref={startDateRef} name="startDate" type="date" value={draft.startDate} aria-invalid={dateError} aria-describedby={dateError ? dateErrorId : undefined} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })}
                      className={`${inputClass} h-8 min-w-0 max-w-full px-2 py-1 text-xs sm:w-[140px]`} />
                  </label>
                  <span aria-hidden="true" className="pb-1.5 text-muted-foreground">–</span>
                  <label className="min-w-0 flex-1">
                    <span className="mb-1 block text-xs text-muted-foreground">{t('news.endDate')}</span>
                    <input name="endDate" type="date" value={draft.endDate} aria-invalid={dateError} aria-describedby={dateError ? dateErrorId : undefined} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })}
                      className={`${inputClass} h-8 min-w-0 max-w-full px-2 py-1 text-xs sm:w-[140px]`} />
                  </label>
                </div>
                <label className="min-w-0 flex-1 basis-[130px] sm:max-w-[170px]">
                  <span className="mb-1 block text-xs text-muted-foreground">{t('news.symbolFilter')}</span>
                  <input aria-label={t('news.symbolFilter')} placeholder={t('news.symbolFilter')} value={draft.symbol}
                    onChange={(event) => setDraft({ ...draft, symbol: event.target.value })}
                    className={`${inputClass} h-8 min-w-0 px-2 py-1 text-xs`} />
                </label>
              </div>}
            </form>
            {dateError && <p id={dateErrorId} className="mt-2 text-xs text-destructive">{t('news.dateRangeError')}</p>}
            {storyView && !eventId && <NewsRelationshipFilters key={JSON.stringify(relationships)} values={relationships} onChange={values => {
              const params = new URLSearchParams()
              if (spec.params.category) params.set('category', spec.params.category)
              if (selection !== 'latest') params.set('view', selection)
              if (query.keyword) params.set('keyword', query.keyword)
              if (query.source) params.set('source', query.source)
              if (readStatus !== 'all') params.set('readStatus', readStatus)
              for (const [key, value] of Object.entries(values)) if (value) params.set(key, value)
              setQuery(current => ({ ...current, storyOffset: 0 }))
              navigate({ pathname: '/market/news', search: params.toString() })
            }} />}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {storyView && <label className="flex items-center gap-1.5">{t('news.readStatusLabel')}
                <select className={cn(inputClass, 'h-7 w-auto py-1 text-xs')} value={readStatus} onChange={event => setSelection(selection, event.target.value)}>
                  <option value="all">{t('news.readAll')}</option>
                  <option value="unread">{t('news.unread')}</option>
                  <option value="updated">{t('news.updatedOnly')}</option>
                </select>
              </label>}
              {!storyView && <select aria-label={t('news.lookbackLabel')} value={query.lookback ?? '24h'} disabled={Boolean(query.startTime)}
                onChange={(event) => setQuery({ ...query, lookback: event.target.value })}
                className={cn(inputClass, 'h-7 w-auto py-1 text-xs')}>
                {LOOKBACK_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
              </select>}
              <select aria-label={t('news.sourceLabel')} value={query.source ?? ''} onChange={(event) => {
                setQuery({ ...query, source: event.target.value || undefined, storyOffset: 0 })
                setSelection(selection, readStatus, true, event.target.value)
              }}
                className={cn(inputClass, 'h-7 w-auto max-w-36 py-1 text-xs')}>
                <option value="">{t('news.allSources')}</option>
                {sources.map((source) => <option key={source} value={source}>{source}</option>)}
              </select>
              {!storyView && <div role="group" aria-label={t('news.readingMode')} className="flex gap-0.5 rounded-md border border-border p-0.5">
                <Button type="button" size="xs" variant={grouped ? 'secondary' : 'ghost'} aria-pressed={grouped} onClick={() => setGrouped(true)}>{t('news.groupEvents')}</Button>
                <Button type="button" size="xs" variant={!grouped ? 'secondary' : 'ghost'} aria-pressed={!grouped} onClick={() => setGrouped(false)}>{t('news.allReports')}</Button>
              </div>}
              <span role="status" aria-atomic="true">{!loading && (storyView ? t('news.eventCount', { count: visibleStories.length }) : grouped ? t('news.groupCount', { groups: readingGroups.length, reports: visibleArticles.length }) : t('news.articleCount', { count: visibleArticles.length }))}</span>
              {!storyView && articles.length === 200 && <span>{t('news.resultLimit', { count: 200 })}</span>}
              {!storyView && newArticleCount > 0 && <Button type="button" variant="secondary" size="sm" onClick={() => {
                acceptUpdates()
                requestAnimationFrame(() => streamRef.current?.querySelector<HTMLHeadingElement>('[role="listitem"] h4')?.focus())
              }}>{t('news.newReports', { count: newArticleCount })}</Button>}
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={autoRefresh} onChange={event => setAutoRefresh(event.target.checked)} />{t('news.automaticUpdates')}</label>
              <Button type="button" variant="ghost" size="icon-sm" className="ml-auto" aria-label={t('news.refresh')} onClick={() => { if (storyView && readStatus !== 'all') setReadingRefresh(value => value + 1); retry() }} disabled={loading || refreshing}>
                <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
              </Button>
            </div>
            {!storyView && grouped && <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{t('news.groupingNote')}</p>}
          </div>
          <div role="status" aria-atomic="true" className={storyView && storyError ? 'border-b border-warning/25 px-4 py-2 text-xs text-muted-foreground' : undefined}>{storyView && storyError && t('news.storyLoadError')}</div>
          <NewsStaleNotice visible={Boolean(loadError && articles.length > 0)} refreshing={refreshing} onRetry={retry} />
          <section ref={streamRef} aria-label={t('news.streamLabel')} className="min-h-48 flex-1 overflow-y-auto">
            <div data-testid="news-feed" aria-busy={loading || refreshing}>
              {loading && articles.length === 0 ? <NewsStreamSkeleton /> : loadError && articles.length === 0 ? (
                <NewsLoadError refreshing={refreshing} onRetry={retry} />
              ) : storyView ? <>
                <NewsStories key={JSON.stringify([selection, category?.id, topic, query, readStatus, readingRefresh, eventId, relationships])} stories={visibleStories} locale={locale} bookmarkedOnly={selection === 'bookmarks'} preserveOpened={readStatus !== 'all'}
                  importantOnly={selection === 'important'} initiallyOpenedId={eventId ?? (selection === 'important' ? openedImportantId : null)}
                  onInitialOpen={consumeImportantOpen}
                  onImportantChange={() => { setImportantRevision(value => value + 1); if (selection === 'important') retry() }}
                  sourceNames={sourceNames} rankOffset={selection === 'hot' ? query.storyOffset ?? 0 : undefined}
                  onTopic={value => { setTopic(value); setQuery(current => ({ ...current, storyOffset: 0 })) }} />
                <nav aria-label={t('news.eventPages')} className="flex flex-wrap items-center justify-center gap-3 px-4 py-4">
                  <Button variant="outline" size="sm" disabled={!query.storyOffset || loading || refreshing} onClick={() => setQuery({ ...query, storyOffset: Math.max(0, (query.storyOffset ?? 0) - 50) })}>{t('news.previousEvents')}</Button>
                  <span className="text-xs text-muted-foreground">{t('news.eventPage', { page: Math.floor((query.storyOffset ?? 0) / 50) + 1 })}</span>
                  <Button variant="outline" size="sm" disabled={storyNextOffset === null || loading || refreshing} onClick={() => setQuery({ ...query, storyOffset: storyNextOffset ?? 0 })}>{t('news.nextEvents')}</Button>
                </nav>
                {selection === 'important' && readingGroups.length > 0 && <section aria-label={t('news.sourceImportantReports')} className="border-t border-border px-4 pt-3">
                  <h3 className="mb-3 text-xs font-medium text-muted-foreground">{t('news.sourceImportantReports')}</h3>
                  {readingGroups.map(group => <NewsStreamRow key={group.key} article={group.reports[0]} locale={locale} onTag={selectTag} group={grouped ? group : undefined} sourceNames={sourceNames} />)}
                </section>}
              </> : visibleArticles.length === 0 ? <EmptyState title={t('news.noArticles')} description={t('news.noArticlesDescription')} /> : (
                <>
                  <div className="px-3 pt-3 md:px-4">
                    {articleDays.map(([dayKey, items]) => {
                      const day = formatNewsDay(items[0].reports[0].time, locale)
                      return <section key={dayKey}>
                        <h3 className="mb-1 text-xs font-medium text-muted-foreground">{day}</h3>
                        <div role="list" aria-label={day}>
                          {items.map(group => <NewsStreamRow key={group.key} article={group.reports[0]} locale={locale} onTag={selectTag}
                            group={grouped ? group : undefined} sourceNames={sourceNames} />)}
                        </div>
                      </section>
                    })}
                  </div>
                  {hasMore && <div ref={nextBatchRef} className="h-px" aria-hidden="true" />}
                  {hasMore && <div className="px-4 py-3"><Button type="button" variant="outline" onClick={revealMore}>{t('news.moreReports')}</Button></div>}
                </>
              )}
            </div>
          </section>
        </div>
      </div>
  )
}


const NewsStreamRow = memo(function NewsStreamRow({ article, locale, onTag, group, sourceNames = {} }: {
  article: NewsArticle; locale: string; onTag: (tag: string) => void
  group?: NewsReadingGroup
  sourceNames?: Record<string, string>
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const summaryId = useId()
  const link = safeNewsUrl(article.link)
  const image = safeNotificationImage(article.image)
  const labels = new Map<string, { tag: string; flag?: string }>()
  for (const tag of (article.categories ?? '').split(/[;,]/).map((value) => value.trim()).filter(Boolean)) {
    const definition = NEWS_TAG_DEFINITIONS.get(tag.toLowerCase())
    const label = definition ? t(definition.labelKey) : tag
    if (!labels.has(label)) labels.set(label, { tag, flag: definition ? MARKET_FLAGS[definition.id] : undefined })
  }
  const content = article.content.trim()
  const hasText = Boolean(content || article.quote?.text)
  const textIds = [content ? summaryId : null, article.quote?.text ? summaryId + '-quote' : null].filter(Boolean).join(' ')
  const sourceName = article.source ? sourceNames[article.source.toLowerCase()] ?? article.source : null
  const quoteLink = safeNewsUrl(article.quote?.url ?? null)
  const hasImage = Boolean(image && failedImage !== image)
  const source = link ? (
    <a href={link} target="_blank" rel="noopener noreferrer" title={sourceName ?? t('news.openOriginal')}
      className="inline-flex min-h-7 max-w-full items-center rounded-sm text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring [overflow-wrap:anywhere]">
      {sourceName ?? t('news.openOriginal')}
    </a>
  ) : sourceName ? <span className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{sourceName}</span> : null
  return (
    <article role="listitem" className="grid min-w-0 grid-cols-[46px_minmax(0,1fr)] sm:grid-cols-[54px_minmax(0,1fr)]">
      <div className="relative border-r border-border/60 pr-2 text-right">
        <time className="text-xs leading-[22px] tabular-nums text-muted-foreground" dateTime={article.time} title={article.timeBasis === 'collection' ? t('news.collectedTime', { time: formatPublishedTime(article.time, locale) }) : formatPublishedTime(article.time, locale)}>
          {formatNewsTime(article.time, locale)}
        </time>
        {article.timeBasis === 'collection' && <span className="block text-[10px] text-muted-foreground">{t('news.collected')}</span>}
        <span aria-hidden className="absolute -right-[3px] top-2 size-[5px] rounded-full bg-muted-foreground/60" />
      </div>
      <div className={cn('grid min-w-0 items-start gap-x-3 pb-4 pl-3', hasImage && 'sm:grid-cols-[minmax(0,1fr)_124px]')}>
        <div className="min-w-0">
          <h4 tabIndex={-1} className="text-sm font-semibold leading-[22px] text-foreground [overflow-wrap:anywhere]">
            {(article.important || group?.reports.some(report => report.important)) && <span className="mr-2 text-xs font-medium text-warning">{t('news.sourceImportant')}</span>}
            {link ? <a href={link} target="_blank" rel="noopener noreferrer" className="rounded-sm underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{article.title}</a> : article.title}
          </h4>
          {article.author && <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{article.author}</p>}
          {article.contentBasis && article.contentBasis !== 'missing' && <p className="mt-1 text-[11px] text-muted-foreground">{t(article.contentBasis === 'feed-summary' ? 'news.feedSummary' : 'news.feedContent')}</p>}
          {content && <p id={summaryId} className={cn('mt-1 whitespace-pre-wrap text-[13px] leading-[21px] text-muted-foreground [overflow-wrap:anywhere]', !expanded && 'line-clamp-3')}>
            {content}
          </p>}
          {!content && !article.quote?.text && <p className="mt-1 text-xs text-muted-foreground">{t('news.originalBodyMissing')}</p>}
          {article.quote && <blockquote className="mt-2 border-l-2 border-border pl-3 text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {quoteLink ? <a href={quoteLink} target="_blank" rel="noopener noreferrer" className="rounded-sm underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{article.quote.author}</a> : <span>{article.quote.author}</span>}
            <p id={summaryId + '-quote'} className={cn('mt-1 whitespace-pre-wrap', !expanded && 'line-clamp-3')}>{article.quote.text}</p>
          </blockquote>}
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
            {article.symbols?.map(symbol => <span key={symbol} className="rounded-sm border border-border px-1.5 py-1 text-[11px] text-muted-foreground">{symbol}</span>)}
            {[...labels].map(([label, { tag, flag }]) => (
              <Button key={label} type="button" variant="outline" size="xs" onClick={() => onTag(tag)}
                className="h-auto min-h-7 max-w-full gap-1.5 whitespace-normal rounded-sm bg-muted/20 px-2 text-left font-normal text-muted-foreground [overflow-wrap:anywhere]">
                {flag && <img src={`/market/flags/${flag}.svg`} alt="" width={16} height={16} className="size-4 shrink-0" />}
                {label}
              </Button>
            ))}
            {(hasText || !hasImage && source) && <div className="ml-auto flex min-w-0 items-center gap-2">
              {hasText && <Button type="button" variant="ghost" size="icon-xs" aria-expanded={expanded} aria-controls={textIds}
                aria-label={t(expanded ? 'news.showLess' : 'news.showMore')} title={t(expanded ? 'news.showLess' : 'news.showMore')}
                onClick={() => setExpanded(!expanded)} className="size-7 text-muted-foreground">
                <ChevronDown className={cn('size-3.5', expanded && 'rotate-180')} aria-hidden />
              </Button>}
              {!hasImage && source}
            </div>}
          </div>
          {group && <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <Button type="button" size="xs" variant="ghost" className="-ml-2 text-primary" aria-expanded={groupOpen} aria-controls={`${summaryId}-reports`} onClick={() => setGroupOpen(current => !current)}>
              {group.reports.length > 1 ? t('news.groupReports', { reports: group.reports.length, sources: group.sources.length }) : t('news.readReport')}
              <ChevronDown className={cn('size-3', groupOpen && 'rotate-180')} aria-hidden />
            </Button>
            {group.reports.length > 1 && <>
              <span className="max-w-full truncate">{group.sources.map(source => sourceNames[source.toLowerCase()] ?? source).join(' / ')}</span>
              <span>{t('news.firstReported', { time: formatPublishedTime(group.reports[group.reports.length - 1].time, locale) })}</span>
            </>}
          </div>}
          {group && groupOpen && <section id={`${summaryId}-reports`} role="region" aria-label={t('news.reportingTimeline')} className="mt-3 border-t border-border pt-3">
            <p className="mb-3 text-xs text-muted-foreground">{t('news.timelineDescription')}</p>
            <div role="list" aria-label={t('news.reportingTimeline')}>
              {[...group.reports].reverse().map((report, index) => <div key={articleKey(report) + ':' + index}>
                <p className="mb-2 text-[11px] text-muted-foreground">{formatPublishedTime(report.time, locale)}</p>
                <NewsStreamRow article={report} locale={locale} onTag={onTag} sourceNames={sourceNames} />
              </div>)}
            </div>
          </section>}
        </div>
        {hasImage && <div className="mt-2 w-[124px] min-w-0 justify-self-end text-right sm:mt-0 sm:w-auto">
          <img src={image} alt={t('news.imageAlt', { title: article.title })} loading="lazy" decoding="async" referrerPolicy="no-referrer"
            onError={() => setFailedImage(image ?? null)} className="aspect-[3/2] w-full rounded-sm border border-border object-cover" />
          {source && <div className="mt-1">{source}</div>}
        </div>}
      </div>
    </article>
  )
})

function NewsStreamSkeleton() {
  return <div className="space-y-6 px-4 py-4" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => (
    <div key={index} className="grid grid-cols-[46px_minmax(0,1fr)] gap-3 sm:grid-cols-[54px_minmax(0,1fr)]"><Skeleton className="h-3 w-10" /><div className="space-y-2"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-4/5" /><Skeleton className="h-6 w-36" /></div></div>
  ))}</div>
}

function NewsLoadError({ refreshing, onRetry }: { refreshing: boolean; onRetry: () => void }) {
  const { t } = useTranslation()
  return <div role="alert" className="mx-auto flex max-w-[520px] flex-col items-center px-6 py-16 text-center">
    <CircleAlert size={24} strokeWidth={1.75} className="text-destructive" aria-hidden />
    <h2 className="mt-3 text-[15px] font-medium">{t('news.loadErrorTitle')}</h2>
    <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{t('news.loadErrorDescription')}</p>
    <Button type="button" onClick={onRetry} disabled={refreshing} className="mt-4" variant="outline" size="sm">{refreshing ? t('common.loading') : t('common.retry')}</Button>
  </div>
}

function NewsStaleNotice({ visible, refreshing, onRetry }: { visible: boolean; refreshing: boolean; onRetry: () => void }) {
  const { t } = useTranslation()
  return <div role="status" className={visible ? 'flex items-center gap-2 border-b border-warning/25 bg-warning/[0.06] px-3 py-2 text-xs text-muted-foreground' : undefined}>{visible && <>
    <CircleAlert size={14} className="shrink-0 text-warning" aria-hidden />
    <span className="min-w-0 flex-1">{t('news.stale')}</span>
    <Button type="button" onClick={onRetry} disabled={refreshing} variant="ghost" size="xs">{refreshing ? t('common.loading') : t('common.retry')}</Button>
  </>}</div>
}

function articleKey(article: NewsArticle): string { return `${article.time}-${article.link ?? article.title}` }
function articleTags(article: NewsArticle): string[] { return (article.categories ?? '').split(/[;,]/).map((tag) => tag.trim().toLowerCase()).filter(Boolean) }

function safeNewsUrl(value: string | null | undefined, allowLocal = false): string | undefined {
  if (!value) return undefined
  if (allowLocal && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return value
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch { return undefined }
}

const dateFormatterCache = new Map<string, Intl.DateTimeFormat>()

function getDateFormatter(locale: string, kind: 'time' | 'date' | 'published'): Intl.DateTimeFormat {
  const key = `${locale}:${kind}`
  const cached = dateFormatterCache.get(key)
  if (cached) return cached
  const options: Intl.DateTimeFormatOptions = kind === 'time'
    ? { hour: '2-digit', minute: '2-digit', hour12: false }
    : kind === 'date'
      ? { dateStyle: 'medium' }
      : { dateStyle: 'medium', timeStyle: 'short' }
  const formatter = new Intl.DateTimeFormat(locale, options)
  dateFormatterCache.set(key, formatter)
  return formatter
}

function formatNewsDay(value: string, locale: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  if (date.toDateString() === new Date().toDateString()) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'day')
  }
  return getDateFormatter(locale, 'date').format(date)
}

function formatNewsTime(value: string, locale: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : getDateFormatter(locale, 'time').format(date)
}

function formatPublishedTime(value: string, locale: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : getDateFormatter(locale, 'published').format(date)
}
