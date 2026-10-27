import type { NewsArticle } from '../../api/types'

export interface NewsReadingGroup {
  key: string
  reports: NewsArticle[]
  sources: string[]
}

const DAY_MS = 86_400_000
const GENERIC_WORDS = new Set(['the', 'a', 'an', 'as', 'in', 'on', 'of', 'to', 'and', 'for', 'with', 'after', 'latest', 'new'])
const POLARITY = /\b(?:not|no|never|denies?|cuts?|raises?|rises?|falls?|drops?|gains?|loss(?:es)?|plans?|proposes?|announces?|approves?|completes?|rumou?r|reportedly)\b|不|未|否认|辟谣|上调|下调|上涨|下跌|增加|减少/gu

function headline(title: string) {
  const text = title.normalize('NFKC').toLowerCase().replace(/−/g, '-').replace(/[’‘]/g, "'")
    .replace(/\bcan(?:'t|not)\b/g, 'can not').replace(/\bwon't\b/g, 'will not').replace(/n't\b/g, ' not')
  const words = (text.match(/[a-z]+/g) ?? []).filter(word => !GENERIC_WORDS.has(word))
  return {
    text: text.replace(/[^\p{L}\p{N}]/gu, ''), words,
    numbers: (text.match(/[+-]?\d+(?:[.,]\d+)*(?:%|万|亿)?/g) ?? []).join('|'),
    polarity: (text.match(POLARITY) ?? []).join('|'),
    names: [...new Set((title.match(/\b[A-Z][a-zA-Z]+\b/g) ?? []).filter(word => !GENERIC_WORDS.has(word.toLowerCase())))].sort().join('|'),
  }
}

function articleUrl(raw: string | null): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname === '/') return null
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ['fbclid', 'gclid'].includes(key)) url.searchParams.delete(key)
    }
    url.searchParams.sort()
    return url.href
  } catch { return null }
}

function sameReport(left: NewsArticle, right: NewsArticle): boolean {
  if (left.eventRef === null || right.eventRef === null) return false
  if (left.eventRef || right.eventRef) {
    return Boolean(left.eventRef && right.eventRef && left.eventRef.storyId === right.eventRef.storyId && left.eventRef.developmentId === right.eventRef.developmentId)
  }
  if (left.timeBasis === 'collection' || right.timeBasis === 'collection') return false
  const elapsed = Math.abs(Date.parse(left.time) - Date.parse(right.time))
  if (!Number.isFinite(elapsed) || elapsed > DAY_MS) return false
  const a = headline(left.title), b = headline(right.title)
  if (a.numbers !== b.numbers || a.polarity !== b.polarity) return false
  const url = articleUrl(left.link)
  if (url && url === articleUrl(right.link)) return true
  if (a.text.length < 16 || b.text.length < 16) {
    return a.text === b.text && /\p{Script=Han}/u.test(a.text) && a.text.length >= 8
  }
  if (a.text === b.text) return true
  // shortcut: unprepared reports use conservative lexical matching; prepare event identities to group different wording.
  if (a.names !== b.names || a.words.length < 5 || b.words.length < 5 || /\p{Script=Han}/u.test(a.text + b.text)) return false
  const [shorter, longer] = a.words.length <= b.words.length ? [a.words, b.words] : [b.words, a.words]
  if (shorter.length / longer.length < 0.85) return false
  let cursor = 0
  for (const word of longer) if (word === shorter[cursor]) cursor++
  return cursor === shorter.length
}

/** A reversible reading projection over the returned query window; original reports remain intact. */
export function groupNewsArticles(articles: NewsArticle[], grouped = true): NewsReadingGroup[] {
  const groups: NewsReadingGroup[] = []
  const ordered = [...articles].sort((a, b) => (Date.parse(a.time) || 0) - (Date.parse(b.time) || 0))
  for (const article of ordered) {
    const group = grouped ? groups.find(candidate => sameReport(candidate.reports[0], article)) : undefined
    if (group) group.reports.push(article)
    else groups.push({ key: JSON.stringify([article.time, article.source, article.link, article.title]), reports: [article], sources: [] })
  }
  for (const group of groups) {
    group.reports.reverse()
    group.sources = [...new Map(group.reports.filter(report => report.source?.trim()).map(report => [report.source!.trim().toLowerCase(), report.source!.trim()])).values()]
  }
  return groups.sort((a, b) => (Date.parse(b.reports[0].time) || 0) - (Date.parse(a.reports[0].time) || 0))
}
