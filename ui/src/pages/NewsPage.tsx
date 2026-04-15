import { useState, useEffect, useCallback } from 'react'
import { api, type NewsArticle } from '../api'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/StateViews'

// ==================== Helpers ====================

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

const LOOKBACK_OPTIONS = [
  { value: '1h', label: '1 hour' },
  { value: '12h', label: '12 hours' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
]

// ==================== Article Row ====================

function ArticleRow({ article }: { article: NewsArticle }) {
  const [expanded, setExpanded] = useState(false)
  const contentPreview = article.content.length > 160
    ? article.content.slice(0, 160) + '...'
    : article.content

  return (
    <div
      className="px-4 py-3 hover:bg-bg-tertiary/30 transition-colors cursor-pointer"
      onClick={() => setExpanded(!expanded)}
    >
      {/* Header row */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-text leading-snug">{article.title}</p>
          <div className="flex items-center gap-2 mt-1">
            {article.source && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent/10 text-accent">
                {article.source}
              </span>
            )}
            <span className="text-[11px] text-text-muted">{timeAgo(article.time)}</span>
            {article.categories && (
              <span className="text-[11px] text-text-muted/50 truncate">{article.categories}</span>
            )}
          </div>
        </div>
        <span className="text-text-muted text-xs shrink-0 mt-0.5">{expanded ? '▾' : '▸'}</span>
      </div>

      {/* Preview / Expanded */}
      {expanded ? (
        <div className="mt-2 space-y-2">
          <p className="text-[12px] text-text-muted/80 leading-relaxed whitespace-pre-wrap">{article.content}</p>
          {article.link && (
            <a
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline"
            >
              Open original
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          )}
        </div>
      ) : (
        article.content && (
          <p className="mt-1 text-[12px] text-text-muted/50 truncate">{contentPreview}</p>
        )
      )}
    </div>
  )
}

// ==================== Page ====================

export function NewsPage() {
  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [lookback, setLookback] = useState('24h')
  const [sourceFilter, setSourceFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [sources, setSources] = useState<string[]>([])

  const fetchArticles = useCallback(async (lb: string, src: string) => {
    try {
      const res = await api.news.list({
        lookback: lb,
        limit: 200,
        source: src || undefined,
      })
      setArticles(res.items)
      const seen = new Set<string>()
      for (const item of res.items) {
        if (item.source) seen.add(item.source)
      }
      setSources((prev) => {
        const merged = new Set([...prev, ...seen])
        return [...merged].sort()
      })
    } catch (err) {
      console.warn('Failed to load news:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchArticles(lookback, sourceFilter)
  }, [lookback, sourceFilter, fetchArticles])

  useEffect(() => {
    const id = setInterval(() => fetchArticles(lookback, sourceFilter), 60_000)
    return () => clearInterval(id)
  }, [lookback, sourceFilter, fetchArticles])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title="News" />

      <div className="flex-1 flex flex-col min-h-0 px-4 md:px-6 py-5">
        <div className="flex flex-col gap-3 h-full">
          {/* Controls */}
          <div className="flex items-center gap-3 shrink-0 flex-wrap">
            <select
              value={lookback}
              onChange={(e) => setLookback(e.target.value)}
              className="bg-bg-tertiary text-text text-sm rounded-md border border-border px-2 py-1.5 outline-none focus:border-accent"
            >
              {LOOKBACK_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>

            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="bg-bg-tertiary text-text text-sm rounded-md border border-border px-2 py-1.5 outline-none focus:border-accent"
            >
              <option value="">All sources</option>
              {sources.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            <span className="text-xs text-text-muted ml-auto">
              {articles.length} article{articles.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Article list */}
          <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-border bg-bg">
            {loading && articles.length === 0 ? (
              <div className="px-4 py-8 text-center text-text-muted">Loading...</div>
            ) : articles.length === 0 ? (
              <EmptyState title="No articles" description="No news articles found for this time range." />
            ) : (
              <div className="divide-y divide-border/50">
                {[...articles].reverse().map((article, i) => (
                  <ArticleRow key={`${article.time}-${i}`} article={article} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
