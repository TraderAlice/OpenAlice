import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NewsStoryStore } from '../../../src/domain/news/stories.js'
import type { INewsProvider } from '../../../src/domain/news/types.js'
import type { EngineContext } from '../../../src/core/types.js'
import { createNewsRoutes } from '../../../src/webui/routes/news.js'
import { createNewsReadingTools } from '../../../src/domain/news/query/reading.js'

const original = { id: 1, time: new Date('2026-10-24T01:00:00Z'), title: 'Port closed after storm', content: 'The port authority announced a closure; reopening time is unknown.', metadata: { source: 'Port authority', link: 'https://example.test/port' } }
const originals = [original, { ...original, id: 2 }, { ...original, id: 3 }]
const provider: INewsProvider = { getNewsV2: async () => originals, getNewsById: async id => originals.find(item => item.id === id) ?? null }
const event = () => ({ version: 1, id: 'port-closure', revision: 1, title: 'Storm closes port', summary: 'The authority announced a closure.', reason: 'Shipping disruption is a possible transmission path; its market effect is not established.', importance: { level: 'normal', reason: 'The closure is documented; material impact is not yet established.', reportIds: [1] }, transmission: null, topics: ['shipping', 'weather'], symbols: [], selected: false, status: 'watching', updatedAt: '2026-10-24T01:01:00Z', preparedBy: 'Native agent', overviewReportIds: [1], developments: [{ id: 'closure', time: '2026-10-24T01:00:00Z', title: 'Closure announced', summary: 'Reopening time is unknown.', reportIds: [1] }] })
const call = { toolCallId: 'test', messages: [] }
const homes: string[] = []
afterEach(async () => { await Promise.all(homes.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'news-reading-tools-'))
  homes.push(home)
  const store = new NewsStoryStore(provider, home)
  return { home, store, tools: createNewsReadingTools(store) }
}

describe('native-agent event publication', { timeout: process.platform === 'win32' ? 60_000 : 5_000 }, () => {
  it('publishes an automatically assessed non-ticker event into Important through the native tool and HTTP reader', async () => {
    const { store, tools } = await setup()
    const importance = { level: 'important', reason: 'A confirmed port closure can interrupt supply; its scale remains unknown.', reportIds: [1] }
    const transmission = { steps: ['Port closure', 'Shipping', 'Delivery costs'], condition: 'If the closure persists; a price effect is not established.', reportIds: [1] }
    await tools.publishNewsStory.execute!({ artifact: JSON.stringify({ ...event(), importance, transmission }) }, call)
    const app = createNewsRoutes({ newsProvider: provider, newsStories: store } as unknown as EngineContext)
    const response = await (await app.request('/?includeStories=true&important=true')).json()
    expect(response.stories).toHaveLength(1)
    expect(response.stories[0]).toMatchObject({ selected: false, symbols: [], importance, transmission, reading: { important: true, publishers: 1 } })
    expect((await (await app.request('/?includeStories=true&keyword=Delivery%20costs')).json()).stories).toHaveLength(1)
    expect((await (await app.request('/stories/port-closure')).json()).importance.reportIds).toEqual([1])
    const unassessed = { ...event(), importance: undefined, id: 'unassessed', developments: [{ ...event().developments[0], reportIds: [2] }], overviewReportIds: [2] }
    await expect(tools.publishNewsStory.execute!({ artifact: JSON.stringify(unassessed) }, call)).rejects.toThrow(/importance/i)
  })
  it('projects same-fact identity into the raw feed and marks conflicting assignments ambiguous', async () => {
    const { store } = await setup()
    const value = event()
    await store.publish({ ...value, overviewReportIds: [1, 3], developments: [
      { ...value.developments[0], reportIds: [1, 2] },
      { ...value.developments[0], id: 'reopening', title: 'Reopening announced', reportIds: [3] },
    ] })
    expect(Object.fromEntries(await store.reportOccurrences([1, 2, 3, 99]))).toEqual({
      1: { storyId: 'port-closure', developmentId: 'closure' },
      2: { storyId: 'port-closure', developmentId: 'closure' },
      3: { storyId: 'port-closure', developmentId: 'reopening' },
    })
    const routes = createNewsRoutes({ newsProvider: provider, newsStories: store } as unknown as EngineContext)
    expect((await (await routes.request('/')).json()).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1, eventRef: { storyId: 'port-closure', developmentId: 'closure' } }),
      expect.objectContaining({ id: 3, eventRef: { storyId: 'port-closure', developmentId: 'reopening' } }),
    ]))
    await store.publish({ ...event(), id: 'conflicting-identity' })
    expect((await store.reportOccurrences([1])).get(1)).toBeNull()
  })

  it('keeps originals readable when prepared identity cannot be loaded', async () => {
    const { home, store } = await setup()
    await writeFile(join(home, 'broken.json'), '{')
    const routes = createNewsRoutes({ newsProvider: provider, newsStories: store } as unknown as EngineContext)
    const result = await (await routes.request('/')).json()
    expect(result).toMatchObject({ count: 3, storyError: true })
    expect(result.items[0].content).toBe(original.content)
  })
  it('retains a non-AI event without a stock symbol or selected status and resolves its original', async () => {
    const { tools } = await setup()
    expect(await tools.publishNewsStory.execute!({ artifact: JSON.stringify(event()) }, call)).toEqual({ id: 'port-closure', revision: 1 })
    expect(await tools.listNewsStories.execute!({}, call)).toMatchObject({ stories: [{ id: 'port-closure', selected: false, symbols: [], topics: ['shipping', 'weather'] }] })
    expect(await tools.readNewsStory.execute!({ id: 'port-closure' }, call)).toMatchObject({ reports: [{ id: 1, content: original.content }], missingReportIds: [] })
    expect(await provider.getNewsById!(1)).toEqual(original)
  })

  it('rejects malformed, missing-evidence and stale artifacts while retaining the previous revision', async () => {
    const { tools } = await setup()
    await expect(tools.publishNewsStory.execute!({ artifact: '{' }, call)).rejects.toThrow(/artifact/i)
    await expect(tools.publishNewsStory.execute!({ artifact: JSON.stringify({ ...event(), overviewReportIds: [99], developments: [{ ...event().developments[0], reportIds: [99] }] }) }, call)).rejects.toThrow(/report/i)
    await tools.publishNewsStory.execute!({ artifact: JSON.stringify(event()) }, call)
    await expect(tools.publishNewsStory.execute!({ artifact: JSON.stringify(event()) }, call)).rejects.toThrow(/revision/i)
    expect(await tools.readNewsStory.execute!({ id: 'port-closure' }, call)).toMatchObject({ revision: 1, summary: event().summary })
  })

  it('bounds UTF-8 artifact bytes before parsing', async () => {
    const { tools } = await setup()
    await expect(tools.publishNewsStory.execute!({ artifact: '中'.repeat(400_000) }, call)).rejects.toThrow(/1 MiB/)
  })

  it('serializes a native publication and HTTP publication through their shared store', async () => {
    const { store, tools } = await setup()
    const routes = createNewsRoutes({ newsProvider: provider, newsStories: store } as unknown as EngineContext)
    const results = await Promise.allSettled([
      tools.publishNewsStory.execute!({ artifact: JSON.stringify(event()) }, call),
      Promise.resolve(routes.request('/stories/port-closure', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event()) })).then(response => { if (response.status !== 200) throw new Error('HTTP refused'); return response }),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(await store.get('port-closure')).toMatchObject({ revision: 1 })
  })
})
