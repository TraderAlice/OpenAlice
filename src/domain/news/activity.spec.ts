import { describe, expect, it } from 'vitest'
import { newsActivityPayload } from './activity.js'
import type { NewsRecord } from './types.js'

const article: NewsRecord = { seq: 42, ts: 1, pubTs: 0, dedupKey: 'guid:42', title: 'Headline', content: 'Full body', metadata: { source: 'Reuters' } }

describe('news activity fact', () => {
  it('carries a safe image with the same article identity/headline, never the body', () => {
    expect(newsActivityPayload({ ...article, metadata: { ...article.metadata, image: 'https://cdn.example.com/photo.jpg' } }))
      .toEqual({ newsItemId: 42, title: 'Headline', dedupKey: 'guid:42', source: 'Reuters', publishedAt: 0, ingestSource: 'rss', image: 'https://cdn.example.com/photo.jpg' })
  })
  it.each([undefined, null, '', 'javascript:alert(1)', 'data:image/png;base64,abc', 'https://user:secret@example.com/image.jpg', '//example.com/image.jpg'])
    ('omits missing or unsafe media (%s), preserving old records', image => {
      expect(newsActivityPayload({ ...article, metadata: { ...article.metadata, ...(image === undefined ? {} : { image }) } })).not.toHaveProperty('image')
    })
})
