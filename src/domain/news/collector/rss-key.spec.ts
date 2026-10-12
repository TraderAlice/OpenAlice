import { createServer, type Server, type ServerResponse } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RSSFeedConfig } from '../types.js'

const COLLECTION_INTERVAL_MS = 60_000
const KEY = 'rsshub-test-private-key'
const RSS_ITEM = '<?xml version="1.0"?><rss version="2.0"><channel><item><guid>article-1</guid><title>Article</title><description>Body</description></item></channel></rss>'

type Responder = (url: URL, response: ServerResponse) => void

type ManagedCollector = { stop(): void; close(): Promise<void> }
type ManagedStore = { close(): Promise<void> }

let home: string
let savedHome: string | undefined
let server: Server | undefined
let origin: string
let responder: Responder
let requests: URL[]
let collectors: ManagedCollector[]
let stores: ManagedStore[]

beforeEach(async () => {
  savedHome = process.env['OPENALICE_HOME']
  home = await mkdtemp(join(tmpdir(), 'openalice-rsshub-collector-'))
  process.env['OPENALICE_HOME'] = home
  vi.resetModules()

  requests = []
  collectors = []
  stores = []
  responder = (_url, response) => response.writeHead(404).end()
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://' + (request.headers.host ?? '127.0.0.1'))
    requests.push(new URL(url.href))
    responder(url, response)
  })
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Local RSS server did not bind a TCP port')
  origin = 'http://127.0.0.1:' + address.port
})

afterEach(async () => {
  for (const collector of collectors) {
    collector.stop()
    await collector.close()
  }
  for (const store of stores) await store.close()

  const activeServer = server
  if (activeServer?.listening) {
    await new Promise<void>((resolve, reject) => {
      activeServer.close((error) => error ? reject(error) : resolve())
    })
  }

  if (savedHome === undefined) delete process.env['OPENALICE_HOME']
  else process.env['OPENALICE_HOME'] = savedHome
  vi.resetModules()
  await rm(home, { recursive: true, force: true })
})

async function createCollector(
  feeds: RSSFeedConfig[],
  rsshubBaseUrl = origin + '/rsshub/',
  enabled = true,
) {
  const [{ NewsCollector }, { NewsCollectorStore }, { RssHubSecretStore }] = await Promise.all([
    import('./rss.js'),
    import('../store.js'),
    import('../modules/secrets.js'),
  ])
  const directory = join(home, 'data', 'news-modules')
  const store = new NewsCollectorStore({ logPath: join(directory, 'news.jsonl') })
  await store.init()
  stores.push(store)

  const collector = new NewsCollector({
    store,
    feeds,
    intervalMs: COLLECTION_INTERVAL_MS,
    rsshubBaseUrl,
    enabled,
    secrets: new RssHubSecretStore(directory),
  })
  collectors.push(collector)
  return collector
}

describe('RSSHub collector credentials', () => {
  it('adds the key only to explicit RSSHub routes, never to direct RSS URLs', async () => {
    const base = origin + '/rsshub/'
    responder = (url, response) => {
      if (url.pathname === '/rsshub/topic' || url.pathname === '/direct/feed') {
        response.writeHead(200, { 'content-type': 'application/rss+xml' }).end(RSS_ITEM)
      } else response.writeHead(404).end()
    }
    const collector = await createCollector([
      { id: 'direct', name: 'Direct feed', source: 'direct', url: origin + '/direct/feed?lang=en' },
      { id: 'route', name: 'RSSHub route', source: 'route', url: origin + '/serialized/stale', rsshubRoute: 'topic?limit=5' },
    ], base)
    await collector.updateRssHubKey('set', KEY)

    await collector.fetchAll()

    const routeRequest = requests.find((url) => url.pathname === '/rsshub/topic')
    const directRequest = requests.find((url) => url.pathname === '/direct/feed')
    expect(routeRequest?.searchParams.get('key')).toBe(KEY)
    expect(routeRequest?.searchParams.get('limit')).toBe('5')
    expect(directRequest?.searchParams.get('key')).toBeNull()
    expect(directRequest?.searchParams.get('lang')).toBe('en')
    expect(requests).toHaveLength(2)
    expect(JSON.stringify(collector.getStatus())).not.toContain(KEY)
    expect(await collector.getRssHubKeyStatus()).toEqual({
      configured: true,
      available: true,
      baseUrl: base.slice(0, -1),
    })
  })

  it('does not fall back to an anonymous request when the sealed key is damaged', async () => {
    responder = (_url, response) => response.writeHead(200, { 'content-type': 'application/rss+xml' }).end(RSS_ITEM)
    const collector = await createCollector([
      { id: 'route', name: 'RSSHub route', source: 'route', url: origin + '/stale', rsshubRoute: 'topic' },
    ])
    await collector.updateRssHubKey('set', KEY)

    const keyPath = join(home, 'data', 'news-modules', 'rsshub-key.json')
    const envelope = JSON.parse(await readFile(keyPath, 'utf8')) as { tag: string }
    envelope.tag = (envelope.tag[0] === 'A' ? 'B' : 'A') + envelope.tag.slice(1)
    await writeFile(keyPath, JSON.stringify(envelope))

    expect(await collector.fetchAll()).toEqual({ total: 0, new: 0 })
    expect(requests).toEqual([])
    expect(await collector.getRssHubKeyStatus()).toEqual({ configured: true, available: false, baseUrl: null })
    expect(collector.getStatus()).toEqual([
      expect.objectContaining({ state: 'error', lastError: 'News request, module processing or ingestion failed' }),
    ])
    expect(JSON.stringify(collector.getStatus())).not.toContain(KEY)
  })

  it('requires clearing the credential before changing the canonical RSSHub base', async () => {
    const base = origin + '/rsshub/'
    const nextBase = origin + '/other-rsshub'
    const collector = await createCollector([], base, false)
    await collector.updateRssHubKey('set', KEY)

    await expect(collector.configure({
      feeds: [],
      intervalMs: COLLECTION_INTERVAL_MS,
      rsshubBaseUrl: nextBase,
      enabled: false,
    })).rejects.toThrow('Clear the RSSHub credential before changing its instance')
    expect(await collector.getRssHubKeyStatus()).toEqual({
      configured: true,
      available: true,
      baseUrl: base.slice(0, -1),
    })

    await collector.updateRssHubKey('clear')
    await expect(collector.configure({
      feeds: [],
      intervalMs: COLLECTION_INTERVAL_MS,
      rsshubBaseUrl: nextBase,
      enabled: false,
    })).resolves.toBeUndefined()
    expect(await collector.getRssHubKeyStatus()).toEqual({ configured: false, available: true, baseUrl: null })
  })

  it('blocks redirects and keeps the query key out of error health', async () => {
    let attempts = 0
    responder = (url, response) => {
      if (url.pathname === '/rsshub/redirect') {
        attempts++
        if (attempts === 1) {
          response.writeHead(302, { location: origin + '/redirect-target?key=' + encodeURIComponent(KEY) }).end()
        } else response.writeHead(503).end('unavailable')
      } else response.writeHead(200, { 'content-type': 'application/rss+xml' }).end(RSS_ITEM)
    }
    const collector = await createCollector([
      { id: 'redirect', name: 'Redirecting RSSHub route', source: 'route', url: origin + '/stale', rsshubRoute: 'redirect' },
    ])
    await collector.updateRssHubKey('set', KEY)

    await collector.fetchAll()

    const routeRequests = requests.filter((url) => url.pathname === '/rsshub/redirect')
    const redirectRequests = requests.filter((url) => url.pathname === '/redirect-target')
    expect(routeRequests).toHaveLength(2)
    expect(routeRequests.every((url) => url.searchParams.get('key') === KEY)).toBe(true)
    expect(redirectRequests).toEqual([])
    expect(collector.getStatus()).toEqual([
      expect.objectContaining({ state: 'error', lastError: 'RSS fetch failed: 503' }),
    ])
    expect(JSON.stringify(collector.getStatus())).not.toContain(KEY)
  })
})
