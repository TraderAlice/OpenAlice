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
