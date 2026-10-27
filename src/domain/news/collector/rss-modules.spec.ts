import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewsCollector } from './rss.js'
import { NewsCollectorStore } from '../store.js'
import { createNewsArchiveTools } from '../query/archive.js'
import { NewsModuleManager } from '../modules/manager.js'
import type { ModuleSelection, NewsModuleArtifact, NewsSubscription } from '../modules/contract.js'
import type { NewsRecord, RSSFeedConfig } from '../types.js'

const intervalMs = 60_000
const launch = { command: process.env.OPENALICE_NEWS_TEST_NODE ?? process.execPath, args: ['--conditions=openalice-source', '--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../modules/worker-entry.ts', import.meta.url))] }
const article = (externalId: string, title = externalId) => ({ externalId, title, content: 'Producer content: ' + title, url: 'https://example.test/' + externalId, publishedAt: new Date().toISOString() })
const subscription = (moduleId: string): NewsSubscription => ({ id: moduleId + '-latest', moduleId, sourceKey: 'latest', name: moduleId, source: moduleId + '-source', enabled: true, params: {}, categories: ['market', 'research'] })
const configuration = (modules: ModuleSelection[], subscriptions: NewsSubscription[], feeds: RSSFeedConfig[] = [], enabled = true) => ({ feeds, modules, subscriptions, intervalMs, enabled })

let home: string
let logPath: string
let store: NewsCollectorStore
let manager: NewsModuleManager
let collectors: NewsCollector[]

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'news-collector-modules-'))
  logPath = join(home, 'news.jsonl')
  store = new NewsCollectorStore({ logPath })
  await store.init()
  manager = new NewsModuleManager({ directory: join(home, 'modules'), launch })
  collectors = []
})
afterEach(async () => {
  try {
    for (const collector of collectors) await collector.close()
    await manager.close()
    await store.close()
  } finally {
    await rm(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
  }
})

async function install(moduleId: string, version: string, body: string): Promise<ModuleSelection> {
  const artifact: NewsModuleArtifact = {
    manifest: { abiVersion: 1, moduleId, version, name: moduleId, description: '', entry: 'entry.mjs', sources: [{ key: 'latest', name: 'Latest', parameters: [] }] },
    files: { 'entry.mjs': `export const newsModule = { abiVersion: 1, moduleId: ${JSON.stringify(moduleId)}, version: ${JSON.stringify(version)}, async collect(input) { ${body} } }` },
  }
  const installed = await manager.importArtifact(artifact)
  await manager.approve(installed.contentHash)
  return { moduleId, contentHash: installed.contentHash, enabled: true }
}
function collector(modules: ModuleSelection[], subscriptions: NewsSubscription[], feeds: RSSFeedConfig[] = [], enabled = true) {
  const instance = new NewsCollector({ store, manager, ...configuration(modules, subscriptions, feeds, enabled) })
  collectors.push(instance)
  return instance
}
async function records(): Promise<NewsRecord[]> {
  try { return (await readFile(logPath, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as NewsRecord) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
}

// Every fixture is an actual approved .mjs artifact loaded by a separate worker process.
describe('collector integration with news modules', () => {
  it('appends producer content to JSONL and deduplicates module ID + external ID across versions, not across modules', async () => {
    const row = subscription('fixture.alpha')
    const first = await install(row.moduleId, '1', `return [${JSON.stringify(article('shared', 'Original headline'))}]`)
    await manager.configure([first], [row])
    const instance = collector([first], [row])
    expect(await instance.fetchAll()).toEqual({ total: 1, new: 1 })
    expect(await records()).toMatchObject([{ title: 'Original headline', content: 'Producer content: Original headline', metadata: { moduleVersion: '1', externalId: 'shared', contentHash: first.contentHash } }])

    const second = await install(row.moduleId, '2', `return [${JSON.stringify(article('shared', 'Revised headline'))}]`)
    await instance.configure(configuration([second], [row]))
    await instance.fetchAll()
    expect(await records()).toHaveLength(1)

    const otherRow = subscription('fixture.beta')
    const other = await install(otherRow.moduleId, '1', `return [${JSON.stringify(article('shared', 'Other producer'))}]`)
    await instance.configure(configuration([second, other], [row, otherRow]))
    await instance.fetchAll()
    const saved = await records()
    expect(saved).toHaveLength(2)
    expect(saved.map(record => record.title)).toEqual(['Original headline', 'Other producer'])
    expect(saved[0].dedupKey).not.toBe(saved[1].dedupKey)
    expect(saved[1].metadata).toMatchObject({ moduleId: 'fixture.beta', externalId: 'shared', contentHash: other.contentHash })
  }, 60_000)

  it.each([
    ['last item uses a forbidden URL', (valid: ReturnType<typeof article>) => ({ ...valid, url: 'file:///private' })],
    ['last item has an invalid date', (valid: ReturnType<typeof article>) => ({ ...valid, publishedAt: 'not-a-date' })],
    ['first item has an empty cleaned title', (valid: ReturnType<typeof article>) => ({ ...valid, title: '<b></b>' })],
  ])('rejects the entire batch before any append when %s', async (_name, invalid) => {
    const row = subscription('fixture.invalid')
    const good = article('good', 'Valid first')
    const bad = invalid(article('bad', 'Valid second'))
    const batch = _name.startsWith('first') ? [bad, good] : [good, bad]
    const selection = await install(row.moduleId, '1', `return ${JSON.stringify(batch)}`)
    await manager.configure([selection], [row])
    const instance = collector([selection], [row])
    expect(await instance.fetchAll()).toEqual({ total: 0, new: 0 })
    expect(await records()).toEqual([])
    expect(store.count).toBe(0)
    expect(instance.getStatus()).toMatchObject([{ state: 'error' }])
  }, 30_000)

  it('keeps archive reading available while disabled without invoking the producer', async () => {
    const marker = join(home, 'collect-count.txt')
    const row = subscription('fixture.archive')
    const selection = await install(row.moduleId, '1', `const fs = await import('node:fs'); fs.writeFileSync(${JSON.stringify(marker)}, String(Number(fs.existsSync(${JSON.stringify(marker)}) ? fs.readFileSync(${JSON.stringify(marker)}, 'utf8') : 0) + 1)); return [${JSON.stringify(article('archive', 'Archived module news'))}]`)
    await manager.configure([selection], [row])
    const instance = collector([selection], [row])
    await instance.fetchAll()
    const [saved] = await records()
    expect(saved.title).toBe('Archived module news')
    await instance.configure(configuration([selection], [row], [], false))
    const before = await readFile(marker, 'utf8')
    expect(await instance.fetchAll()).toEqual({ total: 0, new: 0 })
    const tools = createNewsArchiveTools(store)
    expect(await tools.globRss.execute!({ pattern: 'Archived module news' }, { toolCallId: 'archive', messages: [] })).toMatchObject([{ id: saved.seq }])
    expect(await tools.readRss.execute!({ id: saved.seq }, { toolCallId: 'archive', messages: [] })).toMatchObject({ content: 'Producer content: Archived module news' })
    expect(await readFile(marker, 'utf8')).toBe(before)
    expect(instance.getStatus()).toMatchObject([{ state: 'disabled' }])
  }, 35_000)

  it('persists distinct RSS and module provenance, source and categories from real producers', async () => {
    const server: Server = createServer((_request, response) => response.writeHead(200, { 'content-type': 'application/rss+xml' }).end('<?xml version="1.0"?><rss version="2.0"><channel><item><guid>rss-unique</guid><title>Feed story</title><description>Feed body</description></item></channel></rss>'))
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('RSS server has no TCP port')
      const feed: RSSFeedConfig = { id: 'feed', name: 'Feed', source: 'rss-source', categories: ['feed-only'], url: `http://127.0.0.1:${address.port}/rss` }
      const row = subscription('fixture.provenance')
      const selection = await install(row.moduleId, '3', `return [${JSON.stringify(article('module-unique', 'Module story'))}]`)
      await manager.configure([selection], [row])
      await collector([selection], [row], [feed]).fetchAll()
      const saved = await records()
      expect(saved).toHaveLength(2)
      expect(saved.find(record => record.title === 'Feed story')?.metadata).toMatchObject({ ingestSource: 'rss', source: 'rss-source', producerId: 'builtin.rss', categories: 'feed-only', guid: 'rss-unique' })
      expect(saved.find(record => record.title === 'Module story')?.metadata).toMatchObject({ ingestSource: 'module', source: 'fixture.provenance-source', moduleId: row.moduleId, moduleVersion: '3', subscriptionId: row.id, categories: 'market,research', externalId: 'module-unique' })
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  }, 35_000)

  it('waits for in-flight module collection before switching producer selection', async () => {
    const entered = join(home, 'entered')
    const release = join(home, 'release')
    const row = subscription('fixture.switch')
    const old = await install(row.moduleId, '1', `const fs = await import('node:fs'); fs.writeFileSync(${JSON.stringify(entered)}, 'entered'); while (!fs.existsSync(${JSON.stringify(release)})) await new Promise(resolve => setTimeout(resolve, 10)); return [${JSON.stringify(article('old', 'Old in-flight story'))}]`)
    const next = await install(row.moduleId, '2', `return [${JSON.stringify(article('new', 'New selection story'))}]`)
    await manager.configure([old], [row])
    const instance = collector([old], [row])
    const fetching = instance.fetchAll()
    let configuring: Promise<void> | undefined
    try {
      await vi.waitFor(() => expect(existsSync(entered)).toBe(true), { timeout: 5000 })
      configuring = instance.configure(configuration([next], [row]))
      expect(await Promise.race([configuring.then(() => 'configured'), new Promise(resolve => setImmediate(() => resolve('waiting')))])).toBe('waiting')
    } finally {
      await writeFile(release, 'released')
    }
    await fetching
    await configuring
    await instance.fetchAll()
    expect((await records()).map(record => record.title)).toEqual(['Old in-flight story', 'New selection story'])
    expect((await manager.list()).find(status => status.contentHash === next.contentHash)).toMatchObject({ loaded: true, state: 'running' })
  }, 45_000)

  it('does not publish rejected configuration and restarts the previous approved worker', async () => {
    const oldRow = subscription('fixture.stable')
    const newRow = subscription('fixture.candidate')
    const old = await install(oldRow.moduleId, '1', `return [${JSON.stringify(article('old', 'Old approved story'))}]`)
    const candidate = await install(newRow.moduleId, '1', `return [${JSON.stringify(article('candidate', 'Never published story'))}]`)
    await manager.configure([old], [oldRow])
    const instance = collector([old], [oldRow])
    await instance.fetchAll()
    await expect(instance.configure(configuration([candidate], [newRow]), async () => { throw new Error('persist rejected') })).rejects.toThrow('persist rejected')
    expect(instance.getStatus()).toMatchObject([{ moduleId: oldRow.moduleId }])
    expect(await manager.list()).toEqual(expect.arrayContaining([expect.objectContaining({ contentHash: old.contentHash, loaded: true, state: 'running' })]))
    await instance.fetchAll()
    expect((await records()).map(record => record.title)).toEqual(['Old approved story'])
    expect((await records()).every(record => record.metadata.moduleId === oldRow.moduleId)).toBe(true)
  }, 45_000)

  it('rejects a fresh collection after closing the collector', async () => {
    const instance = collector([], [])
    await instance.close()
    await expect(instance.fetchAll()).rejects.toThrow(/closed/i)
  })

  it('retries the identical module article successfully after a real append failure', async () => {
    const row = subscription('fixture.retry')
    const selection = await install(row.moduleId, '1', `return [${JSON.stringify(article('retry', 'Retry after failure'))}]`)
    await manager.configure([selection], [row])
    const instance = collector([selection], [row])
    // A directory at the JSONL path makes the real filesystem append reject (EISDIR).
    await mkdir(logPath)
    expect(await instance.fetchAll()).toEqual({ total: 1, new: 0 })
    expect(store.count).toBe(0)
    expect(instance.getStatus()).toMatchObject([{ state: 'error' }])
    await rm(logPath, { recursive: true })
    expect(await instance.fetchAll()).toEqual({ total: 1, new: 1 })
    expect(await records()).toMatchObject([{ title: 'Retry after failure', metadata: { externalId: 'retry' } }])
  }, 35_000)
})
