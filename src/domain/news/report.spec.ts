import { describe, expect, it } from 'vitest'
import { newsReport } from './report.js'

describe('archived source provenance', () => {
  const item = { id: 1, time: new Date('2026-10-28T00:00:00Z'), title: 'Source release', content: 'Source text', metadata: {} }
  it('projects declared feed content provenance without inventing it for older reports', () => {
    expect(newsReport({ ...item, metadata: { contentBasis: 'feed-summary' } })).toHaveProperty('contentBasis', 'feed-summary')
    expect(newsReport({ ...item, metadata: { contentBasis: 'feed-content' } })).toHaveProperty('contentBasis', 'feed-content')
    expect(newsReport(item)).not.toHaveProperty('contentBasis')
    expect(newsReport({ ...item, metadata: { contentBasis: 'untrusted-value' } })).not.toHaveProperty('contentBasis')
  })
})
