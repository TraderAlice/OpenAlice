import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleAlert } from 'lucide-react'
import { formatRelativeTime } from '../lib/intl'
import { api, type NewsArticle } from '../api'
import { PageHeader } from '../components/PageHeader'
import { EmptyState, Skeleton } from '../components/StateViews'

// ==================== Helpers ====================


const LOOKBACK_OPTIONS = [
  { value: '1h', labelKey: 'news.lookback1h' },
  { value: '12h', labelKey: 'news.lookback12h' },
  { value: '24h', labelKey: 'news.lookback24h' },
  { value: '7d', labelKey: 'news.lookback7d' },
] as const

type FetchMode = 'replace' | 'refresh'

// ==================== Article Row ====================

function ArticleRow({ article }: { article: NewsArticle }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const contentPreview = article.content.length > 160
    ? article.content.slice(0, 160) + '...'
    : article.content

  return (
    <article>
      <button
        type="button"
        aria-label={article.title}
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="group w-full px-4 py-3.5 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 sm:px-5"
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-snug text-foreground">{article.title}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              {article.source && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary">
                  {article.source}
                </span>
              )}
              <span className="text-[11px] text-muted-foreground">{formatRelativeTime(article.time)}</span>
              {article.categories && (
                <span className="text-[11px] text-muted-foreground/50 truncate">{article.categories}</span>
              )}
            </div>
          </div>
          <span
            className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center text-muted-foreground transition-transform group-hover:text-foreground ${expanded ? 'rotate-90' : ''}`}
            aria-hidden
          >
            <svg viewBox="0 0 20 20" fill="none" className="size-3.5" stroke="currentColor" strokeWidth="1.8">
              <path d="m7 4 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>

        {!expanded && article.content && (
          <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground/75 md:line-clamp-1">
            {contentPreview}
          </p>
        )}
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border/40 px-4 pb-4 pt-3 sm:px-5">
          <p className="max-w-[72ch] whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{article.content}</p>
          {article.link && (
            <a
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              className="-ml-3 inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-primary transition-colors hover:bg-primary/5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {t('news.openOriginal')}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          )}
        </div>
      )}
    </article>
  )
}

// ==================== Page ====================

export function NewsPage() {
  const { t } = useTranslation()
  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [lookback, setLookback] = useState('24h')
  const [sourceFilter, setSourceFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [sources, setSources] = useState<string[]>([])
  const requestGeneration = useRef(0)
  const orderedArticles = useMemo(
    () => [...articles].sort(
      (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime(),
    ),
    [articles],
  )

  const fetchArticles = useCallback(async (
    lb: string,
    src: string,
    mode: FetchMode = 'refresh',
  ) => {
    const request = ++requestGeneration.current
    if (mode === 'replace') {
      setArticles([])
      setLoadError(false)
      setLoading(true)
    } else {
      setRefreshing(true)
    }

    try {
      const res = await api.news.list({
        lookback: lb,
        limit: 200,
        source: src || undefined,
      })
      if (request !== requestGeneration.current) return

      setArticles(res.items)
      setLoadError(false)
      const seen = new Set<string>()
      for (const item of res.items) {
        if (item.source) seen.add(item.source)
      }
      setSources((prev) => {
        const merged = new Set([...prev, ...seen])
        return [...merged].sort()
      })
    } catch (err) {
      if (request === requestGeneration.current) {
        setLoadError(true)
        console.warn('Failed to load news:', err)
      }
    } finally {
      if (request === requestGeneration.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    void fetchArticles(lookback, sourceFilter, 'replace')
  }, [lookback, sourceFilter, fetchArticles])

  useEffect(() => {
    const id = setInterval(() => {
      void fetchArticles(lookback, sourceFilter, 'refresh')
    }, 60_000)
    return () => clearInterval(id)
  }, [lookback, sourceFilter, fetchArticles])

  useEffect(() => () => {
    requestGeneration.current += 1
  }, [])

  const retry = useCallback(() => {
    void fetchArticles(
      lookback,
      sourceFilter,
      articles.length === 0 ? 'replace' : 'refresh',
    )
  }, [articles.length, fetchArticles, lookback, sourceFilter])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title={t('nav.item.news')} />

      <div className="flex min-h-0 flex-1 flex-col px-4 py-4 md:px-6 md:py-5">
        <div className="mx-auto flex h-full w-full max-w-[1120px] flex-col gap-3">
          {/* Controls */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:gap-3">
            <select
              aria-label={t('news.lookbackLabel')}
              value={lookback}
              onChange={(e) => setLookback(e.target.value)}
              className="min-h-10 rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
            >
              {LOOKBACK_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
              ))}
            </select>

            <select
              aria-label={t('news.sourceLabel')}
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="min-h-10 max-w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
            >
              <option value="">{t('news.allSources')}</option>
              {sources.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            <span aria-live="polite" className="ml-auto inline-flex min-h-10 items-center text-xs tabular-nums text-muted-foreground">
              {t('news.articleCount', { count: articles.length })}
            </span>
          </div>

          {loadError && articles.length > 0 && (
            <NewsStaleNotice refreshing={refreshing} onRetry={retry} />
          )}

          {/* Article list */}
          <div
            aria-busy={loading || refreshing}
            className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-background shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
          >
            {loading && articles.length === 0 ? (
              <div className="divide-y divide-border/50">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="px-4 py-3">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-2.5 w-1/3 mt-2" />
                  </div>
                ))}
              </div>
            ) : loadError && articles.length === 0 ? (
              <NewsLoadError refreshing={refreshing} onRetry={retry} />
            ) : articles.length === 0 ? (
              <EmptyState title={t('news.noArticles')} description={t('news.noArticlesDescription')} />
            ) : (
              <div className="divide-y divide-border/50">
                {orderedArticles.map((article) => (
                  <ArticleRow
                    key={`${article.time}-${article.link ?? article.title}`}
                    article={article}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function NewsLoadError({
  refreshing,
  onRetry,
}: {
  refreshing: boolean
  onRetry: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-[520px] flex-col items-center px-6 py-16 text-center"
    >
      <CircleAlert size={24} strokeWidth={1.75} className="text-destructive" aria-hidden />
      <h2 className="mt-3 text-[15px] font-medium text-foreground">
        {t('news.loadErrorTitle')}
      </h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
        {t('news.loadErrorDescription')}
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={refreshing}
        className="oa-pressable mt-4 rounded-md border border-border bg-secondary px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-muted disabled:cursor-wait disabled:opacity-60"
      >
        {refreshing ? t('common.loading') : t('common.retry')}
      </button>
    </div>
  )
}

function NewsStaleNotice({
  refreshing,
  onRetry,
}: {
  refreshing: boolean
  onRetry: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md border border-warning/25 bg-warning/[0.06] px-3 py-2 text-[12px] text-muted-foreground"
    >
      <CircleAlert size={14} className="shrink-0 text-warning" aria-hidden />
      <span className="min-w-0 flex-1">{t('news.stale')}</span>
      <button
        type="button"
        onClick={onRetry}
        disabled={refreshing}
        className="oa-pressable shrink-0 rounded px-2 py-1 font-medium text-foreground hover:bg-warning/10 disabled:cursor-wait disabled:opacity-60"
      >
        {refreshing ? t('common.loading') : t('common.retry')}
      </button>
    </div>
  )
}
