import { describe, expect, it, vi } from 'vitest'

import {
  aggregateStarHistory,
  fetchStargazerTimestamps,
  renderStarHistorySvg,
} from './generate-star-history.mjs'

describe('aggregateStarHistory', () => {
  it('creates a cumulative point for every UTC day without retaining user data', () => {
    const points = aggregateStarHistory([
      '2026-02-21T18:00:00Z',
      '2026-02-19T10:40:01Z',
      '2026-02-19T20:15:00Z',
    ])

    expect(points).toEqual([
      { date: new Date('2026-02-19T00:00:00Z'), count: 2 },
      { date: new Date('2026-02-20T00:00:00Z'), count: 2 },
      { date: new Date('2026-02-21T00:00:00Z'), count: 3 },
    ])
  })

  it('rejects empty or invalid histories', () => {
    expect(() => aggregateStarHistory([])).toThrow('no valid stargazer timestamps')
    expect(() => aggregateStarHistory(['not-a-date'])).toThrow('no valid stargazer timestamps')
  })
})

describe('fetchStargazerTimestamps', () => {
  it('paginates and keeps only timestamp fields', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      starred_at: `2026-02-19T10:${String(index % 60).padStart(2, '0')}:00Z`,
      user: { login: `private-user-${index}` },
    }))
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => firstPage,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ starred_at: '2026-02-20T12:00:00Z', user: { login: 'last-user' } }],
      })

    const timestamps = await fetchStargazerTimestamps({
      token: 'test-token',
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(timestamps).toHaveLength(101)
    expect(timestamps.at(-1)).toBe('2026-02-20T12:00:00Z')
    expect(JSON.stringify(timestamps)).not.toContain('private-user')
  })
})

describe('renderStarHistorySvg', () => {
  it('renders an accessible self-contained chart without stargazer identities', () => {
    const points = aggregateStarHistory([
      '2026-02-19T10:40:01Z',
      '2026-02-20T12:00:00Z',
      '2026-03-20T12:00:00Z',
    ])
    const svg = renderStarHistorySvg({
      points,
      generatedAt: new Date('2026-03-20T13:00:00Z'),
    })

    expect(svg).toContain('<title id="title">TraderAlice/OpenAlice star history</title>')
    expect(svg).toContain('<desc id="description">')
    expect(svg).toContain('<aggregation>daily cumulative active stargazers</aggregation>')
    expect(svg).toContain('<generated-at>2026-03-20T13:00:00.000Z</generated-at>')
    expect(svg).toContain('<theme>light</theme>')
    expect(svg).toContain('stop-color="#fbfffd"')
    expect(svg).not.toContain('LAST 30 DAYS')
    expect(svg).not.toContain('login')
    expect(svg).not.toContain('starred_at')
  })

  it('renders the matching dark-mode palette', () => {
    const points = aggregateStarHistory([
      '2026-02-19T10:40:01Z',
      '2026-03-20T12:00:00Z',
    ])
    const svg = renderStarHistorySvg({
      points,
      generatedAt: new Date('2026-03-20T13:00:00Z'),
      theme: 'dark',
    })

    expect(svg).toContain('<theme>dark</theme>')
    expect(svg).toContain('stop-color="#101a16"')
    expect(svg).toContain('stroke="#63d6aa"')
  })
})
