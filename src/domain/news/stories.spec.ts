import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NewsStoryStore } from './stories.js'
import { newsStorySchema } from './reading-contract.js'
import type { INewsProvider, NewsItem } from './types.js'

const material = (id: number): NewsItem => ({ id, time: new Date(`2026-10-${id === 1 ? '19' : '21'}T08:00:00Z`), title: `Original ${id}`, content: 'Original wording', metadata: { source: 'Original publisher', link: `https://example.com/${id}` } })
const provider: INewsProvider = { getNewsV2: async () => [], getNewsById: async id => id <= 3 ? material(id) : null }
const story = () => ({ version: 1 as const, id: 'model-release', revision: 1, title: 'Model release and availability', summary: 'The model was released, then became available.', reason: 'Watch adoption; revenue effects remain uncertain.', topics: ['ai'], symbols: [], selected: true, status: 'active' as const, updatedAt: '2026-10-21T09:00:00Z', preparedBy: 'Native agent', overviewReportIds: [1, 3], developments: [
  { id: 'release', time: '2026-10-19T08:00:00Z', title: 'Model released', summary: 'Initial release.', reportIds: [1, 2] },
  { id: 'availability', time: '2026-10-21T08:00:00Z', title: 'Access opened', summary: 'A distinct later development.', reportIds: [3] },
] })
const dirs: string[] = []
// Cold Windows cleanup includes the 51-file pagination fixture.
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) }, 20_000)
async function store() { const dir = await mkdtemp(join(tmpdir(), 'alice-news-stories-')); dirs.push(dir); return { dir, store: new NewsStoryStore(provider, dir) } }

// Cold Windows publication writes both the artifact and reader state (measured over 6 seconds).
describe('reviewed news stories', { timeout: process.platform === 'win32' ? 60_000 : 5_000 }, () => {
  it('follows exact topics and events without historical, repeated or overlapping notifications across restart', async () => {
    const { dir } = await store()
    const source = { ...provider, getNewsById: async (id: number) => material(id) }
    const alerts: unknown[] = []
    const current = new NewsStoryStore(source, dir, { onFollowUpdate: async update => { alerts.push(update) } })
    await current.publish(story())
    await current.setReader(story().id, { following: true, bookmarked: true, locked: false })
    await current.setTopicFollow('AI', true)
    expect(await current.followedTopics()).toEqual(['ai'])
    expect(alerts).toEqual([])
    await expect(current.setTopicFollow('ai unrelated', true)).rejects.toThrow(/topic/i)
    await current.publish({ ...story(), revision: 2, title: 'Wording only' })
    const next = { ...story(), revision: 3, developments: [...story().developments, { ...story().developments[0], id: 'rollout', reportIds: [4] }] }
    await current.publish(next)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ storyId: story().id, revision: 3, developmentIds: ['rollout'] })
    const restarted = new NewsStoryStore(source, dir, { onFollowUpdate: async update => { alerts.push(update) } })
    expect((await restarted.list()).stories[0].reading).toMatchObject({ following: true, bookmarked: true, locked: false })
    await restarted.publish({ ...next, revision: 4, developments: next.developments.map(fact => fact.id === 'release' ? { ...fact, reportIds: [...fact.reportIds, 5] } : fact) })
    expect(alerts).toHaveLength(1)
    await restarted.publish({ ...story(), id: 'new-topic-event' })
    expect(alerts).toHaveLength(2)
    await restarted.setTopicFollow('ai', false)
    await restarted.setReader(story().id, { following: false })
    await restarted.publish({ ...next, revision: 5, developments: [...next.developments, { ...story().developments[0], id: 'other', reportIds: [6] }] })
    expect(alerts).toHaveLength(2)
    const isolated = await store()
    expect(await isolated.store.followedTopics()).toEqual([])
  })

  it('keeps event publication durable when a follow notification fails', async () => {
    const { dir } = await store()
    let attempts = 0
    const current = new NewsStoryStore(provider, dir, { onFollowUpdate: async () => { attempts++; throw new Error('offline') } })
    await current.publish({ ...story(), developments: [story().developments[0]], overviewReportIds: [1] })
    await current.setReader(story().id, { following: true })
    await current.publish({ ...story(), revision: 2 })
    expect((await current.get(story().id)).revision).toBe(2)
    await current.publish({ ...story(), revision: 3 })
    expect(attempts).toBe(1)
  })

  it('preserves prepared source comparisons and rejects unsupported or unrelated evidence', async () => {
    const { dir } = await store()
    const current = new NewsStoryStore({ ...provider, getNewsById: async id => ({ ...material(id), metadata: { ...material(id).metadata, role: id === 1 ? 'official' : 'reporting' } }) }, dir)
    const comparison = { kind: 'official-response', summary: 'The authority responded to the reports.', reportIds: [1, 2] }
    const value = { ...story(), comparisons: [comparison] }
    await current.publish(value)
    expect((await new NewsStoryStore(provider, dir).get(value.id)).comparisons).toEqual([comparison])
    expect(newsStorySchema.safeParse({ ...value, comparisons: [{ ...comparison, reportIds: [99] }] }).success).toBe(false)
    expect(newsStorySchema.safeParse({ ...value, comparisons: [{ ...comparison, kind: 'difference', reportIds: [1] }] }).success).toBe(false)
    await expect(current.publish({ ...value, revision: 2, comparisons: [{ ...comparison, reportIds: [2] }] })).rejects.toThrow(/official/i)
    expect((await current.get(value.id)).revision).toBe(1)
  })

  it('filters unread and updated revisions before offsets and combines existing reader filters', async () => {
    const { dir, store: current } = await store()
    for (const [index, id] of ['a-read', 'b-unread', 'c-unread'].entries()) {
      await current.publish({ ...story(), id, overviewReportIds: [index + 1], developments: [{ ...story().developments[0], reportIds: [index + 1] }] })
    }
    await current.setReader('a-read', { readRevision: 1 })
    expect((await current.list({ readStatus: 'unread', offset: 1 })).stories.map(value => value.id)).toEqual(['c-unread'])
    await current.setReader('b-unread', { readRevision: 1, bookmarked: true })
    await current.publish({ ...story(), id: 'b-unread', revision: 2, title: 'Revised wording', overviewReportIds: [2], developments: [{ ...story().developments[0], reportIds: [2] }] })
    expect((await current.list({ readStatus: 'updated', bookmarked: true, topics: ['ai'], keyword: 'Revised wording' })).stories.map(value => value.id)).toEqual(['b-unread'])
    expect((await current.list({ readStatus: 'updated', offset: 1 })).stories).toEqual([])
    expect((await current.list({ readStatus: 'all' })).stories).toHaveLength(3)
    const restarted = new NewsStoryStore(provider, dir)
    expect((await restarted.list({ readStatus: 'updated' })).stories.map(value => value.id)).toEqual(['b-unread'])
    await restarted.setReader('b-unread', { readRevision: 2 })
    expect((await restarted.list({ readStatus: 'updated' })).stories).toEqual([])
    await restarted.setReader('a-read', { readRevision: null })
    expect((await restarted.list({ readStatus: 'unread' })).stories.map(value => value.id)).toEqual(['a-read', 'c-unread'])
  })

  it('persists exact read revisions and known developments without changing originals or human flags', async () => {
    const { dir } = await store()
    const source = { ...provider, getNewsById: async (id: number) => material(id) }
    const current = new NewsStoryStore(source, dir)
    await current.publish(story())
    const artifact = await readFile(join(dir, 'model-release.json'), 'utf8')
    await current.setReader('model-release', { bookmarked: true, important: false, readRevision: 1 })
    const restarted = new NewsStoryStore(source, dir)
    expect((await restarted.list()).stories[0].reading).toMatchObject({ bookmarked: true, important: false, readProgress: { revision: 1, developmentIds: ['release', 'availability'] } })
    expect(await readFile(join(dir, 'model-release.json'), 'utf8')).toBe(artifact)
    const updated = { ...story(), revision: 2, updatedAt: '2026-10-22T09:00:00Z', developments: [...story().developments, { id: 'rollout', time: '2026-10-22T08:00:00Z', title: 'Rollout expanded', summary: 'Another distinct development.', reportIds: [4] }] }
    await restarted.publish(updated)
    await expect(restarted.setReader('model-release', { readRevision: 1 })).rejects.toThrow(/revision/i)
    expect((await restarted.list()).stories[0].reading?.readProgress?.revision).toBe(1)
    await restarted.setReader('model-release', { readRevision: 2 })
    expect((await restarted.list()).stories[0].reading?.readProgress?.developmentIds).toContain('rollout')
    await restarted.setReader('model-release', { readRevision: null })
    expect((await restarted.list()).stories[0].reading).toMatchObject({ bookmarked: true, important: false, readProgress: null })
  })

  it('finds related stored events by exact topics or codes before pagination, excluding self and unrelated stories', async () => {
    const { dir } = await store()
    const current = new NewsStoryStore({ ...provider, getNewsById: async (id: number) => material(id) }, dir)
    const values = [
      { id: 'source-event', topics: ['Iran'], symbols: ['EQUITY:AAA'] },
      { id: 'same-topic', topics: ['iran'], symbols: [] },
      { id: 'same-code', topics: ['Trade'], symbols: ['EQUITY:AAA'] },
      { id: 'unrelated', topics: ['Iranian music'], symbols: ['EQUITY:AAAB'] },
    ]
    for (const [index, value] of values.entries()) await current.publish({ ...story(), ...value, overviewReportIds: [index + 1], developments: [{ ...story().developments[0], reportIds: [index + 1] }] })
    expect((await current.list({ relatedTo: 'source-event' })).stories.map(value => value.id)).toEqual(['same-code', 'same-topic'])
    expect((await current.list({ relatedTo: 'source-event', offset: 1 })).stories.map(value => value.id)).toEqual(['same-topic'])
  })

  it('requires an explicit transmission assessment and retains null when no defensible path exists', async () => {
    const { store: current } = await store()
    const value = { ...story(), importance: { level: 'normal', reason: 'Impact is unclear.', reportIds: [1] } }
    await expect(current.publish(value, { automatic: true })).rejects.toThrow(/transmission/i)
    await current.publish({ ...value, transmission: null }, { automatic: true })
    expect((await current.get(value.id)).transmission).toBeNull()
  })

  it('bounds conditional transmission paths and binds their distinct evidence to this event', () => {
    const transmission = { steps: ['Closure claim', 'Shipping', 'Delivery costs'], condition: 'If the reported closure persists; costs and prices are not established.', reportIds: [2] }
    expect(newsStorySchema.safeParse({ ...story(), transmission }).success).toBe(true)
    for (const invalid of [
      { ...transmission, steps: ['Shipping'] }, { ...transmission, steps: Array(6).fill('Step') },
      { ...transmission, steps: [' ', 'Shipping'] }, { ...transmission, condition: '' },
      ...[[99], [1, 1], []].map(reportIds => ({ ...transmission, reportIds })),
    ]) expect(newsStorySchema.safeParse({ ...story(), transmission: invalid }).success).toBe(false)
  })

  it('counts identified publishers across stored evidence independently of stale heat and feed labels', async () => {
    const { dir } = await store()
    const source = { ...provider, getNewsById: async (id: number) => ({ ...material(id), metadata: { source: `Feed ${id}`, ...(id < 3 ? { link: `https://${id === 1 ? 'www.' : ''}publisher.test/${id}` } : {}) } }) }
    const current = new NewsStoryStore(source, dir, { now: () => Date.parse('2026-10-25T12:00:00Z') })
    await current.publish(story())
    expect((await current.list()).stories[0].reading).toMatchObject({ publishers: 1, participants: 0, heat: 0 })
  })

  it('requires a grounded assessment for automatic publication while retaining legacy human artifacts', async () => {
    const { store: current } = await store()
    await expect(current.publish(story(), { automatic: true })).rejects.toThrow(/importance/i)
    await current.publish(story())
    expect((await current.get('model-release')).importance).toBeUndefined()
    for (const reportIds of [[99], [1, 1]]) {
      expect(newsStorySchema.safeParse({ ...story(), importance: { level: 'important', reason: 'Possible market disruption.', reportIds } }).success).toBe(false)
    }
    expect(newsStorySchema.safeParse({ ...story(), importance: { level: 'important', reason: '', reportIds: [1] } }).success).toBe(false)
  })

  it('automatically discovers assessed events and preserves human corrections across reassessment and restart', async () => {
    const { dir, store: current } = await store()
    const assessment = { level: 'important' as const, reason: 'A documented closure can disrupt shipping; price effects are unknown.', reportIds: [1] }
    const value = { ...story(), selected: false, topics: ['shipping'], importance: assessment, transmission: null }
    await current.publish(value, { automatic: true })
    const restarted = new NewsStoryStore(provider, dir)
    expect((await restarted.list({ important: true })).stories[0]).toMatchObject({ importance: assessment, reading: { important: true } })
    await restarted.publish({ ...value, revision: 2, importance: { ...assessment, level: 'normal' } }, { automatic: true })
    expect((await restarted.list({ important: true })).stories).toHaveLength(0)
    await restarted.setReader(value.id, { important: true })
    await restarted.publish({ ...value, revision: 3, importance: { ...assessment, level: 'uncertain' } }, { automatic: true })
    expect((await restarted.list({ important: true })).stories).toHaveLength(1)
    await restarted.setReader(value.id, { important: false })
    await restarted.publish({ ...value, revision: 4 }, { automatic: true })
    expect((await restarted.list({ important: true })).stories).toHaveLength(0)
    expect((await restarted.list()).stories).toHaveLength(1)
  })
  it('derives source importance, persists reader overrides and filters before pagination without using selected', async () => {
    const { dir } = await store()
    const flagged = { ...material(4), metadata: { source: 'Publisher', categories: 'macro; IMPORTANT' } }
    const source = { ...provider, getNewsById: async (id: number) => id === 4 ? flagged : id <= 3 ? material(id) : null }
    const current = new NewsStoryStore(source, dir)
    await current.publish(story())
    await current.publish({ ...story(), id: 'source-important', selected: false, updatedAt: '2026-10-22T09:00:00Z', overviewReportIds: [4], developments: [{ ...story().developments[0], reportIds: [4] }] })
    expect((await current.list({ important: true })).stories.map(value => value.id)).toEqual(['source-important'])
    expect((await current.list()).stories.find(value => value.id === 'model-release')?.reading?.important).toBe(false)
    await current.setReader('model-release', { bookmarked: true, important: true })
    const restarted = new NewsStoryStore(source, dir)
    expect((await restarted.list({ important: true, offset: 1 })).stories.map(value => value.id)).toEqual(['model-release'])
    await restarted.setReader('source-important', { important: false })
    expect((await restarted.list({ important: true })).stories.map(value => value.id)).toEqual(['model-release'])
    expect((await restarted.list({ important: true, offset: 1 })).stories).toEqual([])
    expect((await restarted.list({ bookmarked: true })).stories[0].reading).toMatchObject({ bookmarked: true, important: true })
    expect(flagged.metadata.categories).toBe('macro; IMPORTANT')
    expect(JSON.parse(await readFile(join(dir, 'model-release.json'), 'utf8'))).not.toHaveProperty('important')
  })
  it('persists one continuing story with distinct facts, independent of the recent report window', async () => {
    const { dir, store: first } = await store()
    await first.publish(story())
    const [restored] = (await new NewsStoryStore(provider, dir).list()).stories
    expect(restored.id).toBe('model-release')
    expect(restored.developments).toHaveLength(2)
    expect(restored.reports.map(report => report.id)).toEqual([1, 2, 3])
    expect(JSON.parse(await readFile(join(dir, 'model-release.json'), 'utf8')).revision).toBe(1)
  })
  it('rejects broken evidence and stale updates without replacing the published result', async () => {
    const { store: current } = await store()
    await current.publish(story())
    await expect(current.publish(story())).rejects.toThrow(/revision/i)
    const broken = { ...story(), revision: 2, overviewReportIds: [99], developments: [{ ...story().developments[0], reportIds: [99] }] }
    await expect(current.publish(broken)).rejects.toThrow(/report/i)
    expect((await current.list()).stories[0].revision).toBe(1)
  })
  it('does not allow a report to represent two different developments or unsafe identities', () => {
    const value = story()
    value.developments[1].reportIds = [1]
    expect(newsStorySchema.safeParse(value).success).toBe(false)
    expect(newsStorySchema.safeParse({ ...story(), id: '../escape' }).success).toBe(false)
    expect(newsStorySchema.safeParse({ ...story(), overviewReportIds: [999] }).success).toBe(false)
    expect(newsStorySchema.safeParse({ ...story(), developments: Array.from({ length: 2 }, (_, index) => ({ ...story().developments[0], id: `fact-${index}`, reportIds: Array.from({ length: 100 }, (_, offset) => index * 100 + offset) })) }).success).toBe(false)
  })
  it('serializes competing revisions and reports missing evidence explicitly on reads', async () => {
    const { dir, store: current } = await store()
    await current.publish(story())
    const results = await Promise.allSettled([current.publish({ ...story(), revision: 2 }), current.publish({ ...story(), revision: 2 })])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const [result] = (await new NewsStoryStore({ ...provider, getNewsById: async () => null }, dir).list()).stories
    expect(result.missingReportIds).toEqual([1, 2, 3])
    expect(result.reports).toEqual([])
  })
  it('filters before paging and searches original bodies outside the raw window', async () => {
    const { dir, store: current } = await store()
    // Pagination needs persisted events; publication is exercised above.
    await Promise.all(Array.from({ length: 51 }, (_, index) => {
      const value = { ...story(), id: `story-${index}`, selected: index === 50, updatedAt: `2026-10-21T${index === 50 ? '08' : '09'}:00:00Z` }
      return writeFile(join(dir, `${value.id}.json`), JSON.stringify(value))
    }))
    expect((await current.list()).nextOffset).toBe(50)
    expect((await current.list({ offset: 50 })).stories).toHaveLength(1)
    expect((await current.list({ selected: true })).stories.map(story => story.id)).toEqual(['story-50'])
    const searchable = new NewsStoryStore({ ...provider, getNewsById: async id => ({ ...material(id), content: 'Orion body-only keyword' }) }, dir)
    expect((await searchable.list({ selected: true, keyword: 'Orion', source: 'original PUBLISHER' })).stories[0].id).toBe('story-50')
  }, process.platform === 'win32' ? 120_000 : 30_000)
})
