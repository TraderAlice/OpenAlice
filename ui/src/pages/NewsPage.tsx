import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, CircleAlert, RefreshCw, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { NewsArticle } from '../api'
import type { NewsQuery } from '../api/news'
import { PageHeader } from '../components/PageHeader'
import { useSearchParams } from 'react-router-dom'
import { EmptyState, Skeleton } from '../components/StateViews'
import { inputClass } from '../components/form'
import { Button } from '../components/ui/button'
import { useNewsFeed } from '../hooks/useNewsFeed'
import { useWatchlist } from '../tabs/watchlist-store'
import { cn } from '../lib/utils'
import { NEWS_CATEGORIES } from '../components/market/news-categories.js'
const LOOKBACK_OPTIONS = [
  { value: '1h', labelKey: 'news.lookback1h' },
  { value: '12h', labelKey: 'news.lookback12h' },
  { value: '24h', labelKey: 'news.lookback24h' },
  { value: '7d', labelKey: 'news.lookback7d' },
] as const

const NEWS_VIEWS = [
  { id: 'latest', labelKey: 'news.viewLatest', tags: [] },
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

export function NewsPage() {
  const { t, i18n } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const selection = NEWS_VIEWS.find((view) => view.id === searchParams.get('view'))?.id ?? 'latest'
  const category = NEWS_CATEGORIES.find((item) => item.id === searchParams.get('category'))
  const setSelection = (view: NewsViewId) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (view === 'latest') next.delete('view')
      else next.set('view', view)
      return next
    })
  }
  const [draft, setDraft] = useState(INITIAL_FILTERS)
  const [query, setQuery] = useState<NewsQuery>({ lookback: '24h', limit: 200 })
  const [dateError, setDateError] = useState(false)
  const { articles, sources, loading, refreshing, loadError, retry } = useNewsFeed(query)
  const watchlist = useWatchlist((state) => state.entries)
  const locale = i18n.resolvedLanguage ?? i18n.language

  const visibleArticles = useMemo(() => {
    const scoped = category ? articles.filter((article) => category.tags.some((tag) => articleTags(article).includes(tag))) : articles
    const sorted = [...scoped].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    if (selection === 'latest') return sorted
    if (selection === 'watchlist') {
      const symbols = watchlist.map((entry) => entry.symbol.trim().toLowerCase()).filter(Boolean)
      return sorted.filter((article) => {
        const words = [article.title, article.content, article.categories ?? ''].join(' ').toLowerCase().split(/[^\p{L}\p{N}.^-]+/u)
        return symbols.some((symbol) => words.includes(symbol))
      })
    }
    const definition = NEWS_VIEWS.find((item) => item.id === selection)
    return definition ? sorted.filter((article) => definition.tags.some((tag) => articleTags(article).includes(tag))) : sorted
  }, [articles, category, selection, watchlist])
  const [visibleCount, setVisibleCount] = useState(NEWS_PAGE_SIZE)
  const activeVisibleCount = Math.min(visibleCount, visibleArticles.length)
  const hasMore = activeVisibleCount < visibleArticles.length
  const streamRef = useRef<HTMLElement>(null)
  const nextBatchRef = useRef<HTMLDivElement>(null)
  const articleDays = useMemo(() => {
    const days = new Map<string, NewsArticle[]>()
    for (const article of visibleArticles.slice(0, activeVisibleCount)) {
      const day = new Date(article.time).toDateString()
      const entries = days.get(day)
      if (entries) entries.push(article)
      else days.set(day, [article])
    }
    return [...days]
  }, [visibleArticles, activeVisibleCount])

  useEffect(() => {
    setVisibleCount(NEWS_PAGE_SIZE)
    if (streamRef.current) streamRef.current.scrollTop = 0
  }, [category?.id, query, selection])

  useEffect(() => {
    const root = streamRef.current
    const target = nextBatchRef.current
    if (!root || !target || !hasMore) return
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

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (draft.startDate && draft.endDate && draft.startDate > draft.endDate) {
      setDateError(true)
      return
    }
    setDateError(false)
    const start = draft.startDate ? new Date(`${draft.startDate}T00:00:00`) : null
    const end = draft.endDate ? new Date(`${draft.endDate}T00:00:00`) : null
    if (end) end.setDate(end.getDate() + 1)
    setQuery({
      ...query,
      startTime: start ? new Date(start.getTime() - 1).toISOString() : undefined,
      endTime: end ? new Date(end.getTime() - 1).toISOString() : undefined,
      symbol: draft.symbol.trim() || undefined,
      keyword: draft.keyword.trim() || undefined,
    })
  }
  const clear = () => {
    setDraft(INITIAL_FILTERS)
    setQuery({ lookback: '24h', limit: 200 })
    setDateError(false)
  }
  const selectTag = useCallback((tag: string) => {
    setDraft((current) => ({ ...current, keyword: tag }))
    setQuery((current) => ({ ...current, keyword: tag }))
  }, [])

  return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader title={category ? t(category.labelKey) : t('nav.item.news')} />
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-border px-3 py-2 md:px-4">
            <nav aria-label={t('news.viewsLabel')} className="mb-2 flex flex-wrap items-center gap-1">
              {NEWS_VIEWS.map((view) => <Button key={view.id} size="sm" variant={selection === view.id ? 'secondary' : 'ghost'}
                aria-pressed={selection === view.id} onClick={() => setSelection(view.id)}>{t(view.labelKey)}</Button>)}
            </nav>
            <form aria-label={t('news.filtersLabel')} onSubmit={submit} className="flex flex-wrap items-center gap-2">
              <div className="flex min-w-0 basis-full items-center gap-1 sm:basis-auto">
                <label className="min-w-0 flex-1 sm:flex-none">
                  <span className="sr-only">{t('news.startDate')}</span>
                  <input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })}
                    className={`${inputClass} h-8 min-w-0 px-2 py-1 text-xs sm:w-[140px]`} />
                </label>
                <span aria-hidden="true" className="text-muted-foreground">–</span>
                <label className="min-w-0 flex-1 sm:flex-none">
                  <span className="sr-only">{t('news.endDate')}</span>
                  <input type="date" value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })}
                    className={`${inputClass} h-8 min-w-0 px-2 py-1 text-xs sm:w-[140px]`} />
                </label>
              </div>
              <input aria-label={t('news.symbolFilter')} placeholder={t('news.symbolFilter')} value={draft.symbol}
                onChange={(event) => setDraft({ ...draft, symbol: event.target.value })}
                className={`${inputClass} h-8 min-w-0 flex-1 basis-[130px] px-2 py-1 text-xs sm:max-w-[170px]`} />
              <input aria-label={t('news.keywordFilter')} placeholder={t('news.keywordFilter')} value={draft.keyword}
                onChange={(event) => setDraft({ ...draft, keyword: event.target.value })}
                className={`${inputClass} h-8 min-w-0 flex-1 basis-[140px] px-2 py-1 text-xs`} />
              <Button type="submit" variant="secondary" size="sm"><Search className="size-3.5" aria-hidden />{t('news.search')}</Button>
              <Button type="button" variant="outline" className="h-8" onClick={clear}>{t('news.clear')}</Button>
            </form>
            {dateError && <p role="alert" className="mt-2 text-xs text-destructive">{t('news.dateRangeError')}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <select aria-label={t('news.lookbackLabel')} value={query.lookback ?? '24h'} disabled={Boolean(query.startTime)}
                onChange={(event) => setQuery({ ...query, lookback: event.target.value })}
                className={cn(inputClass, 'h-7 w-auto py-1 text-xs')}>
                {LOOKBACK_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
              </select>
              <select aria-label={t('news.sourceLabel')} value={query.source ?? ''} onChange={(event) => setQuery({ ...query, source: event.target.value || undefined })}
                className={cn(inputClass, 'h-7 w-auto max-w-36 py-1 text-xs')}>
                <option value="">{t('news.allSources')}</option>
                {sources.map((source) => <option key={source} value={source}>{source}</option>)}
              </select>
              <span aria-live="polite">{t('news.articleCount', { count: visibleArticles.length })}</span>
              {articles.length === 200 && <span>{t('news.resultLimit', { count: 200 })}</span>}
              <Button type="button" variant="ghost" size="icon-sm" className="ml-auto" aria-label={t('news.refresh')} onClick={retry} disabled={loading || refreshing}>
                <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
              </Button>
            </div>
          </div>
          {loadError && articles.length > 0 && <NewsStaleNotice refreshing={refreshing} onRetry={retry} />}
          <section ref={streamRef} aria-label={t('news.streamLabel')} className="min-h-0 flex-1 overflow-y-auto">
            <div data-testid="news-feed" aria-busy={loading || refreshing}>
              {loading && articles.length === 0 ? <NewsStreamSkeleton /> : loadError && articles.length === 0 ? (
                <NewsLoadError refreshing={refreshing} onRetry={retry} />
              ) : visibleArticles.length === 0 ? <EmptyState title={t('news.noArticles')} description={t('news.noArticlesDescription')} /> : (
                <>
                  <div className="px-3 pt-3 md:px-4">
                    {articleDays.map(([dayKey, items]) => {
                      const day = formatNewsDay(items[0].time, locale)
                      return <section key={dayKey}>
                        <h3 className="mb-1 text-xs font-medium text-muted-foreground">{day}</h3>
                        <div role="list" aria-label={day}>
                          {items.map((article) => <NewsStreamRow key={articleKey(article)} article={article} locale={locale} onTag={selectTag} />)}
                        </div>
                      </section>
                    })}
                  </div>
                  {hasMore && <div ref={nextBatchRef} className="h-px" aria-hidden="true" />}
                </>
              )}
            </div>
          </section>
        </div>
      </div>
  )
}


const NewsStreamRow = memo(function NewsStreamRow({ article, locale, onTag }: { article: NewsArticle; locale: string; onTag: (tag: string) => void }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const summaryId = useId()
  const link = safeNewsUrl(article.link)
  const image = safeNewsUrl(article.image, true)
  const labels = new Map<string, { tag: string; flag?: string }>()
  for (const tag of (article.categories ?? '').split(/[;,]/).map((value) => value.trim()).filter(Boolean)) {
    const definition = NEWS_TAG_DEFINITIONS.get(tag.toLowerCase())
    const label = definition ? t(definition.labelKey) : tag
    if (!labels.has(label)) labels.set(label, { tag, flag: definition ? MARKET_FLAGS[definition.id] : undefined })
  }
  const content = article.content.trim()
  const hasImage = Boolean(image && failedImage !== image)
  const source = link ? (
    <a href={link} target="_blank" rel="noopener noreferrer" aria-label={t('news.openOriginal')} title={article.source ?? t('news.openOriginal')}
      className="inline-flex min-h-7 max-w-full items-center rounded-sm text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring [overflow-wrap:anywhere]">
      {article.source ?? t('news.openOriginal')}
    </a>
  ) : article.source ? <span className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{article.source}</span> : null
  return (
    <article role="listitem" className="grid min-w-0 grid-cols-[46px_minmax(0,1fr)] sm:grid-cols-[54px_minmax(0,1fr)]">
      <div className="relative border-r border-border/60 pr-2 text-right">
        <time className="text-xs leading-[22px] tabular-nums text-muted-foreground" dateTime={article.time} title={formatPublishedTime(article.time, locale)}>
          {formatNewsTime(article.time, locale)}
        </time>
        <span aria-hidden className="absolute -right-[3px] top-2 size-[5px] rounded-full bg-muted-foreground/60" />
      </div>
      <div className={cn('grid min-w-0 items-start gap-x-3 pb-4 pl-3', hasImage && 'sm:grid-cols-[minmax(0,1fr)_124px]')}>
        <div className="min-w-0">
          <h4 className="text-sm font-semibold leading-[22px] text-foreground [overflow-wrap:anywhere]">
            {link ? <a href={link} target="_blank" rel="noopener noreferrer" className="rounded-sm underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{article.title}</a> : article.title}
          </h4>
          {content && <p id={summaryId} className={cn('mt-1 whitespace-pre-wrap text-[13px] leading-[21px] text-muted-foreground [overflow-wrap:anywhere]', !expanded && 'line-clamp-3')}>
            {content}
          </p>}
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
            {[...labels].map(([label, { tag, flag }]) => (
              <Button key={label} type="button" variant="outline" size="xs" onClick={() => onTag(tag)}
                className="h-auto min-h-7 max-w-full gap-1.5 whitespace-normal rounded-sm bg-muted/20 px-2 text-left font-normal text-muted-foreground [overflow-wrap:anywhere]">
                {flag && <img src={`/market/flags/${flag}.svg`} alt="" width={16} height={16} className="size-4 shrink-0" />}
                {label}
              </Button>
            ))}
            {(content || !hasImage && source) && <div className="ml-auto flex min-w-0 items-center gap-2">
              {content && <Button type="button" variant="ghost" size="icon-xs" aria-expanded={expanded} aria-controls={summaryId}
                aria-label={t(expanded ? 'news.showLess' : 'news.showMore')} title={t(expanded ? 'news.showLess' : 'news.showMore')}
                onClick={() => setExpanded(!expanded)} className="size-7 text-muted-foreground">
                <ChevronDown className={cn('size-3.5', expanded && 'rotate-180')} aria-hidden />
              </Button>}
              {!hasImage && source}
            </div>}
          </div>
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

function NewsStaleNotice({ refreshing, onRetry }: { refreshing: boolean; onRetry: () => void }) {
  const { t } = useTranslation()
  return <div role="status" className="flex items-center gap-2 border-b border-warning/25 bg-warning/[0.06] px-3 py-2 text-xs text-muted-foreground">
    <CircleAlert size={14} className="shrink-0 text-warning" aria-hidden />
    <span className="min-w-0 flex-1">{t('news.stale')}</span>
    <Button type="button" onClick={onRetry} disabled={refreshing} variant="ghost" size="xs">{refreshing ? t('common.loading') : t('common.retry')}</Button>
  </div>
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
