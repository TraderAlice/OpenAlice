import { describe, expect, it } from 'vitest'
import { eventHeat } from './heat.js'
import type { NewsItem } from './types.js'
const now = Date.parse('2026-10-24T12:00:00Z')
const report = (id: number, age: number, metadata: NewsItem['metadata']): NewsItem => ({ id, time: new Date(now - age * 3600000), title: 'Coverage', content: 'Original', metadata })
describe('event coverage heat', () => {
  it('counts a publisher once across multiple feeds and halves a 24-hour-old contribution', () => {
    expect(eventHeat([report(1, 24, { source: 'feed-a', link: 'https://publisher.test/a' }), report(2, 24, { source: 'feed-b', link: 'https://www.publisher.test/b' })], now)).toEqual({ heat: 0.5, participants: 1 })
  })
  it('excludes future, stale, unidentified and collection-time-only reports', () => {
    expect(eventHeat([report(1, -1, { publisher: 'Future' }), report(2, 49, { publisher: 'Old' }), report(3, 0, { source: 'Unknown feed' }), report(4, 0, { publisher: 'Undated', timeBasis: 'collection' })], now)).toEqual({ heat: 0, participants: 0 })
  })
  it('uses declared publisher identity and individual discussion authors', () => {
    expect(eventHeat([report(1, 0, { publisher: 'Publisher' }), report(2, 0, { publisher: 'PUBLISHER' }), report(3, 0, { publisher: 'Network', role: 'discussion', author: '@a' }), report(4, 0, { publisher: 'Network', role: 'discussion', author: '@b' })], now)).toEqual({ heat: 3, participants: 3 })
  })
})
