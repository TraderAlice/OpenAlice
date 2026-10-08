// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import type { NewsCollectorConfig } from '../../api/types'
import { configKeysHandlers, resetDemoNewsConfig } from './configKeys'

import { demoNewsArticles } from '../fixtures/news'
import { newsListHandlers } from './newsList'

const server = setupServer(...configKeysHandlers, ...newsListHandlers)
const baseUrl = window.location.origin

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
beforeEach(resetDemoNewsConfig)
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
    ])
  })

  it('rejects empty timestamps like the production route', async () => {
    const response = await fetch(`${baseUrl}/api/news?startTime=`)
    expect(response.status).toBe(400)
  })
})
