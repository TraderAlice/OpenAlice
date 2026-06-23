import { headers } from './client'
import type { DailyPick, Lesson, WatchlistEntry, WrapResult } from './types'

async function jsonOrThrow<T>(res: Response, action: string): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: action + ' failed' }))
    throw new Error(err.error || action + ' failed')
  }
  return res.json() as Promise<T>
}

export const dailyPickApi = {
  async today(): Promise<{ pick: DailyPick | null }> {
    const res = await fetch('/api/daily-pick/today')
    return jsonOrThrow(res, 'Load today pick')
  },

  async recent(limit = 10): Promise<{ picks: DailyPick[] }> {
    const res = await fetch(`/api/daily-pick/recent?limit=${limit}`)
    return jsonOrThrow(res, 'Load recent picks')
  },

  async watchlist(): Promise<{ entries: WatchlistEntry[] }> {
    const res = await fetch('/api/daily-pick/watchlist')
    return jsonOrThrow(res, 'Load watchlist')
  },

  async setWatchlist(entries: WatchlistEntry[]): Promise<{ ok: boolean; count: number }> {
    const res = await fetch('/api/daily-pick/watchlist', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ entries }),
    })
    return jsonOrThrow(res, 'Save watchlist')
  },

  async lessons(): Promise<{ lessons: Lesson[] }> {
    const res = await fetch('/api/daily-pick/lessons')
    return jsonOrThrow(res, 'Load lessons')
  },

  async wraps(): Promise<{ files: string[] }> {
    const res = await fetch('/api/daily-pick/wraps')
    return jsonOrThrow(res, 'Load wraps')
  },

  async wrap(endDate: string): Promise<{ endDate: string; markdown: string }> {
    const res = await fetch(`/api/daily-pick/wraps/${endDate}`)
    return jsonOrThrow(res, 'Load wrap')
  },

  async runPick(): Promise<{ ok: boolean; pick: DailyPick }> {
    const res = await fetch('/api/daily-pick/run/pick', { method: 'POST' })
    return jsonOrThrow(res, 'Run pick')
  },

  async overridePick(symbol: string, name?: string, reason?: string): Promise<{ ok: boolean; pick: DailyPick }> {
    const res = await fetch('/api/daily-pick/override', {
      method: 'POST',
      headers,
      body: JSON.stringify({ symbol, name, reason }),
    })
    return jsonOrThrow(res, 'Override pick')
  },

  async runHourly(): Promise<{ ok: boolean; pick: DailyPick | null }> {
    const res = await fetch('/api/daily-pick/run/hourly', { method: 'POST' })
    return jsonOrThrow(res, 'Run hourly')
  },

  async runWrap(): Promise<{ ok: boolean; result: WrapResult | null }> {
    const res = await fetch('/api/daily-pick/run/wrap', { method: 'POST' })
    return jsonOrThrow(res, 'Run wrap')
  },
}
