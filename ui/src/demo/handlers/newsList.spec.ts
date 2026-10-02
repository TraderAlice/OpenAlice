// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'

import { demoNewsArticles } from '../fixtures/news'
import { newsListHandlers } from './newsList'

const server = setupServer(...newsListHandlers)
const baseUrl = window.location.origin

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('demo News handlers', () => {
  it.each(['F', 'A', 'T', 'BRK.B', 'BTC-USD', '^GSPC', '2330.TW', 'EURUSD=X'])('matches complete Symbol tokens for %s', async (symbol) => {
    const fixture = { time: new Date().toISOString(), content: '', source: 'test', link: null, categories: null }
    const original = [...demoNewsArticles]
    demoNewsArticles.splice(0, demoNewsArticles.length,
      { ...fixture, title: 'Fed cuts rates and AAPL rises' },
      { ...fixture, title: `X${symbol}X update` },
      { ...fixture, title: `($${symbol.toLowerCase()}) announces earnings.` },
    )
    try {
      const response = await fetch(`${baseUrl}/api/news?symbol=${encodeURIComponent(symbol)}`)
      expect((await response.json()).items.map((article: { title: string }) => article.title)).toEqual([`($${symbol.toLowerCase()}) announces earnings.`])
      const keyword = await fetch(`${baseUrl}/api/news?keyword=fed`)
      expect((await keyword.json()).count).toBe(1)
    } finally {
      demoNewsArticles.splice(0, demoNewsArticles.length, ...original)
    }
  })

  it('uses exact tag ownership, dimension and aliases rather than keyword text', async () => {
    const source = await fetch(`${baseUrl}/api/news?tag=source:region:USA`)
    const sourceBody = await source.json()
    expect(sourceBody.items.map((row: { title: string }) => row.title)).toEqual(['Household budgeting tips from a US feed'])
    expect(sourceBody.items[0].categoryScope).toBe('source')
    const article = await fetch(`${baseUrl}/api/news?tag=article:region:us`)
    expect((await article.json()).items.every((row: { categoryScope: string }) => row.categoryScope === 'article')).toBe(true)
    const unknown = await fetch(`${baseUrl}/api/news?tag=unknown:unknown:cn`)
    expect((await unknown.json()).items[0].title).toBe('Archived article with unknown category origin')
    expect((await fetch(`${baseUrl}/api/news?tag=source:market:us`)).status).toBe(400)
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
