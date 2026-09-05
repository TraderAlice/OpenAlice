import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../api'
import type { NewsQuery } from '../api/news'
import type { NewsArticle } from '../api/types'

const REFRESH_MS = 60_000

type Load = (isRefresh: boolean) => void

export interface UseNewsFeed {
  articles: NewsArticle[]
  sources: string[]
  loading: boolean
  refreshing: boolean
  loadError: string | null
  refresh: () => void
  retry: () => void
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function mergeSources(current: string[], articles: NewsArticle[]): string[] {
  const next = new Set(current)
  for (const article of articles) {
    if (article.source) next.add(article.source)
  }
  return [...next]
}

export function useNewsFeed(params: NewsQuery): UseNewsFeed {
  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [sources, setSources] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const mounted = useRef(false)
  const queryEpoch = useRef(0)
  const requestEpoch = useRef(0)
  const hasLoaded = useRef(false)
  const loadRef = useRef<Load>(() => undefined)

  const {
    lookback,
    limit,
    source,
    startTime,
    endTime,
    keyword,
    symbol,
  } = params

  useEffect(() => {
    mounted.current = true
    const epoch = ++queryEpoch.current
    let disposed = false
    let activeController: AbortController | null = null
    const query: NewsQuery = {
      ...(lookback === undefined ? {} : { lookback }),
      ...(limit === undefined ? {} : { limit }),
      ...(source === undefined ? {} : { source }),
      ...(startTime === undefined ? {} : { startTime }),
      ...(endTime === undefined ? {} : { endTime }),
      ...(keyword === undefined ? {} : { keyword }),
      ...(symbol === undefined ? {} : { symbol }),
    }

    setArticles([])
    setLoading(true)
    setRefreshing(false)
    setLoadError(null)
    hasLoaded.current = false

    const load: Load = (isRefresh) => {
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
        if (!mounted.current || disposed || epoch !== queryEpoch.current || request !== requestEpoch.current) return
        hasLoaded.current = true
        setArticles(response.items)
        setSources((current) => mergeSources(current, response.items))
        setLoadError(null)
      }).catch((cause: unknown) => {
        if (controller.signal.aborted) return
        if (!mounted.current || disposed || epoch !== queryEpoch.current || request !== requestEpoch.current) return
        setLoadError(errorMessage(cause))
      }).finally(() => {
        if (!mounted.current || disposed || epoch !== queryEpoch.current || request !== requestEpoch.current) return
        setLoading(false)
        setRefreshing(false)
        if (activeController === controller) activeController = null
      })
    }

    loadRef.current = (isRefresh) => load(isRefresh)
    load(false)
    const interval = setInterval(() => { if (!activeController) load(true) }, REFRESH_MS)

    return () => {
      disposed = true
      activeController?.abort()
      mounted.current = false
      queryEpoch.current += 1
      requestEpoch.current += 1
      clearInterval(interval)
      loadRef.current = () => undefined
    }
  }, [lookback, limit, source, startTime, endTime, keyword, symbol])

  const refresh = useCallback(() => {
    loadRef.current(hasLoaded.current)
  }, [])

  return { articles, sources, loading, refreshing, loadError, refresh, retry: refresh }
}
