// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import type { NewsCollectorConfig } from '../../api/types'
import { configKeysHandlers, resetDemoNewsConfig } from './configKeys'

import { demoNewsArticles, demoNewsStories } from '../fixtures/news'
import { newsListHandlers, resetDemoNewsReadingState } from './newsList'

const server = setupServer(...configKeysHandlers, ...newsListHandlers)
const baseUrl = window.location.origin
const unobservedFreshness = { lastPublishedAt: null, lastUndatedItemCount: null, lastEmptyContentCount: null, lastEmptyItemCount: null, lastDurationMs: null }

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
beforeEach(() => { resetDemoNewsConfig(); resetDemoNewsReadingState() })
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

async function updateNewsConfig(config: NewsCollectorConfig): Promise<void> {
  const response = await fetch(`${baseUrl}/api/config/news`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  })
  expect(response.status).toBe(200)
}

describe('demo News handlers', () => {
  it('filters unread and updated snapshots and rejects invalid reading filters on both routes', async () => {
    const story = demoNewsStories[0]
    const patch = await fetch(`${baseUrl}/api/news/stories/${story.id}/reader`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ readRevision: story.revision }) })
    expect(patch.status).toBe(200)
    for (const route of ['/api/news/stories', '/api/news?includeStories=true']) {
      const separator = route.includes('?') ? '&' : '?'
      const page = await (await fetch(`${baseUrl}${route}${separator}readStatus=unread`)).json()
      expect(page.stories.some((value: { id: string }) => value.id === story.id)).toBe(false)
      expect((await fetch(`${baseUrl}${route}${separator}readStatus=invalid`)).status).toBe(400)
    }
    const revision = story.revision
    try {
      story.revision++
      const page = await (await fetch(`${baseUrl}/api/news/stories?readStatus=updated`)).json()
      expect(page.stories.map((value: { id: string }) => value.id)).toEqual([story.id])
    } finally { story.revision = revision }
  })

  it('keeps read revisions and exact related-event matches consistent with the local reader', async () => {
    const story = demoNewsStories[0]
    const patch = (readRevision: number | null) => fetch(`${baseUrl}/api/news/stories/${story.id}/reader`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ readRevision }) })
    expect((await patch(story.revision + 1)).status).toBe(409)
    expect(await (await patch(story.revision)).json()).toMatchObject({ readProgress: { revision: story.revision, developmentIds: story.developments.map(value => value.id) } })
    const page = await (await fetch(`${baseUrl}/api/news/stories?relatedTo=${story.id}`)).json()
    expect(page.stories.every((candidate: typeof story) => candidate.id !== story.id && (candidate.topics.some(value => story.topics.some(topic => topic.toLowerCase() === value.toLowerCase())) || candidate.symbols.some(value => story.symbols.includes(value))))).toBe(true)
    expect(await (await patch(null)).json()).toMatchObject({ readProgress: null })
  })
  it('searches and projects a conditional path separately from publisher counts and heat', async () => {
    const story = demoNewsStories[0]
    const previous = story.transmission
    const transmission = { steps: ['Reported change', 'Unique delivery channel'], condition: 'Only if implemented; no price response established.', reportIds: story.overviewReportIds }
    try {
      story.transmission = transmission
      const result = await (await fetch(`${baseUrl}/api/news/stories?keyword=Unique%20delivery%20channel`)).json()
      expect(result.stories).toEqual(expect.arrayContaining([expect.objectContaining({ id: story.id, transmission, reading: expect.objectContaining({ publishers: expect.any(Number), heat: 0 }) })]))
    } finally { story.transmission = previous }
  })
  it('projects automatic importance while preserving an explicit reader correction', async () => {
    const story = demoNewsStories[0]
    const previous = story.importance
    try {
      story.importance = { level: 'important', reason: 'Demonstration assessment grounded in this event.', reportIds: story.overviewReportIds }
      const discovered = await (await fetch(`${baseUrl}/api/news/stories?important=true`)).json()
      expect(discovered.stories.some((value: { id: string }) => value.id === story.id)).toBe(true)
      await fetch(`${baseUrl}/api/news/stories/${story.id}/reader`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"important":false}' })
      const corrected = await (await fetch(`${baseUrl}/api/news/stories?important=true`)).json()
      expect(corrected.stories.some((value: { id: string }) => value.id === story.id)).toBe(false)
    } finally { story.importance = previous }
  })
  it('mirrors important event designation, clearing and validation without using selected', async () => {
    const events = await (await fetch(`${baseUrl}/api/news/stories`)).json()
    const id = events.stories[0].id
    const mark = (important: unknown) => fetch(`${baseUrl}/api/news/stories/${id}/reader`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ important }) })
    expect((await mark('yes')).status).toBe(400)
    expect((await mark(true)).status).toBe(200)
    const marked = await (await fetch(`${baseUrl}/api/news?includeStories=true&important=true`)).json()
    expect(marked.stories.some((story: { id: string }) => story.id === id)).toBe(true)
    expect((await mark(false)).status).toBe(200)
    const cleared = await (await fetch(`${baseUrl}/api/news/stories?important=true`)).json()
    expect(cleared.stories.some((story: { id: string }) => story.id === id)).toBe(false)
    expect((await fetch(`${baseUrl}/api/news?important=maybe`)).status).toBe(400)
    expect((await fetch(`${baseUrl}/api/news/stories?important=maybe`)).status).toBe(400)
  })
  it('supports bookmark discovery without enabling native automation in demo', async () => {
    const events = await (await fetch(`${baseUrl}/api/news/stories`)).json()
    const id = events.stories[0].id
    expect((await fetch(`${baseUrl}/api/news/stories/${id}/reader`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"bookmarked":true}' })).status).toBe(200)
    const saved = await (await fetch(`${baseUrl}/api/news?includeStories=true&bookmarked=true`)).json()
    expect(saved.stories.map((story: { id: string }) => story.id)).toEqual([id])
    expect(saved.storyTopics.length).toBeGreaterThan(0)
    expect((await (await fetch(`${baseUrl}/api/news/automation`)).json()).workspaces).toEqual([])
    expect((await fetch(`${baseUrl}/api/news/automation`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(501)
  })
  it('applies category filtering before the result limit', async () => {
    const expected = demoNewsArticles.filter(article => (article.categories ?? '').split(/[;,]/).some(tag => tag.trim().toLowerCase() === 'ai')).sort((a, b) => Date.parse(a.time) - Date.parse(b.time)).slice(-1)
    expect(expected.length).toBe(1)
    const response = await fetch(`${baseUrl}/api/news?lookback=30d&categories=AI&limit=1`)
    const body = await response.json()
    expect(body.items.map((article: { title: string }) => article.title)).toEqual(expected.map(article => article.title))
  })
  it('keeps bodies out of event previews while searching older original evidence', async () => {
    const response = await fetch(`${baseUrl}/api/news?includeStories=true&readingView=selected&keyword=Orion`)
    const body = await response.json()
    expect(body.stories.map((story: { id: string }) => story.id)).toEqual(['demo-ai-model'])
    expect(body.stories[0].reports[0]).not.toHaveProperty('content')
    expect(body.storySources).toContain('Example Research Archive (Demo)')
    const full = await (await fetch(`${baseUrl}/api/news/stories/demo-ai-model`)).json()
    expect(full.reports[0].content).toContain('Orion')
  })
  it('offers an explicitly fictional issuer/X/company-news sample with original attribution', async () => {
    const response = await fetch(`${baseUrl}/api/news?sourceExact=${encodeURIComponent('Example, Inc. (Demo)')}`)
    const body = await response.json()
    expect(body.count).toBe(1)
    expect(body.items[0]).toMatchObject({ author: '@example_demo', kind: 'social', quote: { author: '@research_demo' }, symbols: ['DEMO:EXAMPLE'] })
  })
  it('supports literal source filtering and v2 credential status without storing key values', async () => {
    const sourceResponse = await fetch(`${baseUrl}/api/news?sourceExact=Reuters`)
    const sources = await sourceResponse.json()
    expect(sources.items.length).toBeGreaterThan(0)
    expect(sources.items.every((item: { source: string }) => item.source === 'Reuters')).toBe(true)
    const result = await fetch(`${baseUrl}/api/news/modules`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ artifact: { manifest: { abiVersion: 2, moduleId: 'example.news', name: 'Example', version: '1', description: '', entry: 'entry.mjs', credentials: [{ key: 'apiKey', label: 'Provider key' }], sources: [{ key: 'latest', name: 'Latest', parameters: [] }] }, files: { 'entry.mjs': 'throw new Error("Demo must never execute")' } } }) })
    const installed = await result.json()
    const path = `${baseUrl}/api/news/modules/${installed.contentHash}/credentials`
    await fetch(`${baseUrl}/api/news/modules/${installed.contentHash}/approve`, { method: 'POST' })
    const saved = await fetch(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'set', key: 'apiKey', value: 'private-demo-only' }) })
    expect(await saved.json()).toEqual({ credentials: [{ key: 'apiKey', label: 'Provider key', configured: true, available: true }] })
    expect(JSON.stringify(await (await fetch(path)).json())).not.toContain('private-demo-only')
  })
  it('uses an explicit range as an exclusive-start, inclusive-end interval', async () => {
    const start = demoNewsArticles.find((article) => article.title.startsWith('Hang Seng TECH'))!
    const end = demoNewsArticles.find((article) => article.title.startsWith('NVDA'))!
    const response = await fetch(`${baseUrl}/api/news?startTime=${encodeURIComponent(start.time)}&endTime=${encodeURIComponent(end.time)}`)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.lookback).toBeNull()
    expect(body.items.map((article: { title: string }) => article.title)).toEqual(['NVDA gains 2.8% on data center capex commentary'])
  })

  it('derives honest collector status from the current demo config', async () => {
    const config: NewsCollectorConfig = {
      enabled: true,
      intervalMinutes: 10,
      maxInMemory: 2000,
      retentionDays: 7,
      rsshubBaseUrl: 'https://rsshub.example.test/custom/',
      modules: [],
      subscriptions: [],
      feeds: [
        {
          id: 'direct',
          name: 'Direct Feed',
          url: 'https://direct.example.test/rss.xml',
          source: 'direct',
          enabled: true,
        },
        {
          id: 'routed',
          name: 'Routed Feed',
          url: 'https://unused.example.test/rss.xml',
          rsshubRoute: 'feeds/markets',
          source: 'routed',
          enabled: true,
        },
        {
          id: 'disabled',
          name: 'Disabled Feed',
          url: 'https://disabled.example.test/rss.xml',
          source: 'disabled',
          enabled: false,
        },
      ],
    }
    await updateNewsConfig(config)

    const response = await fetch(`${baseUrl}/api/news/collector`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      feeds: [
        {
          id: 'direct',
          source: 'direct',
          url: 'https://direct.example.test/rss.xml',
          name: 'Direct Feed',
          ...unobservedFreshness,
          state: 'never_attempted',
          lastAttemptAt: null,
          lastSuccessAt: null,
          lastItemCount: null,
          lastNewItemCount: null,
          lastError: null,
        },
        {
          id: 'routed',
          source: 'routed',
          url: 'https://rsshub.example.test/custom/feeds/markets',
          name: 'Routed Feed',
          ...unobservedFreshness,
          state: 'never_attempted',
          lastAttemptAt: null,
          lastSuccessAt: null,
          lastItemCount: null,
          lastNewItemCount: null,
          lastError: null,
        },
        {
          id: 'disabled',
          source: 'disabled',
          url: 'https://disabled.example.test/rss.xml',
          name: 'Disabled Feed',
          ...unobservedFreshness,
          state: 'disabled',
          lastAttemptAt: null,
          lastSuccessAt: null,
          lastItemCount: null,
          lastNewItemCount: null,
          lastError: null,
        },
      ],
    })
  })

  it('returns an explicit refusal for disabled and enabled demo collection', async () => {
    const config: NewsCollectorConfig = {
      enabled: false,
      intervalMinutes: 10,
      maxInMemory: 2000,
      retentionDays: 7,
      rsshubBaseUrl: 'http://127.0.0.1:1200',
      modules: [],
      subscriptions: [],
      feeds: [
        {
          id: 'demo',
          name: 'Demo Feed',
          url: 'https://demo.example.test/rss.xml',
          source: 'demo',
          enabled: true,
        },
      ],
    }
    await updateNewsConfig(config)

    const statusResponse = await fetch(`${baseUrl}/api/news/collector`)
    expect(statusResponse.status).toBe(200)
    await expect(statusResponse.json()).resolves.toEqual({
      feeds: [
        {
          id: 'demo',
          source: 'demo',
          url: 'https://demo.example.test/rss.xml',
          name: 'Demo Feed',
          state: 'disabled',
          lastAttemptAt: null,
          lastSuccessAt: null,
          lastItemCount: null,
          lastNewItemCount: null,
          lastError: null,
          lastPublishedAt: null,
          lastUndatedItemCount: null,
          lastEmptyContentCount: null,
          lastEmptyItemCount: null,
          lastDurationMs: null,
        },
      ],
    })

    const disabledResponse = await fetch(`${baseUrl}/api/news/collect`, { method: 'POST' })
    expect(disabledResponse.status).toBe(409)
    await expect(disabledResponse.json()).resolves.toEqual({ error: 'News collection is disabled' })

    await updateNewsConfig({ ...config, enabled: true })
    const enabledResponse = await fetch(`${baseUrl}/api/news/collect`, { method: 'POST' })
    expect(enabledResponse.status).toBe(501)
    await expect(enabledResponse.json()).resolves.toEqual({ error: 'Demo mode does not fetch external news' })
  })


  it('applies production-supported lookbacks and literal text and source filters before limit', async () => {
    const response = await fetch(`${baseUrl}/api/news?lookback=24h&source=Reuters&keyword=traders&limit=1`)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.count).toBe(1)
    expect(body.items[0].title).toBe('Dollar eases as traders reassess the next Fed move')
    expect(body.items[0].source).toBe('Reuters')
  })

  it('accepts the production-supported lookback values and orders results chronologically', async () => {
    const response = await fetch(`${baseUrl}/api/news?lookback=2h`)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.lookback).toBe('2h')
    expect(body.items.map((article: { title: string }) => article.title)).toEqual([
      'CSI 300 advances as financials and industrials strengthen',
      'Apple Q1 services revenue grows 9.1%, slowest since 2019',
      '【演示】沪深两市成交额连续第二日回升。',
      '【演示】沪深两市成交额连续第二日回升',
      '【演示】美联储，维持政策利率不变。',
      '【演示】美联储：维持政策利率不变',
      '【演示】美联储维持政策利率不变',
      '【演示】模型开放开发者申请',
      '[Demo] Research model access opens to developers',
      '【演示】示例公司发布 Model One',
      '【演示】示例公司发布 Model One',
      '【演示】示例公司发布 Model One',
    ])
  })

  it('rejects empty timestamps like the production route', async () => {
    const response = await fetch(`${baseUrl}/api/news?startTime=`)
    expect(response.status).toBe(400)
  })
})
