import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { NewsStoryStore } from './stories.js'
import type { NewsItem } from './types.js'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
const original: NewsItem = { id: 1, time: new Date('2026-10-27T00:00:00Z'), title: 'Canada statement', content: 'Canada announced a new tariff measure.', metadata: { source: 'Authority', role: 'official' } }
const story = { version: 1, id: 'tariff-policy', revision: 1, title: 'Tariff policy', summary: 'A statement.', reason: 'Watch implementation.', topics: ['trade'], symbols: [], selected: false, status: 'watching', updatedAt: '2026-10-27T00:00:00Z', preparedBy: 'Fixture', overviewReportIds: [1], developments: [{ id: 'statement', time: '2026-10-27T00:00:00Z', title: 'Statement', summary: 'A statement.', reportIds: [1] }] }
const association = () => ({ version: 1, storyId: story.id, revision: 1, storyRevision: 1, preparedAt: '2026-10-27T00:01:00Z', preparedBy: 'Fixture', relations: [{ id: 'canada', country: 'CA', kind: 'directly-involved', explanation: 'Canada is the attributed policy actor.', status: 'active', evidence: [{ reportId: 1, field: 'content', sha256: createHash('sha256').update(original.content).digest('hex'), excerpt: 'Canada announced a new tariff measure.' }] }], unresolved: [] })
async function setup() { const dir = await mkdtemp(join(tmpdir(), 'alice-news-associations-')); dirs.push(dir); const store = new NewsStoryStore({ getNewsV2: async () => [], getNewsById: async id => id === 1 ? original : null }, dir); await store.publish(story); return { dir, store } }

it('accepts additional country identities with original evidence and still rejects unknown codes', async () => {
  const { dir } = await setup()
  const content = 'Canada held policy talks with the United Arab Emirates, Qatar, Israel, Haiti and El Salvador.'
  const store = new NewsStoryStore({ getNewsV2: async () => [], getNewsById: async () => ({ ...original, content }) }, dir)
  const value = { ...association(), relations: ['AE', 'QA', 'IL', 'HT', 'SV'].map(country => ({ ...association().relations[0], id: country.toLowerCase(), country,
    explanation: 'The original identifies this country as a participant in policy talks.', evidence: [{ reportId: 1, field: 'content', sha256: createHash('sha256').update(content).digest('hex'), excerpt: content }],
  })) }
  await store.publishAssociations(story.id, value)
  for (const country of ['AE', 'QA', 'IL', 'HT', 'SV']) expect((await store.list({ country })).stories).toHaveLength(1)
  await expect(store.publishAssociations(story.id, { ...value, revision: 2, relations: [{ ...value.relations[0], country: 'UNKNOWN' }] })).rejects.toThrow()
})

it('accepts only resolved source-specific assets, a fixed industry identity and separately conditional transmission', async () => {
  const { dir } = await setup()
  const store = new NewsStoryStore({ getNewsV2: async () => [], getNewsById: async () => original }, dir, { resolveAsset: async asset => asset.barId === 'yfinance|AAPL' && asset.assetClass === 'equity' })
  const base = association().relations[0]
  const { country: _country, ...relation } = base
  const asset = { ...relation, id: 'explicit-asset', asset: { barId: 'yfinance|AAPL', assetClass: 'equity' }, kind: 'conditional-transmission', condition: 'Only if the announced policy is implemented.' }
  const value = { ...association(), relations: [asset, { ...relation, id: 'sector', industry: 'XLK' }], unresolved: [{ label: 'Apple', reason: 'Name alone does not establish an instrument.' }] }
  await store.publishAssociations(story.id, value)
  expect((await store.list({ industry: 'XLK', asset: 'yfinance|AAPL' })).stories).toHaveLength(1)
  expect((await store.list({ asset: 'other|AAPL' })).stories).toHaveLength(0)
  await expect(store.publishAssociations(story.id, { ...value, revision: 2, relations: [{ ...asset, condition: undefined }] })).rejects.toThrow()
  await expect(store.publishAssociations(story.id, { ...value, revision: 2, relations: [{ ...asset, asset: { ...asset.asset, barId: 'AAPL' } }] })).rejects.toThrow()
  await expect(store.publishAssociations(story.id, { ...value, revision: 2, relations: [{ ...asset, asset: { ...asset.asset, barId: 'unknown|AAPL' } }] })).rejects.toThrow(/asset/i)
})

it('binds country evidence to an exact event revision, preserves history and invalidates old filters after an event update', async () => {
  const { dir, store } = await setup()
  const raw = await readFile(join(dir, `${story.id}.json`), 'utf8')
  expect((await store.get(story.id)).associations?.status).toBe('unassessed')
  await store.publishAssociations(story.id, association())
  expect((await store.list({ country: 'CA', topics: ['trade'] })).stories).toHaveLength(1)
  expect((await store.list({ country: 'US' })).stories).toHaveLength(0)
  expect(await readFile(join(dir, `${story.id}.json`), 'utf8')).toBe(raw)
  const concurrent = await Promise.allSettled([store.publishAssociations(story.id, { ...association(), revision: 2 }), store.publishAssociations(story.id, { ...association(), revision: 2 })])
  expect(concurrent.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  await store.publish({ ...story, revision: 2 })
  expect((await store.get(story.id)).associations?.status).toBe('needs-review')
  expect((await store.list({ country: 'CA' })).stories).toHaveLength(0)
  await expect(store.publishAssociations(story.id, { ...association(), revision: 3 })).rejects.toThrow(/revision/i)
  await store.publishAssociations(story.id, { ...association(), revision: 3, storyRevision: 2, relations: association().relations.map(relation => ({ ...relation, status: 'withdrawn' })) })
  expect((await store.getAssociations(story.id)).record?.history).toHaveLength(3)
  expect((await store.list({ country: 'CA' })).stories).toHaveLength(0)
})

it('rejects changed, unrelated or empty evidence and cannot bypass human protection by renaming a relation', async () => {
  const { store } = await setup()
  const value = association()
  await expect(store.publishAssociations(story.id, { ...value, relations: [{ ...value.relations[0], evidence: [{ ...value.relations[0].evidence[0], sha256: '0'.repeat(64) }] }] })).rejects.toThrow(/evidence/i)
  await expect(store.publishAssociations(story.id, { ...value, relations: [{ ...value.relations[0], evidence: [{ ...value.relations[0].evidence[0], reportId: 99 }] }] })).rejects.toThrow(/evidence/i)
  await store.publishAssociations(story.id, value)
  await expect(store.publishAssociations(story.id, { ...value, revision: 2, relations: [{ ...value.relations[0], id: 'renamed', country: 'US' }] }, { automatic: true })).rejects.toThrow(/protected/i)
  await store.publishAssociations(story.id, { ...value, revision: 2, protected: false })
  await store.setReader(story.id, { locked: true })
  await expect(store.publishAssociations(story.id, { ...value, revision: 3 }, { automatic: true })).rejects.toThrow(/locked/i)
  await store.setReader(story.id, { locked: false })
  await store.disposition([1], 'review', 'Review the claim')
  await expect(store.publishAssociations(story.id, { ...value, revision: 3 })).rejects.toThrow(/review/i)
})

it('uses title evidence only without a body and fails visibly on corrupt association state', async () => {
  const { dir } = await setup()
  let report = { ...original, title: '<b>Canada</b> statement', content: '', metadata: { ...original.metadata, ingestSource: 'rss' } }
  const store = new NewsStoryStore({ getNewsV2: async () => [report], getNewsById: async () => report }, dir)
  const base = association()
  const value = { ...base, relations: [{ ...base.relations[0], evidence: [{ reportId: 1, field: 'title', sha256: createHash('sha256').update(report.title).digest('hex'), excerpt: report.title }] }] }
  expect((await store.getAssociations(story.id)).evidence[0].sha256).toBe(value.relations[0].evidence[0].sha256)
  await store.publishAssociations(story.id, value)
  report = { ...report, content: original.content }
  await expect(store.publishAssociations(story.id, { ...value, revision: 2 })).rejects.toThrow(/evidence/i)
  await writeFile(join(dir, '.associations', 'v1', `${story.id}.json`), '{broken')
  await expect(store.list({ country: 'CA' })).rejects.toThrow()
  expect((await store.original(1)).content).toBe(original.content)
})

it('filters countries, industries and explicit assets before offsets while retaining bookmark and topic filters', async () => {
  const { dir } = await setup()
  const store = new NewsStoryStore({ getNewsV2: async () => [], getNewsById: async () => original }, dir, { resolveAsset: async () => true })
  for (let index = 0; index < 51; index++) await store.publish({ ...story, id: `other-${index.toString().padStart(2, '0')}` })
  const base = association()
  const { country: _country, ...relation } = base.relations[0]
  await store.publishAssociations(story.id, { ...base, relations: [...base.relations, { ...relation, id: 'sector', industry: 'XLK' }, { ...relation, id: 'asset', asset: { barId: 'yfinance|AAPL', assetClass: 'equity' } }] })
  await store.setReader(story.id, { bookmarked: true })
  const query = { country: 'CA', industry: 'XLK', asset: 'yfinance|AAPL', bookmarked: true, topics: ['trade'] }
  expect((await store.list(query)).stories.map(value => value.id)).toEqual([story.id])
  expect((await store.list({ ...query, offset: 1 })).stories).toEqual([])
})
