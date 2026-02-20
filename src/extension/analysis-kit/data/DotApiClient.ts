import { readFile, writeFile, mkdir } from 'fs/promises'
import { resolve, dirname } from 'path'
import type { MarketData, NewsItem } from './interfaces'

const API_URL = 'https://dotapi.wond.dev/sandbox/realtime-data'
const CACHE_FILE = resolve('data/cache/realtime-data.json')

export interface DotApiResponse {
  currentTime: string
  lastUpdated: string
  marketData: Record<string, MarketData[]>
  news: NewsItem[]
}

interface RawNewsItem {
  time: string
  title: string
  content: string
  metadata: Record<string, string | null>
}

interface CacheEnvelope {
  cachedAt: string
  raw: unknown
}

function parseRawResponse(raw: any): DotApiResponse {
  return {
    ...raw,
    news: (raw.news as RawNewsItem[]).map((n) => ({
      ...n,
      time: new Date(n.time),
    })),
  }
}

async function writeCache(raw: unknown): Promise<void> {
  try {
    await mkdir(dirname(CACHE_FILE), { recursive: true })
    const envelope: CacheEnvelope = { cachedAt: new Date().toISOString(), raw }
    await writeFile(CACHE_FILE, JSON.stringify(envelope, null, 2))
  } catch {
    // cache write failure is non-fatal
  }
}

async function readCache(): Promise<{ cachedAt: string; data: DotApiResponse } | null> {
  try {
    const text = await readFile(CACHE_FILE, 'utf-8')
    const envelope: CacheEnvelope = JSON.parse(text)
    return { cachedAt: envelope.cachedAt, data: parseRawResponse(envelope.raw) }
  } catch {
    return null
  }
}

export async function fetchRealtimeData(): Promise<DotApiResponse> {
  try {
    const res = await fetch(API_URL)
    if (!res.ok) throw new Error(`DotAPI error: ${res.status}`)
    const raw = await res.json()
    await writeCache(raw)
    return parseRawResponse(raw)
  } catch (err) {
    const cached = await readCache()
    if (cached) {
      console.warn(`DotAPI fetch failed, using cached data from ${cached.cachedAt}`)
      return cached.data
    }
    throw err
  }
}
