/**
 * Shared interval/time utilities for order-flow aggregation.
 */

export function intervalToMinutes(interval: string): number | null {
  const match = interval.match(/^(\d+)([mhdw])$/)
  if (!match) return null
  const n = Number.parseInt(match[1], 10)
  switch (match[2]) {
    case 'm': return n
    case 'h': return n * 60
    case 'd': return n * 24 * 60
    case 'w': return n * 7 * 24 * 60
    default: return null
  }
}

export function intervalToMinutesOrDefault(interval: string, fallbackMinutes: number): number {
  return intervalToMinutes(interval) ?? fallbackMinutes
}

export function parseBarDateUTC(dateStr: string): Date {
  if (dateStr.length === 10) return new Date(`${dateStr}T00:00:00Z`)
  const normalized = dateStr.replace(' ', 'T')
  return new Date(normalized.endsWith('Z') ? normalized : `${normalized}Z`)
}
