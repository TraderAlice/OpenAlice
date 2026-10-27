import { createServer, type Server, type ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NewsCollector } from './rss'
import { fetchAndParseFeed } from './rss-parser'
import { NewsCollectorStore } from '../store'
import type { RSSFeedConfig } from '../types'

const COLLECTION_INTERVAL_MS = 60_000
const INVALID_RSS_WITHOUT_CHANNEL = '<rss><notChannel>notfeed</notChannel></rss>'
const HTML_ERROR_PAGE =
  '<!doctype html><html><head><title>Temporary unavailable</title></head>' +
  '<body><h1>Feed unavailable</h1><p>Please retry later.</p></body></html>'
const EMPTY_RSS = '<rss version="2.0"><channel><title>Empty feed</title></channel></rss>'
const RSS_WITH_TRAILING_COMMENT =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<rss version="2.0"><channel><item><title>Story title</title>' +
  '<guid isPermaLink="false">story-guid-1</guid></item></channel></rss>' +
  '<!-- valid trailing XML comment -->'

const REJECTED_FEED_ENVELOPES = [
  { name: 'channel only in a comment', path: '/channel-in-comment', body: '<rss><!-- <channel/> --></rss>' },
  { name: 'channel only in CDATA', path: '/channel-in-cdata', body: '<rss><![CDATA[<channel/>]]></rss>' },
  {
    name: 'channel nested under notChannel',
    path: '/nested-channel',
    body: '<rss><notChannel><channel/></notChannel></rss>',
  },
  { name: 'mismatched root closing tag', path: '/mismatched-root', body: '<rss><channel></channel></notRss>' },
  { name: 'unclosed channel', path: '/unclosed-channel', body: '<rss><channel>' },
] as const

const ACCEPTED_EMPTY_FEED_ENVELOPES = [
  { name: 'empty Atom feed', path: '/empty-atom', body: '<feed xmlns="http://www.w3.org/2005/Atom"></feed>' },
  {
    name: 'empty RDF/RSS 1.0 channel',
    path: '/empty-rss1',
    body:
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" ' +
      'xmlns="http://purl.org/rss/1.0/"><channel></channel></rdf:RDF>',
  },
  { name: 'self-closing Atom feed', path: '/self-closing-atom', body: '<feed xmlns="http://www.w3.org/2005/Atom"/>' },
  { name: 'RSS attribute with quoted greater-than', path: '/quoted-greater-than', body: '<rss version="2.0" data="left > right"><channel/></rss>' },
  {
    name: 'leading and trailing comments',
    path: '/outer-comments',
    body: '<!-- leading --><rss><channel/></rss><!-- trailing -->',
  },
] as const

type LocalResponder = (pathname: string, response: ServerResponse) => void

function sendBody(response: ServerResponse, body: string, contentType = 'application/rss+xml; charset=utf-8'): void {
  response.writeHead(200, { 'content-type': contentType })
  response.end(body)
}

describe('RSS feed HTTP response validation', () => {
  let tempDir: string
  let store: NewsCollectorStore
  let server: Server
  let origin: string
  let requests: string[]
  let collectors: NewsCollector[]
  let reply: LocalResponder

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'news-rss-response-'))
    store = new NewsCollectorStore({ logPath: join(tempDir, 'news.jsonl') })
    await store.init()
    requests = []
    collectors = []
    reply = (_pathname, response) => { response.writeHead(404).end() }

    server = createServer((request, response) => {
      const host = request.headers.host ?? '127.0.0.1'
      const pathname = new URL(request.url ?? '/', 'http://' + host).pathname
      requests.push(pathname)
      reply(pathname, response)
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Local feed server did not bind a TCP port')
    origin = 'http://127.0.0.1:' + address.port
  })

  afterEach(async () => {
    for (const collector of collectors) collector.stop()
    await new Promise<void>((resolve, reject) => {
      if (!server.listening) {
        resolve()
        return
      }
      server.close((error) => error ? reject(error) : resolve())
    })
    await store.close()
    await rm(tempDir, { recursive: true, force: true })
  })

  function createCollector(feeds: RSSFeedConfig[]): NewsCollector {
    const collector = new NewsCollector({
      store,
      feeds,
      intervalMs: COLLECTION_INTERVAL_MS,
      enabled: true,
    })
    collectors.push(collector)
    return collector
  }

  it('rejects an RSS root that contains no channel', async () => {
    reply = (_pathname, response) => sendBody(response, INVALID_RSS_WITHOUT_CHANNEL)

    await expect(fetchAndParseFeed(origin + '/no-channel', 0)).rejects.toThrow(/^RSS response failed:/)
    expect(requests).toEqual(['/no-channel'])
  })

  it.each(REJECTED_FEED_ENVELOPES)('rejects a body without a valid supported envelope: $name', async ({ path, body }) => {
    reply = (_pathname, response) => sendBody(response, body)

    await expect(fetchAndParseFeed(origin + path, 0)).rejects.toThrow(/^RSS response failed:/)
    expect(requests).toEqual([path])
  })

  it.each(ACCEPTED_EMPTY_FEED_ENVELOPES)('accepts a supported empty feed envelope: $name', async ({ path, body }) => {
    reply = (_pathname, response) => sendBody(response, body)

    await expect(fetchAndParseFeed(origin + path, 0)).resolves.toEqual([])
    expect(requests).toEqual([path])
  })

  it('rejects an HTML error page returned with HTTP 200', async () => {
    reply = (_pathname, response) => sendBody(response, HTML_ERROR_PAGE, 'text/html; charset=utf-8')

    await expect(fetchAndParseFeed(origin + '/html-error', 0)).rejects.toThrow(/^RSS response failed:/)
    expect(requests).toEqual(['/html-error'])
  })

  it('accepts an RSS channel with no items', async () => {
    reply = (_pathname, response) => sendBody(response, EMPTY_RSS)

    await expect(fetchAndParseFeed(origin + '/empty', 0)).resolves.toEqual([])
  })

  it('parses a valid RSS item followed by a legal trailing XML comment', async () => {
    reply = (_pathname, response) => sendBody(response, RSS_WITH_TRAILING_COMMENT)

    const items = await fetchAndParseFeed(origin + '/trailing-comment', 0)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ title: 'Story title', guid: 'story-guid-1' })
  })

  it('marks an invalid HTTP 200 feed response as an error instead of healthy', async () => {
    reply = (_pathname, response) => sendBody(response, INVALID_RSS_WITHOUT_CHANNEL)
    const collector = createCollector([{
      id: 'invalid-feed',
      name: 'Invalid feed',
      source: 'invalid-feed-source',
      url: origin + '/collector-feed',
    }])

    await expect(collector.fetchAll()).resolves.toEqual({ total: 0, new: 0 })

    const status = collector.getStatus()[0]
    expect(status).toMatchObject({
      state: 'error',
      lastSuccessAt: null,
      lastItemCount: null,
      lastNewItemCount: null,
    })
    expect(status?.lastError).toMatch(/^RSS response failed:/)
    expect(await store.getNewsV2({ endTime: new Date(Date.now() + 60_000) })).toEqual([])
    expect(requests).toContain('/collector-feed')
  })
})
