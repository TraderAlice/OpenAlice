/** Shared Markdown extensions. Resolution and delivery belong to the consumer. */
export interface ContentReference { path: string; start: number; end: number }

export const MARKET_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'] as const
export type MarketInterval = typeof MARKET_INTERVALS[number]
export interface MarketReference { barId: string; interval: MarketInterval }
export const MARKET_REFERENCE_COUNT = 300

/** Last slash belongs to the interval; native broker keys may contain slashes. */
export function parseMarketReference(path: string): MarketReference | null {
  if (!path.startsWith('market/')) return null
  const boundary = path.lastIndexOf('/')
  const barId = path.slice(7, boundary)
  const interval = path.slice(boundary + 1)
  if (!MARKET_INTERVALS.includes(interval as MarketInterval) || barId.length > 512
    || !/^[^|\s\[\]?#\\]+\|[^\s\[\]?#\\]+$/.test(barId)) return null
  return { barId, interval: interval as MarketInterval }
}

export function isFileReference(path: string): boolean {
  return !path.startsWith('market/') && /^[^:|#?\\\x00\r\n\[\]]+$/.test(path) && (path.includes('/') || /\.[a-z0-9]{1,16}$/i.test(path))
    && !path.startsWith('/') && !path.split('/').includes('..')
}

export function parseContentReferences(text: string): { references: ContentReference[]; silent: boolean } {
  const references: ContentReference[] = []
  let silent = false
  const scan = /(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\1[^\n]*(?:\n|$)|$)|(`+)[\s\S]*?\2|\\\[\[|\[\[([^\]\n]+)\]\]/g
  for (const match of text.matchAll(scan)) {
    const path = match[3]?.trim()
    if (!path) continue
    if (path === 'no-reply') { silent = true; continue }
    if (parseMarketReference(path) || isFileReference(path)) references.push({ path, start: match.index, end: match.index + match[0].length })
  }
  return { references, silent }
}

/** Derived file index, never a second authoring field. First occurrence wins. */
export function inboxFiles(entry: { body: string; fileRevisions?: Readonly<Record<string, string>> }): Array<{ path: string; revision?: string }> {
  return [...new Set(parseContentReferences(entry.body).references.filter(ref => isFileReference(ref.path)).map(ref => ref.path))]
    .map(path => ({ path, ...(entry.fileRevisions?.[path] ? { revision: entry.fileRevisions[path] } : {}) }))
}
