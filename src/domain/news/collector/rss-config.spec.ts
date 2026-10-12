import { createServer, type Server, type ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewsCollector } from './rss'
import { NewsCollectorStore } from '../store'
import type { RSSFeedConfig } from '../types'

const COLLECTION_INTERVAL_MS = 60_000

type LocalResponder = (pathname: string, response: ServerResponse) => void

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function rssItem(guid: string, title: string): string {
  return (
    '<?xml version="1.0"?><rss version="2.0"><channel><item><guid>' +
    guid +
    '</guid><title>' +
    title +
    '</title><description>' +
    title +
    ' body</description></item></channel></rss>'
  )
}

function sendFeed(response: ServerResponse, body: string): void {
  response.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' })
  response.end(body)
}

describe('NewsCollector RSS configuration', () => {
  let tempDir: string
  let store: NewsCollectorStore
  let server: Server
  let origin: string
  let requests: string[]
  let collectors: NewsCollector[]
  let reply: LocalResponder

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'news-rss-config-'))
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

  function createCollector(
    feeds: RSSFeedConfig[],
    options: { rsshubBaseUrl?: string; enabled?: boolean } = {},
  ): NewsCollector {
    const collector = new NewsCollector({
      store,
      feeds,
      intervalMs: COLLECTION_INTERVAL_MS,
      ...options,
    })
    collectors.push(collector)
    return collector
  }

  function config(feeds: RSSFeedConfig[], enabled: boolean, rsshubBaseUrl?: string) {
    return {
      feeds,
      intervalMs: COLLECTION_INTERVAL_MS,
      enabled,
      ...(rsshubBaseUrl === undefined ? {} : { rsshubBaseUrl }),
    }
  }

  async function storedItems() {
    return store.getNewsV2({ endTime: new Date(Date.now() + 60_000) })
  }

  async function waitForItem(title: string): Promise<void> {
    await vi.waitFor(async () => {
      const items = await storedItems()
      expect(items.some((item) => item.title === title)).toBe(true)
    })
  }

  it('keeps direct URLs fixed while an RSSHub route follows a changed base instead of its stale URL', async () => {
    const feeds: RSSFeedConfig[] = [
      { id: 'direct', name: 'Direct', source: 'direct-source', url: origin + '/direct/feed' },
      {
        id: 'route',
        name: 'Routed',
        source: 'route-source',
        url: origin + '/serialized/stale',
        rsshubRoute: 'route',
      },
    ]
    reply = (pathname, response) => {
      const items: Record<string, string> = {
        '/direct/feed': rssItem('direct-item', 'Direct article'),
        '/base-old/route': rssItem('route-old-item', 'Route from old base'),
        '/base-new/route': rssItem('route-new-item', 'Route from new base'),
        '/serialized/stale': rssItem('stale-item', 'Stale serialized URL'),
      }
      const body = items[pathname]
      if (body) sendFeed(response, body)
      else response.writeHead(404).end()
    }

    const collector = createCollector(feeds, { rsshubBaseUrl: origin + '/base-old/', enabled: true })
    await collector.fetchAll()
    expect(requests).toContain('/direct/feed')
    expect(requests).toContain('/base-old/route')

    await collector.configure(config(feeds, true, origin + '/base-new/'))
    await waitForItem('Route from new base')

    expect(requests.filter((pathname) => pathname === '/direct/feed')).toHaveLength(2)
    expect(requests).toContain('/base-new/route')
    expect(requests).not.toContain('/serialized/stale')
  })

  it('waits for an in-flight old-source request before switching to only the new source', async () => {
    const oldRequestStarted = deferred()
    const releaseOldResponse = deferred()
    const oldFeed: RSSFeedConfig = {
      id: 'old',
      name: 'Old source',
      source: 'old-source',
      url: origin + '/old/feed',
    }
    const newFeed: RSSFeedConfig = {
      id: 'new',
      name: 'New source',
      source: 'new-source',
      url: origin + '/new/feed',
    }
    reply = (pathname, response) => {
      if (pathname === '/old/feed') {
        oldRequestStarted.resolve()
        void releaseOldResponse.promise.then(() => sendFeed(response, rssItem('old-item', 'Old in-flight article')))
      } else if (pathname === '/new/feed') {
        sendFeed(response, rssItem('new-item', 'New source article'))
      } else {
        response.writeHead(404).end()
      }
    }

    const collector = createCollector([oldFeed], { enabled: true })
    const oldPass = collector.fetchAll()
    let configurePromise: Promise<void> | undefined
    let oldItemsAtConfigureResolution = -1
    try {
      await oldRequestStarted.promise
      configurePromise = collector.configure(config([newFeed], true)).then(async () => {
        const items = await storedItems()
        oldItemsAtConfigureResolution = items.filter((item) => item.metadata.source === 'old-source').length
      })
      const beforeOldResponse = await Promise.race([
        configurePromise.then(() => 'configured' as const),
        new Promise<'still-waiting'>((resolve) => setImmediate(() => resolve('still-waiting'))),
      ])
      expect(beforeOldResponse).toBe('still-waiting')

      releaseOldResponse.resolve()
      await configurePromise
      expect(oldItemsAtConfigureResolution).toBe(1)
      const oldRequestsAtConfigureResolution = requests.filter((pathname) => pathname === '/old/feed').length

      await waitForItem('New source article')
      const items = await storedItems()
      expect(items.filter((item) => item.metadata.source === 'old-source')).toHaveLength(oldItemsAtConfigureResolution)
      expect(requests.filter((pathname) => pathname === '/old/feed')).toHaveLength(oldRequestsAtConfigureResolution)
      expect(collector.getStatus().map((status) => status.source)).toEqual(['new-source'])
    } finally {
      releaseOldResponse.resolve()
      await oldPass
      if (configurePromise) await configurePromise
    }
  })

  it('does no explicit fetch work while disabled and collects the edited source after re-enabling', async () => {
    const originalFeed: RSSFeedConfig = {
      id: 'original',
      name: 'Original source',
      source: 'original-source',
      url: origin + '/original/feed',
    }
    const editedFeed: RSSFeedConfig = {
      id: 'edited',
      name: 'Edited source',
      source: 'edited-source',
      url: origin + '/edited/feed',
    }
    reply = (pathname, response) => {
      if (pathname === '/edited/feed') sendFeed(response, rssItem('edited-item', 'Edited source article'))
      else if (pathname === '/original/feed') sendFeed(response, rssItem('original-item', 'Original source article'))
      else response.writeHead(404).end()
    }

    const collector = createCollector([originalFeed], { enabled: true })
    await collector.configure(config([originalFeed], false))
    expect(await collector.fetchAll()).toEqual({ total: 0, new: 0 })
    expect(requests).toEqual([])

    await collector.configure(config([editedFeed], true))
    await waitForItem('Edited source article')
    expect(requests).toEqual(['/edited/feed'])
    expect(collector.getStatus().map((status) => status.source)).toEqual(['edited-source'])
  })

  it('preserves the last successful status across HTTP failure and counts duplicate feed items', async () => {
    const feed: RSSFeedConfig = {
      id: 'status',
      name: 'Status feed',
      source: 'status-source',
      url: origin + '/status/feed',
    }
    let failing = false
    reply = (pathname, response) => {
      if (pathname !== '/status/feed') {
        response.writeHead(404).end()
      } else if (failing) {
        response.writeHead(503).end('unavailable')
      } else {
        sendFeed(response, rssItem('status-item', 'Status article'))
      }
    }

    const collector = createCollector([feed], { enabled: true })
    await collector.fetchAll()
    const successful = collector.getStatus().find((status) => status.source === 'status-source')
    expect(successful).toMatchObject({ lastItemCount: 1, lastNewItemCount: 1 })
    expect(successful?.lastSuccessAt).toBeTruthy()

    failing = true
    await collector.fetchAll()
    const failed = collector.getStatus().find((status) => status.source === 'status-source')
    expect(failed?.lastSuccessAt).toEqual(successful?.lastSuccessAt)
    expect(failed).toMatchObject({ lastItemCount: 1, lastNewItemCount: 1 })
    expect(failed?.lastError).toBeTruthy()

    failing = false
    expect(await collector.fetchAll()).toEqual({ total: 1, new: 0 })
    const duplicate = collector.getStatus().find((status) => status.source === 'status-source')
    expect(duplicate).toMatchObject({ lastItemCount: 1, lastNewItemCount: 0 })
  })
  it('does not carry health over when a source changes with the same feed ID and URL', async () => {
    const originalFeed: RSSFeedConfig = {
      id: 'shared-feed',
      name: 'Original source',
      source: 'original-source',
      url: origin + '/shared/feed',
    }
    let failing = false
    reply = (pathname, response) => {
      if (pathname !== '/shared/feed') {
        response.writeHead(404).end()
      } else if (failing) {
        response.writeHead(503).end('unavailable')
      } else {
        sendFeed(response, rssItem('shared-item', 'Original source article'))
      }
    }

    const collector = createCollector([originalFeed], { enabled: true })
    await collector.fetchAll()
    const originalStatus = collector.getStatus().find((status) => status.source === 'original-source')
    expect(originalStatus).toMatchObject({
      state: 'healthy',
      lastAttemptAt: expect.any(Number),
      lastSuccessAt: expect.any(Number),
      lastItemCount: 1,
      lastNewItemCount: 1,
      lastError: null,
    })
    expect((await storedItems()).map(({ title, metadata }) => ({ title, source: metadata.source }))).toEqual([
      { title: 'Original source article', source: 'original-source' },
    ])

    failing = true
    const changedFeed: RSSFeedConfig = { ...originalFeed, source: 'new-source' }
    await collector.configure(config([changedFeed], true))
    expect(await collector.fetchAll()).toEqual({ total: 0, new: 0 })

    expect(collector.getStatus()).toEqual([
      expect.objectContaining({
        id: 'shared-feed',
        source: 'new-source',
        url: origin + '/shared/feed',
        state: 'error',
        lastAttemptAt: expect.any(Number),
        lastSuccessAt: null,
        lastItemCount: null,
        lastNewItemCount: null,
        lastError: expect.stringMatching(/^RSS fetch failed: 503\b/),
      }),
    ])
    expect((await storedItems()).map(({ title, metadata }) => ({ title, source: metadata.source }))).toEqual([
      { title: 'Original source article', source: 'original-source' },
    ])
  })

  it('retains health after an interval-only edit recreates a legacy feed without an ID', async () => {
    const legacyFeed: RSSFeedConfig = {
      name: 'Legacy feed',
      source: 'legacy-source',
      url: origin + '/legacy/feed',
    }
    let failing = false
    reply = (pathname, response) => {
      if (pathname !== '/legacy/feed') {
        response.writeHead(404).end()
      } else if (failing) {
        response.writeHead(503).end('unavailable')
      } else {
        sendFeed(response, rssItem('legacy-item', 'Legacy article'))
      }
    }

    const collector = createCollector([legacyFeed], { enabled: true })
    await collector.fetchAll()
    const successful = collector.getStatus().find((status) => status.source === 'legacy-source')
    expect(successful).toMatchObject({
      id: undefined,
      state: 'healthy',
      lastAttemptAt: expect.any(Number),
      lastSuccessAt: expect.any(Number),
      lastItemCount: 1,
      lastNewItemCount: 1,
      lastError: null,
    })
    expect((await storedItems()).map(({ title, metadata }) => ({ title, source: metadata.source }))).toEqual([
      { title: 'Legacy article', source: 'legacy-source' },
    ])

    failing = true
    const recreatedFeed: RSSFeedConfig = { ...legacyFeed }
    await collector.configure({
      feeds: [recreatedFeed],
      intervalMs: COLLECTION_INTERVAL_MS + 1,
      enabled: true,
    })
    expect(await collector.fetchAll()).toEqual({ total: 0, new: 0 })

    expect(collector.getStatus()).toEqual([
      expect.objectContaining({
        id: undefined,
        source: 'legacy-source',
        url: origin + '/legacy/feed',
        state: 'error',
        lastAttemptAt: expect.any(Number),
        lastSuccessAt: successful?.lastSuccessAt,
        lastItemCount: 1,
        lastNewItemCount: 1,
        lastError: expect.stringMatching(/^RSS fetch failed: 503\b/),
      }),
    ])
    expect((await storedItems()).map(({ title, metadata }) => ({ title, source: metadata.source }))).toEqual([
      { title: 'Legacy article', source: 'legacy-source' },
    ])
  })

  it('resets ambiguous no-ID duplicate health histories after reconfiguration', async () => {
    const firstFeed: RSSFeedConfig = {
      name: 'First legacy source',
      source: 'ambiguous-source',
      url: origin + '/ambiguous/feed',
    }
    const secondFeed: RSSFeedConfig = {
      name: 'Second legacy source',
      source: 'ambiguous-source',
      url: origin + '/ambiguous/feed',
    }
    reply = (pathname, response) => {
      if (pathname === '/ambiguous/feed') sendFeed(response, rssItem('ambiguous-item', 'Ambiguous article'))
      else response.writeHead(404).end()
    }

    const collector = createCollector([firstFeed, secondFeed], { enabled: true })
    expect(await collector.fetchAll()).toEqual({ total: 2, new: 1 })
    expect(collector.getStatus().map((status) => ({
      name: status.name,
      state: status.state,
      lastSuccessAt: status.lastSuccessAt,
      lastItemCount: status.lastItemCount,
      lastNewItemCount: status.lastNewItemCount,
      lastError: status.lastError,
    }))).toEqual([
      {
        name: 'First legacy source',
        state: 'healthy',
        lastSuccessAt: expect.any(Number),
        lastItemCount: 1,
        lastNewItemCount: 1,
        lastError: null,
      },
      {
        name: 'Second legacy source',
        state: 'healthy',
        lastSuccessAt: expect.any(Number),
        lastItemCount: 1,
        lastNewItemCount: 0,
        lastError: null,
      },
    ])
    expect((await storedItems()).map(({ title, metadata }) => ({ title, source: metadata.source }))).toEqual([
      { title: 'Ambiguous article', source: 'ambiguous-source' },
    ])

    reply = (pathname, response) => {
      if (pathname === '/ambiguous/feed') response.writeHead(503).end('unavailable')
      else response.writeHead(404).end()
    }
    await collector.configure(config([{ ...firstFeed }, { ...secondFeed }], true))
    expect(await collector.fetchAll()).toEqual({ total: 0, new: 0 })

    expect(collector.getStatus()).toEqual([
      expect.objectContaining({
        id: undefined,
        name: 'First legacy source',
        source: 'ambiguous-source',
        url: origin + '/ambiguous/feed',
        state: 'error',
        lastAttemptAt: expect.any(Number),
        lastSuccessAt: null,
        lastItemCount: null,
        lastNewItemCount: null,
        lastError: expect.stringMatching(/^RSS fetch failed: 503\b/),
      }),
      expect.objectContaining({
        id: undefined,
        name: 'Second legacy source',
        source: 'ambiguous-source',
        url: origin + '/ambiguous/feed',
        state: 'error',
        lastAttemptAt: expect.any(Number),
        lastSuccessAt: null,
        lastItemCount: null,
        lastNewItemCount: null,
        lastError: expect.stringMatching(/^RSS fetch failed: 503\b/),
      }),
    ])
    expect((await storedItems()).map(({ title, metadata }) => ({ title, source: metadata.source }))).toEqual([
      { title: 'Ambiguous article', source: 'ambiguous-source' },
    ])
  }, 10_000) // Two sequential failed feeds each retain the real 2s retry delay.

  it('preserves last success through master disable and re-enable before an HTTP failure', async () => {
    const feed: RSSFeedConfig = {
      id: 'master-toggle',
      name: 'Master toggle feed',
      source: 'master-toggle-source',
      url: origin + '/master-toggle/feed',
    }
    let failing = false
    reply = (pathname, response) => {
      if (pathname !== '/master-toggle/feed') response.writeHead(404).end()
      else if (failing) response.writeHead(503).end('unavailable')
      else sendFeed(response, rssItem('master-toggle-item', 'Master toggle article'))
    }

    const collector = createCollector([feed], { enabled: true })
    await collector.fetchAll()
    const successful = collector.getStatus()[0]
    expect(successful).toMatchObject({
      id: 'master-toggle',
      source: 'master-toggle-source',
      state: 'healthy',
      lastAttemptAt: expect.any(Number),
      lastSuccessAt: expect.any(Number),
      lastItemCount: 1,
      lastNewItemCount: 1,
      lastError: null,
    })
    expect((await storedItems()).map(({ title, metadata }) => ({ title, source: metadata.source }))).toEqual([
      { title: 'Master toggle article', source: 'master-toggle-source' },
    ])

    await collector.configure(config([{ ...feed }], false))
    expect(await collector.fetchAll()).toEqual({ total: 0, new: 0 })
    expect(requests).toEqual(['/master-toggle/feed'])
    expect(collector.getStatus()).toEqual([
      expect.objectContaining({
        id: 'master-toggle',
        source: 'master-toggle-source',
        url: origin + '/master-toggle/feed',
        state: 'disabled',
        lastAttemptAt: successful?.lastAttemptAt,
        lastSuccessAt: successful?.lastSuccessAt,
        lastItemCount: 1,
        lastNewItemCount: 1,
        lastError: null,
      }),
    ])

    failing = true
    await collector.configure(config([{ ...feed }], true))
    expect(await collector.fetchAll()).toEqual({ total: 0, new: 0 })

    expect(collector.getStatus()).toEqual([
      expect.objectContaining({
        id: 'master-toggle',
        source: 'master-toggle-source',
        url: origin + '/master-toggle/feed',
        state: 'error',
        lastAttemptAt: expect.any(Number),
        lastSuccessAt: successful?.lastSuccessAt,
        lastItemCount: 1,
        lastNewItemCount: 1,
        lastError: expect.stringMatching(/^RSS fetch failed: 503\b/),
      }),
    ])
    expect((await storedItems()).map(({ title, metadata }) => ({ title, source: metadata.source }))).toEqual([
      { title: 'Master toggle article', source: 'master-toggle-source' },
    ])
  })

})
