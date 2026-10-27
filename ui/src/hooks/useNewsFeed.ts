import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../api'
import type { NewsQuery } from '../api/news'
import type { NewsArticle, NewsStoryPreview } from '../api/types'

const REFRESH_MS = 60_000

type Load = (isRefresh: boolean) => void

export interface UseNewsFeed {
  articles: NewsArticle[]
  stories: NewsStoryPreview[]
  storyError: boolean
  storyNextOffset: number | null
  topics: Array<{ topic: string; count: number }>
  sources: string[]
  loading: boolean
  refreshing: boolean
  loadError: string | null
  newArticleCount: number
  acceptUpdates: () => void
  refresh: () => void
  retry: () => void
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function mergeSources(current: string[], articles: Array<Pick<NewsArticle, 'source'>>): string[] {
  const next = new Set(current)
  for (const article of articles) {
    if (article.source) next.add(article.source)
  }
  return [...next]
}

function reportKey(article: NewsArticle): string {
  return article.id === undefined ? JSON.stringify([article.source, article.time, article.title, article.link]) : `id:${article.id}`
}

export function useNewsFeed(params: NewsQuery, autoRefresh = true): UseNewsFeed {
  const autoRefreshRef = useRef(autoRefresh)
  autoRefreshRef.current = autoRefresh
  const [articles, setArticles] = useState<NewsArticle[]>([])
  const currentArticles = useRef<NewsArticle[]>([])
  const pendingArticles = useRef<NewsArticle[] | null>(null)
  const [newArticleCount, setNewArticleCount] = useState(0)
  const [stories, setStories] = useState<NewsStoryPreview[]>([])
  const [storyError, setStoryError] = useState(false)
  const [storyNextOffset, setStoryNextOffset] = useState<number | null>(null)
  const [topics, setTopics] = useState<Array<{ topic: string; count: number }>>([])
  const [sources, setSources] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [completedQuery, setCompletedQuery] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const mounted = useRef(false)
  const queryEpoch = useRef(0)
  const requestEpoch = useRef(0)
  const hasLoaded = useRef(false)
  const loadRef = useRef<Load>(() => undefined)

  const {
    country, industry, asset,
    eventId,
    readStatus,
    includeStories,
    readingView, storyTopics, storyOffset,
    storyOrder, bookmarked, important,
    lookback,
    limit,
    source,
    startTime,
    endTime,
    keyword,
    symbol,
    categories,
  } = params
  const queryKey = JSON.stringify([lookback, limit, source, startTime, endTime, keyword, symbol, categories, includeStories, readingView, storyTopics, storyOffset, storyOrder, bookmarked, important, readStatus, eventId, country, industry, asset])

  useEffect(() => {
    mounted.current = true
    const epoch = ++queryEpoch.current
    let disposed = false
    let activeController: AbortController | null = null
    const query: NewsQuery = {
      ...(country ? { country } : {}), ...(industry ? { industry } : {}), ...(asset ? { asset } : {}),
      ...(eventId ? { eventId } : {}),
      ...(readStatus ? { readStatus } : {}),
      ...(includeStories ? { includeStories } : {}),
      ...(readingView ? { readingView } : {}), ...(storyTopics ? { storyTopics } : {}), ...(storyOffset ? { storyOffset } : {}),
      ...(storyOrder ? { storyOrder } : {}), ...(bookmarked ? { bookmarked } : {}),
      ...(important ? { important } : {}),
      ...(lookback === undefined ? {} : { lookback }),
      ...(limit === undefined ? {} : { limit }),
      ...(source === undefined ? {} : { source }),
      ...(startTime === undefined ? {} : { startTime }),
      ...(endTime === undefined ? {} : { endTime }),
      ...(keyword === undefined ? {} : { keyword }),
      ...(symbol === undefined ? {} : { symbol }),
      ...(categories === undefined ? {} : { categories }),
    }

    setArticles([])
    currentArticles.current = []
    pendingArticles.current = null
    setNewArticleCount(0)
    setStories([])
    setStoryError(false)
    setStoryNextOffset(null)
    setTopics([])
    setLoading(true)
    setRefreshing(false)
    setLoadError(null)
    hasLoaded.current = false

    const load = (isRefresh: boolean, automatic = false) => {
      activeController?.abort()
      const controller = new AbortController()
      activeController = controller
      const request = ++requestEpoch.current
      if (mounted.current && !disposed && epoch === queryEpoch.current) {
        setLoadError(null)
        if (isRefresh) setRefreshing(true)
        else setLoading(true)
      }

      void api.news.list(query, controller.signal).then((response) => {
        if (automatic && !autoRefreshRef.current) return
        if (!mounted.current || disposed || epoch !== queryEpoch.current || request !== requestEpoch.current) return
        if (automatic && !includeStories && hasLoaded.current) {
          const known = new Set(currentArticles.current.map(reportKey))
          const count = response.items.filter(article => !known.has(reportKey(article))).length
          pendingArticles.current = count ? response.items : null
          setNewArticleCount(count)
        } else {
          currentArticles.current = response.items
          setArticles(response.items)
          pendingArticles.current = null
          setNewArticleCount(0)
        }
        hasLoaded.current = true
        if (!response.storyError) {
          setStories(response.stories ?? [])
          setStoryNextOffset(response.storyNextOffset ?? null)
          setTopics(response.storyTopics ?? [])
        }
        setStoryError(Boolean(response.storyError))
        setSources((current) => mergeSources(current, [...response.items, ...(response.stories ?? []).flatMap(story => story.reports), ...(response.storySources ?? []).map(source => ({ source }))]))
        setLoadError(null)
      }).catch((cause: unknown) => {
        if (automatic && !autoRefreshRef.current) return
        if (controller.signal.aborted) return
        if (!mounted.current || disposed || epoch !== queryEpoch.current || request !== requestEpoch.current) return
        setLoadError(errorMessage(cause))
      }).finally(() => {
        if (!mounted.current || disposed || epoch !== queryEpoch.current || request !== requestEpoch.current) return
        setLoading(false)
        setCompletedQuery(queryKey)
        setRefreshing(false)
        if (activeController === controller) activeController = null
      })
    }

    loadRef.current = (isRefresh) => load(isRefresh)
    load(false)
    const interval = setInterval(() => { if (autoRefreshRef.current && !activeController) load(true, true) }, REFRESH_MS)

    return () => {
      disposed = true
      activeController?.abort()
      mounted.current = false
      queryEpoch.current += 1
      requestEpoch.current += 1
      clearInterval(interval)
      loadRef.current = () => undefined
    }
  }, [queryKey])

  const refresh = useCallback(() => {
    loadRef.current(hasLoaded.current)
  }, [])

  const acceptUpdates = useCallback(() => {
    if (!pendingArticles.current) return
    currentArticles.current = pendingArticles.current
    setArticles(pendingArticles.current)
    pendingArticles.current = null
    setNewArticleCount(0)
  }, [])

  // A new query must hide the previous result before its loading effect runs.
  const currentQuery = completedQuery === queryKey
  return {
    articles: currentQuery ? articles : [], stories: currentQuery ? stories : [],
    storyError: currentQuery && storyError, storyNextOffset: currentQuery ? storyNextOffset : null,
    topics: currentQuery ? topics : [], sources, loading: loading || !currentQuery, refreshing,
    loadError: currentQuery ? loadError : null, newArticleCount: currentQuery ? newArticleCount : 0,
    acceptUpdates, refresh, retry: refresh,
  }
}
