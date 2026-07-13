/**
 * Regression tests for the Yahoo Finance error-surfacing path.
 * @see https://github.com/TraderAlice/OpenAlice/issues/375
 *
 * Before the fix, a Yahoo rate-limit (HTTP 429 on the K-line / crumb endpoint)
 * made every per-symbol fetch reject; the historical models' Promise.allSettled
 * kept only fulfilled rows and then threw a generic
 * `EmptyDataError('No historical data returned')`. That masked a transient,
 * fixable client-side block as if the symbol genuinely had no history. These
 * tests pin the two helpers that now surface the real cause.
 */

import { describe, it, expect } from 'vitest'
import { classifyYahooFetchError, emptyHistoricalError } from './helpers.js'
import {
  EmptyDataError,
  OpenBBError,
  NetworkUnreachableError,
  RateLimitedError,
} from '../../../core/provider/utils/errors.js'

/** Build a yahoo-finance2-style HTTPError (name='HTTPError', numeric `.code`). */
function httpError(status: number, message: string): Error {
  const e = new Error(message) as Error & { code?: number }
  e.name = 'HTTPError'
  e.code = status
  return e
}

describe('classifyYahooFetchError (issue #375)', () => {
  it('maps HTTP 429 to a RateLimitedError that explains it is NOT missing data', () => {
    const out = classifyYahooFetchError('MU', httpError(429, 'Edge: Too Many Requests'))
    expect(out).toBeInstanceOf(RateLimitedError)
    expect(out.message).toMatch(/RATE_LIMITED/)
    expect(out.message).toMatch(/HTTP 429/)
    expect(out.message).toMatch(/MU/)
    expect(out.message).toMatch(/NOT a missing-data/)
    // remediation must be actionable, not just a status echo
    expect(out.message).toMatch(/retry|switch data source/i)
  })

  it('maps a bare "Too Many Requests" message (no numeric code) to RateLimitedError', () => {
    expect(classifyYahooFetchError('AAPL', new Error('Too Many Requests')))
      .toBeInstanceOf(RateLimitedError)
  })

  it('treats 401 / 403 / crumb failures as the same Yahoo-block syndrome', () => {
    expect(classifyYahooFetchError('AAPL', httpError(401, 'Unauthorized'))).toBeInstanceOf(RateLimitedError)
    expect(classifyYahooFetchError('AAPL', httpError(403, 'Forbidden'))).toBeInstanceOf(RateLimitedError)
    expect(classifyYahooFetchError('AAPL', new Error('Failed to obtain crumb'))).toBeInstanceOf(RateLimitedError)
  })

  it('maps a DNS/connection failure to NetworkUnreachableError', () => {
    const net = new TypeError('fetch failed') as TypeError & { cause?: unknown }
    net.cause = Object.assign(new Error('getaddrinfo ENOTFOUND finance.yahoo.com'), { code: 'ENOTFOUND' })
    expect(classifyYahooFetchError('AAPL', net)).toBeInstanceOf(NetworkUnreachableError)
  })

  it('passes an unrecognized error through unchanged (never masks)', () => {
    const weird = new Error('something totally different')
    expect(classifyYahooFetchError('AAPL', weird)).toBe(weird)
  })
})

describe('emptyHistoricalError (issue #375)', () => {
  it('re-throws the sole rejection verbatim, preserving its type + message', () => {
    const rl = new RateLimitedError('Yahoo Finance', 'Too Many Requests', { symbol: 'MU', status: 429 })
    const results: PromiseSettledResult<unknown>[] = [{ status: 'rejected', reason: rl }]
    expect(emptyHistoricalError(results, 'No historical data returned')).toBe(rl)
  })

  it('re-throws verbatim when many symbols hit the same wall (uniform rate-limit)', () => {
    const a = new RateLimitedError('Yahoo Finance', 'Too Many Requests', { status: 429 })
    const b = new RateLimitedError('Yahoo Finance', 'Too Many Requests', { status: 429 })
    const results: PromiseSettledResult<unknown>[] = [
      { status: 'rejected', reason: a },
      { status: 'rejected', reason: b },
    ]
    const out = emptyHistoricalError(results, 'No historical data returned')
    expect(out).toBeInstanceOf(RateLimitedError)
    expect(out).toBe(a)
  })

  it('aggregates distinct failure reasons across symbols', () => {
    const results: PromiseSettledResult<unknown>[] = [
      { status: 'rejected', reason: new Error('Too Many Requests') },
      { status: 'rejected', reason: new Error('Quote not found for symbol XYZ') },
    ]
    const out = emptyHistoricalError(results, 'No historical data returned')
    expect(out).toBeInstanceOf(OpenBBError)
    expect(out.message).toMatch(/Too Many Requests/)
    expect(out.message).toMatch(/Quote not found/)
  })

  it('falls back to a plain EmptyDataError when there were no rejections', () => {
    const results: PromiseSettledResult<unknown>[] = [{ status: 'fulfilled', value: [] }]
    const out = emptyHistoricalError(results, 'No historical data returned')
    expect(out).toBeInstanceOf(EmptyDataError)
    expect(out.message).toBe('No historical data returned')
  })
})
