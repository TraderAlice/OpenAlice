/**
 * Pure-memory bounded LRU SWR resource cache shared across UI surfaces
 * (Inbox files/inquiries/previews, Issues snapshot, Dispatch snapshots).
 *
 * Machine/Project switches already reload the page via `useRelayConnection`,
 * so keeping this cache strictly in memory guarantees zero cross-machine
 * stale data while making tab switches, entry navigation, and attachment
 * previews instant.
 */
import { prefetchScheduler, type PrefetchPriority, type PrefetchScheduler } from './prefetch-scheduler'

export interface CacheEntry<T> {
  data: T
  updatedAt: number
  etag?: string
  bytes: number
}

export interface CacheRead<T> {
  data: T
  updatedAt: number
  etag?: string
  stale: boolean
}

export interface FetchResult<T> {
  data: T
  etag?: string
  notModified?: false
}

export interface NotModifiedResult {
  notModified: true
  etag?: string
}

export type CacheFetcherResult<T> = T | FetchResult<T> | NotModifiedResult

export interface ResourceFetchContext {
  priority: PrefetchPriority
  etag?: string
}

export interface ResourceFetchOptions<T> {
  priority?: PrefetchPriority
  staleTimeMs?: number
  force?: boolean
  estimateBytes?: (value: T) => number
}

export interface ResourceCacheOptions {
  maxEntries?: number
  maxBytes?: number
  scheduler?: PrefetchScheduler
  now?: () => number
}

const DEFAULT_MAX_ENTRIES = 250
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024 // 8 MiB budget for cached previews/payloads
const DEFAULT_STALE_TIME_MS = 30_000

function isWrappedResult<T>(value: CacheFetcherResult<T>): value is FetchResult<T> | NotModifiedResult {
  if (typeof value !== 'object' || value === null) return false
  if ('notModified' in value && value.notModified === true) return true
  if ('data' in value && ('etag' in value || 'notModified' in value)) return true
  return false
}

export interface ResourceCache {
  get<T>(key: string, staleTimeMs?: number): CacheRead<T> | undefined
  peek<T>(key: string): T | undefined
  set<T>(key: string, data: T, opts?: { etag?: string; bytes?: number }): void
  invalidate(keyOrPrefix: string, opts?: { prefix?: boolean }): void
  clear(): void
  fetch<T>(
    key: string,
    fetcher: (ctx: ResourceFetchContext) => Promise<CacheFetcherResult<T>>,
    opts?: ResourceFetchOptions<T>,
  ): Promise<T>
  stats(): { entries: number; bytes: number }
}

export function createResourceCache(opts: ResourceCacheOptions = {}): ResourceCache {
  const maxEntries = Math.max(1, opts.maxEntries ?? DEFAULT_MAX_ENTRIES)
  const maxBytes = Math.max(1024, opts.maxBytes ?? DEFAULT_MAX_BYTES)
  const scheduler = opts.scheduler ?? prefetchScheduler
  const now = opts.now ?? Date.now

  // Map preserves insertion order; we delete+re-insert on access for O(1) LRU.
  const store = new Map<string, CacheEntry<unknown>>()
  let totalBytes = 0

  function deleteKey(key: string): void {
    const existing = store.get(key)
    if (!existing) return
    totalBytes = Math.max(0, totalBytes - existing.bytes)
    store.delete(key)
  }

  function evictIfNeeded(): void {
    while (store.size > maxEntries || (totalBytes > maxBytes && store.size > 1)) {
      const oldestKey = store.keys().next().value as string | undefined
      if (oldestKey === undefined) break
      deleteKey(oldestKey)
    }
  }

  function touch<T>(key: string, entry: CacheEntry<T>): void {
    store.delete(key)
    store.set(key, entry)
  }

  function get<T>(key: string, staleTimeMs = DEFAULT_STALE_TIME_MS): CacheRead<T> | undefined {
    const entry = store.get(key) as CacheEntry<T> | undefined
    if (!entry) return undefined
    touch(key, entry)
    return {
      data: entry.data,
      updatedAt: entry.updatedAt,
      etag: entry.etag,
      stale: now() - entry.updatedAt > staleTimeMs,
    }
  }

  function peek<T>(key: string): T | undefined {
    const entry = store.get(key) as CacheEntry<T> | undefined
    if (!entry) return undefined
    touch(key, entry)
    return entry.data
  }

  function set<T>(key: string, data: T, setOpts?: { etag?: string; bytes?: number }): void {
    const bytes = Math.max(0, setOpts?.bytes ?? 0)
    deleteKey(key)
    store.set(key, {
      data,
      updatedAt: now(),
      etag: setOpts?.etag,
      bytes,
    })
    totalBytes += bytes
    evictIfNeeded()
  }

  function invalidate(keyOrPrefix: string, invOpts?: { prefix?: boolean }): void {
    if (!invOpts?.prefix) {
      deleteKey(keyOrPrefix)
      return
    }
    for (const key of [...store.keys()]) {
      if (key.startsWith(keyOrPrefix)) {
        deleteKey(key)
      }
    }
  }

  function clear(): void {
    store.clear()
    totalBytes = 0
  }

  function fetch<T>(
    key: string,
    fetcher: (ctx: ResourceFetchContext) => Promise<CacheFetcherResult<T>>,
    fetchOpts: ResourceFetchOptions<T> = {},
  ): Promise<T> {
    const priority = fetchOpts.priority ?? 'high'
    const staleTimeMs = fetchOpts.staleTimeMs ?? DEFAULT_STALE_TIME_MS
    const cached = get<T>(key, staleTimeMs)

    if (cached && !cached.stale && !fetchOpts.force) {
      return Promise.resolve(cached.data)
    }

    return scheduler.schedule<T>(
      `cache:${key}`,
      async () => {
        const result = await fetcher({ priority, etag: cached?.etag })
        if (isWrappedResult(result)) {
          if (result.notModified) {
            const current = store.get(key) as CacheEntry<T> | undefined
            if (current) {
              const updated: CacheEntry<T> = {
                ...current,
                updatedAt: now(),
                etag: result.etag ?? current.etag,
              }
              touch(key, updated)
              return current.data
            }
            // Defensive fallback: if evicted while in-flight, re-run unconditionally.
            const fallback = await fetcher({ priority })
            const fallbackData = isWrappedResult(fallback) && !fallback.notModified
              ? fallback.data
              : (fallback as T)
            const fallbackEtag = isWrappedResult(fallback) ? fallback.etag : undefined
            set(key, fallbackData, {
              etag: fallbackEtag,
              bytes: fetchOpts.estimateBytes?.(fallbackData) ?? 0,
            })
            return fallbackData
          }
          set(key, result.data, {
            etag: result.etag,
            bytes: fetchOpts.estimateBytes?.(result.data) ?? 0,
          })
          return result.data
        }
        set(key, result, {
          bytes: fetchOpts.estimateBytes?.(result) ?? 0,
        })
        return result
      },
      priority,
    )
  }

  function stats() {
    return { entries: store.size, bytes: totalBytes }
  }

  return { get, peek, set, invalidate, clear, fetch, stats }
}

/** Shared singleton pure-memory SWR resource cache. */
export const resourceCache = createResourceCache()
