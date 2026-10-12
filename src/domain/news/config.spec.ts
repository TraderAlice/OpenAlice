import { describe, expect, it } from 'vitest'
import { newsCollectorSchema, resolveNewsFeedUrl, rssHubRouteSchema } from './config'

describe('news collector configuration', () => {
  it('preserves a legacy absolute RSSHub-looking feed URL when the base changes', () => {
    const absoluteUrl = 'http://127.0.0.1:1200/cls/telegraph'
    const config = newsCollectorSchema.parse({
      rsshubBaseUrl: 'https://rsshub.invalid/new-base/',
      feeds: [{ name: 'Legacy feed', source: 'legacy', url: absoluteUrl }],
    })
    const feed = config.feeds[0]!

    expect(feed.url).toBe(absoluteUrl)
    expect(resolveNewsFeedUrl(feed, config.rsshubBaseUrl)).toBe(absoluteUrl)
  })

  it('resolves a relative RSSHub route and its query under a configured base prefix', () => {
    expect(resolveNewsFeedUrl(
      { url: 'https://feed.invalid/stale', rsshubRoute: 'cls/telegraph?limit=5' },
      'http://127.0.0.1:1200/mount/news/',
    )).toBe('http://127.0.0.1:1200/mount/news/cls/telegraph?limit=5')
  })

  it.each([
    ['same-origin absolute URL', 'http://127.0.0.1:1200/cls/telegraph'],
    ['cross-origin absolute URL', 'https://rsshub.invalid/cls/telegraph'],
    ['root-relative path', '/cls/telegraph'],
    ['network-path reference', '//rsshub.invalid/cls/telegraph'],
    ['encoded traversal', 'cls/%2e%2e/private'],
  ])('rejects %s as an RSSHub route', (_description, route) => {
    expect(rssHubRouteSchema.safeParse(route).success).toBe(false)
  })

  it('rejects direct feed URLs containing credentials', () => {
    expect(newsCollectorSchema.safeParse({
      feeds: [{
        name: 'Credentialed feed',
        source: 'credentialed',
        url: 'https://reader:secret@example.com/rss',
      }],
    }).success).toBe(false)
  })

  it('rejects credentials in an explicit RSSHub companion URL but preserves ordinary URL query parameters', () => {
    const route = { name: 'RSSHub', source: 'rsshub', rsshubRoute: 'cls/telegraph' }
    expect(newsCollectorSchema.safeParse({ feeds: [{ ...route, url: 'https://rsshub.invalid/feed?key=secret' }] }).success).toBe(false)
    expect(newsCollectorSchema.safeParse({ feeds: [{ ...route, url: 'https://rsshub.invalid/feed?code=secret' }] }).success).toBe(false)
    expect(newsCollectorSchema.safeParse({ feeds: [{ ...route, url: 'https://rsshub.invalid/feed?display=full' }] }).success).toBe(true)
    expect(newsCollectorSchema.safeParse({ feeds: [{ name: 'Direct', source: 'direct', url: 'https://direct.invalid/feed?key=owned&code=owned' }] }).success).toBe(true)
  })
})
