import type { NewsItem } from './types.js'

const HOUR = 3600000

/** Coverage identity, shared by all-evidence counts and time-bounded heat. */
export function newsPublisher(report: Pick<NewsItem, 'metadata'>): string | null {
  let owner = report.metadata.publisher?.trim().toLowerCase()
  if (!owner) {
    // shortcut: hostname aliases may share an owner; add mappings when known aliases occur.
    try { owner = new URL(report.metadata.link ?? '').hostname.toLowerCase().replace(/^(?:www\d*|m|amp)\./, '') } catch { return null }
  }
  if (!owner) return null
  if (report.metadata.role === 'discussion' && report.metadata.author?.trim()) owner += ':' + report.metadata.author.trim().toLowerCase()
  return owner
}

/** Coverage attention, not price impact or a measurement of the entire internet. */
export function eventHeat(reports: NewsItem[], now: number): { heat: number; participants: number } {
  const participants = new Map<string, number>()
  for (const report of reports) {
    const age = now - report.time.getTime()
    if (!Number.isFinite(age) || age < 0 || age > 48 * HOUR || report.metadata.timeBasis === 'collection') continue
    const owner = newsPublisher(report)
    if (!owner) continue
    const weight = 2 ** (-age / (24 * HOUR))
    participants.set(owner, Math.max(participants.get(owner) ?? 0, weight))
  }
  return { heat: [...participants.values()].reduce((sum, weight) => sum + weight, 0), participants: participants.size }
}
