import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseRSSXml, fetchAndParseFeed } from './rss-parser'

describe('parseRSSXml', () => {
  it('parses standard RSS 2.0 items', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Bitcoin surges past $90k</title>
      <link>https://example.com/article/1</link>
      <guid>https://example.com/article/1</guid>
      <pubDate>Thu, 27 Feb 2026 10:00:00 GMT</pubDate>
      <description>Bitcoin has surged past the $90,000 mark amid institutional buying.</description>
    </item>
    <item>
      <title>ETH upgrade announced</title>
      <link>https://example.com/article/2</link>
      <guid>article-2-uuid</guid>
      <pubDate>Thu, 27 Feb 2026 11:00:00 GMT</pubDate>
      <description>Ethereum developers announced a major protocol upgrade.</description>
    </item>
  </channel>
</rss>`

    const items = parseRSSXml(xml)
    expect(items).toHaveLength(2)

    expect(items[0].title).toBe('Bitcoin surges past $90k')
    expect(items[0].link).toBe('https://example.com/article/1')
    expect(items[0].guid).toBe('https://example.com/article/1')
    expect(items[0].content).toBe('Bitcoin has surged past the $90,000 mark amid institutional buying.')
    expect(items[0].pubDate).toEqual(new Date('Thu, 27 Feb 2026 10:00:00 GMT'))

    expect(items[1].title).toBe('ETH upgrade announced')
    expect(items[1].guid).toBe('article-2-uuid')
  })

  it('handles CDATA-wrapped content', () => {
    const xml = `<rss><channel>
      <item>
        <title><![CDATA[Block Inc slashes 40% of staff]]></title>
        <description><![CDATA[<p>Block is reducing from <b>10,000</b> to 6,000 employees.</p>]]></description>
        <link>https://example.com/3</link>
        <guid>guid-3</guid>
        <pubDate>Thu, 27 Feb 2026 12:00:00 GMT</pubDate>
      </item>
    </channel></rss>`

    const items = parseRSSXml(xml)
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Block Inc slashes 40% of staff')
    // HTML should be stripped from content
    expect(items[0].content).toBe('Block is reducing from 10,000 to 6,000 employees.')
  })

  it('parses Atom feed entries', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Solana hits new ATH</title>
    <link href="https://example.com/atom/1"/>
    <id>urn:uuid:atom-1</id>
    <published>2026-02-27T09:00:00Z</published>
    <summary>Solana reached a new all-time high price today.</summary>
  </entry>
</feed>`

    const items = parseRSSXml(xml)
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Solana hits new ATH')
    expect(items[0].link).toBe('https://example.com/atom/1')
    expect(items[0].guid).toBe('urn:uuid:atom-1')
    expect(items[0].content).toBe('Solana reached a new all-time high price today.')
    expect(items[0].pubDate).toEqual(new Date('2026-02-27T09:00:00Z'))
  })

  it('decodes XML entities', () => {
    const xml = `<rss><channel>
      <item>
        <title>S&amp;P 500 &lt;rises&gt; &quot;sharply&quot;</title>
        <description>Markets &amp; more</description>
        <link>https://example.com/4</link>
        <guid>guid-4</guid>
        <pubDate>Thu, 27 Feb 2026 08:00:00 GMT</pubDate>
      </item>
    </channel></rss>`

    const items = parseRSSXml(xml)
    expect(items[0].title).toBe('S&P 500 <rises> "sharply"')
    expect(items[0].content).toBe('Markets & more')
  })

  it('handles missing optional fields gracefully', () => {
    const xml = `<rss><channel>
      <item>
        <title>Minimal item</title>
      </item>
    </channel></rss>`

    const items = parseRSSXml(xml)
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Minimal item')
    expect(items[0].content).toBe('')
    expect(items[0].link).toBeNull()
    expect(items[0].guid).toBeNull()
    expect(items[0].pubDate).toBeNull()
  })

  it('returns empty array for non-feed XML', () => {
    expect(parseRSSXml('<html><body>Not a feed</body></html>')).toEqual([])
    expect(parseRSSXml('')).toEqual([])
  })

  it('prefers content:encoded over description', () => {
    const xml = `<rss><channel>
      <item>
        <title>Full text article</title>
        <description>Short summary</description>
        <content:encoded><![CDATA[This is the full article text with much more detail.]]></content:encoded>
        <guid>guid-5</guid>
      </item>
    </channel></rss>`

    const items = parseRSSXml(xml)
    expect(items[0].content).toBe('This is the full article text with much more detail.')
  })
  it('extracts safe RSS image media without adding image to old items', () => {
    const xml = `<rss><channel>
      <item>
        <title>Thumbnail article</title>
        <media:thumbnail url="https://cdn.example.com/thumb.jpg"/>
      </item>
      <item>
        <title>Enclosure article</title>
        <enclosure url="https://cdn.example.com/article.png" type="image/png"/>
      </item>
      <item>
        <title>HTML article</title>
        <description><![CDATA[<p>Summary <img src="https://cdn.example.com/summary.webp"></p>]]></description>
      </item>
      <item><title>No image</title></item>
    </channel></rss>`

    const items = parseRSSXml(xml)
    expect(items[0].image).toBe('https://cdn.example.com/thumb.jpg')
    expect(items[1].image).toBe('https://cdn.example.com/article.png')
    expect(items[2].image).toBe('https://cdn.example.com/summary.webp')
    expect(items[3]).not.toHaveProperty('image')
  })

  it('rejects unsafe and non-image media', () => {
    const xml = `<rss><channel>
      <item>
        <title>Unsafe</title>
        <media:thumbnail url="data:image/png;base64,abc"/>
        <description><![CDATA[<img src="javascript:alert(1)">]]></description>
      </item>
      <item>
        <title>Not an image</title>
        <enclosure url="https://cdn.example.com/file.pdf" type="application/pdf"/>
        <media:content url="https://cdn.example.com/audio.mp3" medium="audio"/>
      </item>
    </channel></rss>`

    const items = parseRSSXml(xml)
    expect(items[0]).not.toHaveProperty('image')
    expect(items[1]).not.toHaveProperty('image')
  })

  it('accepts image media content and ignores non-image variants', () => {
    const xml = `<rss><channel>
      <item>
        <title>Media article</title>
        <media:content url="https://cdn.example.com/audio.mp3" medium="audio"/>
        <media:content url="https://cdn.example.com/photo.jpg" medium="image"/>
      </item>
    </channel></rss>`

    expect(parseRSSXml(xml)[0].image).toBe('https://cdn.example.com/photo.jpg')
  })

  it('does not confuse similarly named tags or attributes with the requested values', () => {
    const xml = `<rss><channel><itemish><title>Wrong</title></itemish><item>
      <title data-title="wrong">Right</title>
      <description>Body</description>
      <img-src src="https://cdn.example.com/wrong.jpg">
      <description><![CDATA[<img data-src="https://cdn.example.com/data.jpg">]]></description>
    </item></channel></rss>`

    const items = parseRSSXml(xml)
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Right')
    expect(items[0].image).toBeUndefined()
  })

})
// ==================== fetchAndParseFeed ====================

const MINIMAL_RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
  <item><title>Test</title><description>Body</description></item>
</channel></rss>`

function mockOkResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: () => Promise.resolve(body),
  } as unknown as Response
}

function mockErrorResponse(status: number, statusText: string): Response {
  return { ok: false, status, statusText, text: () => Promise.resolve('') } as unknown as Response
}

describe('fetchAndParseFeed', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns parsed items on successful fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockOkResponse(MINIMAL_RSS))
    const items = await fetchAndParseFeed('https://example.com/feed')
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Test')
  })

  it('retries once after a network failure and succeeds', async () => {
    // Patch setTimeout to execute instantly so the test doesn't wait 2s
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: any) => { fn(); return 0 as any })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(mockOkResponse(MINIMAL_RSS))

    const items = await fetchAndParseFeed('https://example.com/feed', 1)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(items).toHaveLength(1)
  })

  it('throws after all retries are exhausted', async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: any) => { fn(); return 0 as any })
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('always fails'))
    await expect(fetchAndParseFeed('https://example.com/feed', 1)).rejects.toThrow('always fails')
  })

  it('throws on HTTP error status without retrying if called with retries=0', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockErrorResponse(404, 'Not Found'))
    await expect(fetchAndParseFeed('https://example.com/feed', 0)).rejects.toThrow('404')
  })

  it('retries on HTTP error response and succeeds on second attempt', async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: any) => { fn(); return 0 as any })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockErrorResponse(503, 'Service Unavailable'))
      .mockResolvedValueOnce(mockOkResponse(MINIMAL_RSS))

    const items = await fetchAndParseFeed('https://example.com/feed', 1)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(items).toHaveLength(1)
  })
})
