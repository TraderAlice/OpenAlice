import type { NewsStory } from './reading-contract.js'

/** Shared stored labels establish a reading link, not entity identity or causality. */
export function newsStoryRelation(source: Pick<NewsStory, 'topics' | 'symbols'>, candidate: Pick<NewsStory, 'topics' | 'symbols'>) {
  const shared = (field: 'topics' | 'symbols') => {
    const terms = new Set(source[field].map(value => value.toLowerCase()))
    return [...new Map(candidate[field].filter(value => terms.has(value.toLowerCase())).map(value => [value.toLowerCase(), value])).values()]
  }
  return { topics: shared('topics'), symbols: shared('symbols') }
}
