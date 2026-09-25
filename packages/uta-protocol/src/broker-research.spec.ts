import { describe, it, expect } from 'vitest'
import { fundingRateHistorySchema, fundingRateSchema } from './broker-research.js'

describe('fundingRateSchema', () => {
  it('requires an aliceId and nothing else', () => {
    expect(fundingRateSchema.safeParse({ aliceId: 'bybit-main|BTC/USDT:USDT' }).success).toBe(true)
    expect(fundingRateSchema.safeParse({ aliceId: '' }).success).toBe(false)
    expect(fundingRateSchema.safeParse({}).success).toBe(false)
  })
})

describe('fundingRateHistorySchema', () => {
  it('accepts a bounded window and drops the unset fields', () => {
    const parsed = fundingRateHistorySchema.parse({ aliceId: 'bybit-main|BTC/USDT:USDT', limit: 1000 })
    expect(parsed).toEqual({ aliceId: 'bybit-main|BTC/USDT:USDT', limit: 1000 })
  })

  // Both spellings name the same instant and agent callers emit either; a bare
  // date is not a time, and neither is a word.
  it.each(['2026-09-23T00:00:00.000Z', '2026-09-23T08:00:00Z', '2026-09-23T08:00:00+08:00'])('accepts %s as start', (start) => {
    expect(fundingRateHistorySchema.safeParse({ aliceId: 'a|b', start }).success).toBe(true)
  })

  it.each(['yesterday', '2026-09-23', '2026-09-23T08:00:00', ''])('rejects %s as start', (start) => {
    expect(fundingRateHistorySchema.safeParse({ aliceId: 'a|b', start }).success).toBe(false)
  })

  it.each([0, -1, 1001, 1.5])('rejects the out-of-range limit %s', (limit) => {
    expect(fundingRateHistorySchema.safeParse({ aliceId: 'a|b', limit }).success).toBe(false)
  })
})
