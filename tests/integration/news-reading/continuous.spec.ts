import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NewsCollectorStore } from '../../../src/domain/news/store.js'
import { NewsStoryStore } from '../../../src/domain/news/stories.js'
import { createNewsAutomationRoutes, NEWS_PREPARATION_ISSUE, NEWS_PREPARATION_WHAT } from '../../../src/webui/routes/news-automation.js'
import { readWorkspaceIssues } from '../../../src/workspaces/issues/declaration.js'
import { createNewsRoutes } from '../../../src/webui/routes/news.js'
import type { EngineContext } from '../../../src/core/types.js'
import type { WorkspaceService } from '../../../src/workspaces/service.js'
import { createIssue, updateIssueFields } from '../../../src/workspaces/issues/mutate.js'

const homes: string[] = []
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) }, 20_000)
const now = Date.parse('2026-10-24T12:00:00Z')
async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'news-continuous-'))
  homes.push(home)
  const archive = new NewsCollectorStore({ logPath: join(home, 'news.jsonl'), maxInMemory: 1, retentionDays: 1 })
  await archive.init()
  for (let id = 1; id <= 3; id++) await archive.ingest({ title: `Original ${id}`, content: id === 1 ? 'Older evidence includes reopening conditions' : 'An original report',
    pubTime: new Date(now - (id === 1 ? 3 * 86400000 : 3600000)), dedupKey: `report-${id}`, metadata: { source: 'same-owner-feed-' + id, link: `https://publisher.test/report-${id}` } })
  const directory = join(home, 'stories')
  return { archive, directory, store: new NewsStoryStore(archive, directory, { now: () => now }) }
}
const event = (ids = [1]) => ({ version: 1 as const, id: 'port-closure', revision: 1, title: 'Port closure', summary: 'The port closed.', reason: 'Shipping may be affected; price effects are unknown.', topics: ['shipping'], symbols: [], selected: false, status: 'watching' as const, updatedAt: new Date(now).toISOString(), preparedBy: 'Native test', overviewReportIds: [ids[0]],
  importance: { level: 'normal', reason: 'Local closure documented; wider impact remains unestablished.', reportIds: ids }, transmission: null,
  developments: [{ id: 'closure', time: new Date(now - 3600000).toISOString(), title: 'Closure announced', summary: 'Reopening is unknown.', reportIds: ids }] })

// These flows include several atomic file publications on cold Windows storage.
describe('continuous event preparation and discovery', { timeout: process.platform === 'win32' ? 60_000 : 5_000 }, () => {
  it.each(['preparation-before-importance.md', 'preparation-before-transmission.md', 'preparation-before-associations.md'])('upgrades the known managed prompt %s on resume and preserves customized instructions', async fixture => {
    const { directory } = await setup()
    const workspace = { id: 'news', tag: 'News', dir: join(directory, 'workspace') }
    const service = { registry: { list: () => [workspace], get: () => workspace } } as unknown as Pick<WorkspaceService, 'registry'>
    const legacy = await readFile(new URL(`./fixtures/${fixture}`, import.meta.url), 'utf8')
    await createIssue(workspace.dir, { id: NEWS_PREPARATION_ISSUE, title: 'Financial news preparation', status: 'canceled', priority: 'high', assignee: '@new-each-run', when: { kind: 'every', every: '15m' }, what: legacy })
    const app = createNewsAutomationRoutes(() => service)
    const configure = (enabled: boolean) => app.request('/', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: workspace.id, enabled }) })
    expect((await configure(true)).status).toBe(200)
    const upgraded = await readWorkspaceIssues(workspace.dir)
    expect(upgraded.ok && upgraded.issues[0]).toMatchObject({ what: NEWS_PREPARATION_WHAT.trim(), assignee: '@new-each-run', when: { kind: 'every', every: '15m' } })
    const custom = `${NEWS_PREPARATION_WHAT.trim()}\n\nKeep my custom conditions.`
    await updateIssueFields(workspace.dir, NEWS_PREPARATION_ISSUE, { what: custom, status: 'canceled' })
    const rejected = await configure(true)
    expect(rejected.status).toBe(409)
    expect(await rejected.json()).toMatchObject({ error: expect.stringContaining('instructions require review') })
    const conflict = await updateIssueFields(workspace.dir, NEWS_PREPARATION_ISSUE, { what: NEWS_PREPARATION_WHAT, status: 'todo' }, { expectedWhat: legacy.trim() })
    expect(conflict).toMatchObject({ ok: false, reason: 'conflict' })
    expect((await configure(false)).status).toBe(200)
    const preserved = await readWorkspaceIssues(workspace.dir)
    expect(preserved.ok && preserved.issues[0]).toMatchObject({ what: custom, status: 'canceled' })
  })
  it('offers a bounded recent-publication queue without losing old work or review holds', async () => {
    const { store, archive } = await setup()
    await archive.ingest({ title: 'Late old original', content: 'An older report collected later', pubTime: new Date(now - 2 * 86400000), dedupKey: 'late-old', metadata: { source: 'test' } })
    expect((await store.pending({ limit: 2 })).items.map(item => item.id)).toEqual([1, 2])
    const routes = createNewsRoutes({ newsProvider: archive, newsStories: store } as unknown as EngineContext)
    const recent = await routes.request('/processing?order=recent&limit=2')
    expect(recent.status).toBe(200)
    expect(await recent.json()).toMatchObject({ items: [{ id: 3 }, { id: 2 }], counts: { pending: 4, ready: 4 }, nextOffset: null })
    await store.disposition([3], 'review', 'An attributed claim requires source review')
    const held = await routes.request('/processing?order=recent&limit=2')
    expect(await held.json()).toMatchObject({ items: [{ id: 2 }, { id: 4 }], counts: { pending: 3, review: 1, ready: 3 } })
    expect((await routes.request('/processing?order=recent&offset=1')).status).toBe(400)
    expect((await routes.request('/processing?order=invalid')).status).toBe(400)
  })

  it('serializes a review arriving during publication without losing the hold', async () => {
    const { archive, directory } = await setup()
    const original = await archive.getNewsById(1)
    let entered!: () => void
    let release!: () => void
    const publishingEvidence = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    let first = true
    const store = new NewsStoryStore({
      getNewsV2: options => archive.getNewsV2(options),
      scanNews: () => archive.scanNews(),
      getNewsByIds: async () => { if (first) { first = false; entered(); await gate }; return [original!] },
    }, directory, { now: () => now })
    const publishing = store.publish(event(), { automatic: true })
    await publishingEvidence
    const reviewing = store.disposition([1], 'review', 'A reviewer requested a source check during publication')
    release()
    await Promise.all([publishing, reviewing])
    expect((await store.pending({ status: 'review' })).items.map(item => item.id)).toEqual([1])
  })
  it('acknowledges committed evidence even if a failed publication receipt remains recorded', async () => {
    const { archive, directory, store } = await setup()
    await store.publish(event(), { automatic: true })
    await store.disposition([1], 'failed', 'Publication receipt interrupted after the artifact committed')
    const resumed = new NewsStoryStore(archive, directory, { now: () => now + 6 * 60000 })
    expect((await resumed.pending()).items.map(item => item.id)).not.toContain(1)
    expect((await resumed.pending()).counts.failed).toBe(0)
  })
  it('stops automatic report retries after three failures until a human retries', async () => {
    const { store, archive, directory } = await setup()
    for (let attempt = 0; attempt < 3; attempt++) await store.disposition([1], 'failed', 'Still unavailable')
    const later = new NewsStoryStore(archive, directory, { now: () => now + 86400000 })
    expect((await later.pending()).items.map(item => item.id)).not.toContain(1)
    expect((await later.pending({ status: 'failed' })).items[0].processing).toMatchObject({ attempts: 3 })
    await later.disposition([1], 'retry', '')
    expect((await later.pending()).items.map(item => item.id)).toContain(1)
  })
  it('keeps unprepared originals available beyond the recent index and resumes after publication', async () => {
    const { store, archive, directory } = await setup()
    expect(archive.count).toBe(1)
    expect((await store.pending({ limit: 2 })).items.map(item => item.id)).toEqual([1, 2])
    await store.publish(event(), { automatic: true })
    const resumed = new NewsStoryStore(archive, directory, { now: () => now })
    expect((await resumed.pending()).items.map(item => item.id)).toEqual([2, 3])
  })
  it('persists uncertain work and failed retries without silently dropping either', async () => {
    const { store, archive, directory } = await setup()
    await store.disposition([1], 'review', 'Relationship is uncertain')
    await store.disposition([2], 'failed', 'Source body unavailable')
    const resumed = new NewsStoryStore(archive, directory, { now: () => now })
    expect(await resumed.pending()).toMatchObject({ counts: { pending: 1, review: 1, failed: 1 } })
    expect((await resumed.pending()).items.map(item => item.id)).toEqual([3])
    expect((await resumed.pending({ status: 'review' })).items[0]).toMatchObject({ id: 1, processing: { reason: 'Relationship is uncertain' } })
    const later = new NewsStoryStore(archive, directory, { now: () => now + 6 * 60000 })
    expect((await later.pending()).items.map(item => item.id)).toEqual([2, 3])
    await resumed.disposition([1], 'retry', 'Retain both contradictory accounts in the summary')
    expect((await resumed.pending()).items.map(item => item.id)).toEqual([1, 3])
    expect((await resumed.pending()).items[0].processing).toMatchObject({ status: 'pending', reason: 'Retain both contradictory accounts in the summary' })
  })
  it('protects reviewed events and prior evidence from unattended revisions', async () => {
    const { store } = await setup()
    await store.publish(event(), { automatic: true })
    await store.setReader('port-closure', { locked: true })
    await expect(store.publish({ ...event(), revision: 2 }, { automatic: true })).rejects.toThrow(/locked/i)
    await store.setReader('port-closure', { locked: false })
    await expect(store.publish({ ...event([2]), revision: 2 }, { automatic: true })).rejects.toThrow(/retain/i)
    await expect(store.publish({ ...event(), id: 'duplicate-event' }, { automatic: true })).rejects.toThrow(/assigned/i)
    expect((await store.get('port-closure')).revision).toBe(1)
  })
  it('restores bookmarks, exposes topics and deduplicates heat by publisher identity', async () => {
    const { store, archive, directory } = await setup()
    await store.publish(event([2, 3]))
    await store.setReader('port-closure', { bookmarked: true })
    const resumed = new NewsStoryStore(archive, directory, { now: () => now })
    const result = await resumed.list({ bookmarked: true, keyword: 'port' })
    expect(result.topics).toContainEqual({ topic: 'shipping', count: 1 })
    expect(result.stories[0].reading).toMatchObject({ bookmarked: true, participants: 1, trend: 'unknown', isNew: true })
    await resumed.setReader('port-closure', { bookmarked: false })
    expect((await resumed.list({ bookmarked: true })).stories).toEqual([])
    expect((await resumed.list({ keyword: 'reopening conditions' })).stories).toEqual([])
    await resumed.publish({ ...event([1, 2, 3]), revision: 2 })
    expect((await resumed.list({ keyword: 'reopening conditions' })).stories).toHaveLength(1)
  })
  it('compares trends only with a six-hour snapshot of the same source coverage', async () => {
    const { archive, directory } = await setup()
    let clock = now
    let coverage = ['feed-one']
    const store = new NewsStoryStore(archive, directory, { now: () => clock, coverage: () => coverage })
    await store.publish(event([2, 3]))
    expect((await store.list()).stories[0].reading?.trend).toBe('unknown')
    clock += 6 * 3600000
    await archive.ingest({ title: 'Independent confirmation', content: 'A separate publisher confirms the closure.', pubTime: new Date(clock), dedupKey: 'four', metadata: { link: 'https://other.test/confirmed' } })
    await store.publish({ ...event([2, 3, 4]), revision: 2, updatedAt: new Date(clock).toISOString() })
    expect((await store.list()).stories[0].reading).toMatchObject({ participants: 2, trend: 'rising', hasUpdate: false })
    coverage = ['feed-one', 'new-feed']
    expect((await store.list()).stories[0].reading?.trend).toBe('unknown')
  })
  it('keeps a follow-up distinct from duplicate coverage and an unrelated same-topic event', async () => {
    const { archive, directory } = await setup()
    let clock = now
    const store = new NewsStoryStore(archive, directory, { now: () => clock })
    await store.publish(event([2]), { automatic: true })
    clock += 2 * 3600000
    await archive.ingest({ title: 'Port reopens', content: 'The authority announced reopening.', pubTime: new Date(clock), dedupKey: 'reopening', metadata: { publisher: 'Authority' } })
    const continuing = { ...event([2]), revision: 2, updatedAt: new Date(clock).toISOString(), developments: [...event([2]).developments, { id: 'reopening', time: new Date(clock).toISOString(), title: 'Reopening announced', summary: 'The closure ended.', reportIds: [4] }] }
    await store.publish(continuing, { automatic: true })
    await store.publish({ ...event([3]), id: 'unrelated-port-fee', title: 'An unrelated port fee', updatedAt: new Date(clock).toISOString() }, { automatic: true })
    expect((await store.reportOccurrences([2, 4])).get(4)).toEqual({ storyId: 'port-closure', developmentId: 'reopening' })
    expect((await store.list()).stories.find(story => story.id === 'port-closure')?.reading?.hasUpdate).toBe(true)
    clock += 25 * 3600000
    await archive.ingest({ title: 'Another account of the original closure', content: 'Coverage of the old closure.', pubTime: new Date(clock), dedupKey: 'duplicate', metadata: { publisher: 'Authority' } })
    await store.publish({ ...continuing, revision: 3, updatedAt: new Date(clock).toISOString(), developments: [{ ...continuing.developments[0], reportIds: [2, 5] }, continuing.developments[1]] }, { automatic: true })
    const page = await store.list()
    expect(page.stories).toHaveLength(2)
    expect(page.stories.find(story => story.id === 'port-closure')?.reading).toMatchObject({ isNew: false, hasUpdate: false })
    expect((await store.get('port-closure')).developments).toHaveLength(2)
  })
  it('persists reader and review operations through the real HTTP surface', async () => {
    const { store, archive } = await setup()
    await store.publish(event())
    await store.disposition([2], 'review', 'Compare the actual occurrence')
    const routes = createNewsRoutes({ newsProvider: archive, newsStories: store } as unknown as EngineContext)
    const change = await routes.request('/stories/port-closure/reader', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"bookmarked":true,"locked":true}' })
    expect(change.status).toBe(200)
    const bookmarked = await (await routes.request('/stories?bookmarked=true&storyOrder=heat')).json()
    expect(bookmarked.stories[0].reading).toMatchObject({ bookmarked: true, locked: true })
    expect((await (await routes.request('/processing?status=review')).json()).items[0].id).toBe(2)
    expect((await (await routes.request('/processing/1')).json()).content).toContain('Older evidence')
    expect((await routes.request('/processing/2/retry', { method: 'POST' })).status).toBe(200)
    expect((await routes.request('/processing?status=other')).status).toBe(400)
    expect((await routes.request('/stories/port-closure/reader', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"bookmarked":"yes"}' })).status).toBe(400)
  })
  it('configures one visible native Issue, preserves it across pauses, and excludes a second processor', async () => {
    const { directory } = await setup()
    const workspaces = [{ id: 'one', tag: 'News', dir: join(directory, 'one') }, { id: 'two', tag: 'Other', dir: join(directory, 'two') }]
    const service = { registry: { list: () => workspaces, get: (id: string) => workspaces.find(workspace => workspace.id === id) } } as unknown as Pick<WorkspaceService, 'registry'>
    const routes = createNewsAutomationRoutes(() => service)
    const configure = (workspaceId: string, enabled: boolean) => routes.request('/', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId, enabled }) })
    expect((await (await routes.request('/')).json()).automations).toEqual([])
    expect((await configure('one', true)).status).toBe(200)
    const issues = await readWorkspaceIssues(workspaces[0].dir)
    expect(issues.ok && issues.issues[0]).toMatchObject({ id: NEWS_PREPARATION_ISSUE, assignee: '@new-each-run', when: { kind: 'every', every: '15m' }, what: NEWS_PREPARATION_WHAT.trim() })
    expect((await configure('two', true)).status).toBe(409)
    expect((await configure('one', false)).status).toBe(200)
    const paused = await readWorkspaceIssues(workspaces[0].dir)
    expect(paused.ok && paused.issues[0].status).toBe('canceled')
    expect((await configure('one', true)).status).toBe(200)
    const resumed = await readWorkspaceIssues(workspaces[0].dir)
    expect(resumed.ok && resumed.issues[0].what).toBe(NEWS_PREPARATION_WHAT.trim())
  })
})
