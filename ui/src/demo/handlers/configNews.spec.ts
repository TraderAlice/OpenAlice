// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'

import type { AppConfig, NewsCollectorConfig } from '../../api/types'
import { configKeysHandlers, resetDemoNewsConfig } from './configKeys'

const server = setupServer(...configKeysHandlers)
const baseUrl = window.location.origin

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
beforeEach(resetDemoNewsConfig)
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

async function loadConfig(): Promise<AppConfig> {
  const response = await fetch(`${baseUrl}/api/config`)
  expect(response.status).toBe(200)
  return response.json()
}

describe('demo News Collector config', () => {
  it('loads representative RSS feeds', async () => {
    const config = await loadConfig()
    const news = config.news as NewsCollectorConfig

    expect(news.enabled).toBe(true)
    expect(news.feeds.map((feed) => feed.source)).toEqual(['fed', 'coindesk'])
  })

  it('round-trips News Collector mutations for the current demo session', async () => {
    const current = (await loadConfig()).news as NewsCollectorConfig
    const next: NewsCollectorConfig = {
      ...current,
      intervalMinutes: 15,
      feeds: [
        ...current.feeds,
        {
          name: 'Example Markets',
          url: 'https://example.com/markets.xml',
          source: 'example-markets',
          enabled: true,
        },
      ],
    }

    const response = await fetch(`${baseUrl}/api/config/news`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(next)
    expect((await loadConfig()).news).toEqual(next)
  })

  it('rejects invalid feed URLs like the production schema', async () => {
    const current = (await loadConfig()).news as NewsCollectorConfig
    const response = await fetch(`${baseUrl}/api/config/news`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...current,
        feeds: [{ name: 'Broken', url: 'not-a-url', source: 'broken' }],
      }),
    })

    expect(response.status).toBe(400)
  })
})
