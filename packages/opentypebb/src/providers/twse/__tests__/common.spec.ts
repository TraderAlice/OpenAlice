/**
 * Unit tests for shared TWSE provider helpers.
 *
 * Raw value fixtures mirror live API shapes (verified 2026-06-08):
 * - ROC dates: "1150605" (= 2026-06-05)
 * - Numeric strings: "14.55", "-0.3100", "+0.06", "" (empty = no data)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  rocToIso,
  toNum,
  parseTwSymbol,
  boardsNeeded,
  twseFetch,
  __resetTwseFetch,
  __twseFetchInternals,
} from '../models/common.js'

describe('rocToIso', () => {
  it('converts ROC calendar dates to ISO', () => {
    expect(rocToIso('1150605')).toBe('2026-06-05')
    expect(rocToIso('0991231')).toBe('2010-12-31')
  })

  it('returns null for empty or malformed input', () => {
    expect(rocToIso('')).toBeNull()
    expect(rocToIso('115')).toBeNull()
    expect(rocToIso(undefined)).toBeNull()
  })
})

describe('toNum', () => {
  it('parses plain and signed numeric strings', () => {
    expect(toNum('14.55')).toBe(14.55)
    expect(toNum('-0.3100')).toBe(-0.31)
    expect(toNum('+0.06')).toBe(0.06)
    expect(toNum('60780296')).toBe(60780296)
  })

  it('strips thousands separators', () => {
    expect(toNum('1,234,567')).toBe(1234567)
  })

  it('returns null for empty / non-numeric values', () => {
    expect(toNum('')).toBeNull()
    expect(toNum('--')).toBeNull()
    expect(toNum(undefined)).toBeNull()
  })
})

describe('parseTwSymbol', () => {
  it('parses Yahoo-suffixed symbols into code + board', () => {
    expect(parseTwSymbol('2330.TW')).toEqual({ code: '2330', board: 'TWSE' })
    expect(parseTwSymbol('6488.TWO')).toEqual({ code: '6488', board: 'TPEX' })
  })

  it('bare codes have no board (search both)', () => {
    expect(parseTwSymbol('2330')).toEqual({ code: '2330', board: undefined })
  })

  it('is case-insensitive on the suffix', () => {
    expect(parseTwSymbol('2330.tw')).toEqual({ code: '2330', board: 'TWSE' })
  })
})

describe('boardsNeeded', () => {
  it('suffix-only queries touch only the needed board', () => {
    expect(boardsNeeded([parseTwSymbol('2330.TW')])).toEqual({ twse: true, tpex: false })
    expect(boardsNeeded([parseTwSymbol('6488.TWO')])).toEqual({ twse: false, tpex: true })
  })

  it('bare codes need both boards', () => {
    expect(boardsNeeded([parseTwSymbol('2330')])).toEqual({ twse: true, tpex: true })
  })

  it('mixed queries union the boards', () => {
    expect(boardsNeeded([parseTwSymbol('2330.TW'), parseTwSymbol('6488.TWO')]))
      .toEqual({ twse: true, tpex: true })
  })
})

describe('twseFetch', () => {
  const TWSE_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
  const TPEX_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes'

  // Fake clock + recording sleep so spacing/backoff are observable without real timers.
  let clock = 0
  let sleeps: number[]
  let request: ReturnType<typeof vi.fn>

  const origNow = __twseFetchInternals.now
  const origSleep = __twseFetchInternals.sleep
  const origRequest = __twseFetchInternals.request

  beforeEach(() => {
    __resetTwseFetch()
    clock = 0
    sleeps = []
    request = vi.fn(async (_url: string) => ({ ok: true }))
    __twseFetchInternals.now = () => clock
    __twseFetchInternals.sleep = async (ms: number) => { sleeps.push(ms) }
    __twseFetchInternals.request = request as typeof __twseFetchInternals.request
  })

  afterEach(() => {
    __twseFetchInternals.now = origNow
    __twseFetchInternals.sleep = origSleep
    __twseFetchInternals.request = origRequest
    __resetTwseFetch()
  })

  it('caches by URL — a second call within TTL hits no network', async () => {
    const a = await twseFetch(TWSE_URL)
    const b = await twseFetch(TWSE_URL)
    expect(request).toHaveBeenCalledTimes(1)
    expect(a).toBe(b) // same cached promise resolution
  })

  it('re-fetches once the TTL has elapsed', async () => {
    await twseFetch(TWSE_URL)
    clock += 10 * 60 * 1000 + 1 // just past the 10-min TTL
    await twseFetch(TWSE_URL)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('coalesces concurrent callers into one in-flight request', async () => {
    const [a, b] = await Promise.all([twseFetch(TWSE_URL), twseFetch(TWSE_URL)])
    expect(request).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })

  it('spaces consecutive same-host requests by the min interval', async () => {
    await twseFetch(TWSE_URL)
    // Different URL, same host → cache miss, must wait its turn.
    await twseFetch('https://openapi.twse.com.tw/v1/opendata/t187ap03_L')
    expect(sleeps).toContain(1700)
  })

  it('does not throttle the first request to a host', async () => {
    await twseFetch(TWSE_URL) // openapi.twse.com.tw
    await twseFetch(TPEX_URL) // www.tpex.org.tw — independent host, no spacing
    expect(sleeps).toEqual([])
  })

  it('retries with backoff then succeeds', async () => {
    request
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValueOnce({ ok: true })
    const out = await twseFetch(TWSE_URL)
    expect(out).toEqual({ ok: true })
    expect(request).toHaveBeenCalledTimes(2)
    expect(sleeps).toContain(600) // first backoff
  })

  it('throws after exhausting retries and does not cache the failure', async () => {
    request.mockRejectedValue(new Error('boom'))
    await expect(twseFetch(TWSE_URL)).rejects.toThrow('boom')
    expect(request).toHaveBeenCalledTimes(3) // initial + 2 backoff retries

    // Failure was evicted — the next call retries from scratch.
    request.mockResolvedValue({ ok: true })
    await expect(twseFetch(TWSE_URL)).resolves.toEqual({ ok: true })
  })
})
