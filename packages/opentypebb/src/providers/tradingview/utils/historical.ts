export const INTERVALS: Record<string, string> = {
  '1m': '1',
  '3m': '3',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
  '1w': 'W',
}

export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export interface TradingViewHistoricalQuery {
  interval: string
  start_date?: string | null
  end_date?: string | null
  count?: number
}

export function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function minutesFor(interval: string): number {
  switch (interval) {
    case '1m': return 1
    case '3m': return 3
    case '5m': return 5
    case '15m': return 15
    case '30m': return 30
    case '1h': return 60
    case '4h': return 4 * 60
    case '1d': return 24 * 60
    case '1w': return 7 * 24 * 60
    default: return 1
  }
}

export function estimateRange(query: TradingViewHistoricalQuery): number {
  if (query.count != null) return Math.max(1, Math.min(query.count, 10_000))
  const end = query.end_date ? new Date(`${query.end_date}T23:59:59Z`) : new Date()
  const start = query.start_date ? new Date(`${query.start_date}T00:00:00Z`) : null
  if (!start || Number.isNaN(start.getTime())) return query.interval === '1m' ? 5_000 : 1_000
  const elapsedMinutes = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 60_000))
  const raw = Math.ceil(elapsedMinutes / minutesFor(query.interval))
  return Math.max(100, Math.min(raw + 50, 10_000))
}

export function endTimestamp(query: TradingViewHistoricalQuery): number | null {
  if (!query.end_date) return null
  return Math.floor(new Date(`${query.end_date}T23:59:59Z`).getTime() / 1000)
}

export function formatUTCTime(unixSeconds: number): string {
  const iso = new Date(unixSeconds * 1000).toISOString()
  return iso.slice(0, 19).replace('T', ' ')
}

export function inDateWindow(date: string, query: TradingViewHistoricalQuery): boolean {
  const day = date.slice(0, 10)
  if (query.start_date && day < query.start_date) return false
  if (query.end_date && day > query.end_date) return false
  return true
}
