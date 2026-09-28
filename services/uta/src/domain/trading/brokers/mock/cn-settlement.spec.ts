import { describe, it, expect } from 'vitest'
import { getSettlement, VERIFIED_SETTLEMENT } from './cn-settlement.js'

describe('getSettlement', () => {
  it('returns verified T0 for 513100 without needing a name', () => {
    const s = getSettlement('513100.SH')
    expect(s).toMatchObject({
      symbol: '513100',
      mode: 'T0',
      source: 'manual',
      needsReview: false,
    })
    expect(s.reason).toContain('纳指')
  })

  it('returns verified T0 for 518880', () => {
    expect(getSettlement('518880').mode).toBe('T0')
    expect(VERIFIED_SETTLEMENT['518880']?.mode).toBe('T0')
  })

  it('infers T0 for commodity ETF by name (needs review)', () => {
    const s = getSettlement('159985', '豆粕ETF')
    expect(s.mode).toBe('T0')
    expect(s.source).toBe('heuristic')
    expect(s.needsReview).toBe(true)
    expect(s.reason).toContain('商品')
  })

  it('infers T0 for money-market ETF by name', () => {
    const s = getSettlement('511880', '银华日利ETF')
    expect(s.mode).toBe('T0')
    expect(s.reason).toContain('货币')
  })

  it('keeps A-share equity ETF on T1', () => {
    const s = getSettlement('510300', '沪深300ETF')
    expect(s.mode).toBe('T1')
    expect(s.source).toBe('heuristic')
    expect(s.needsReview).toBe(false)
  })

  it('conservatively T1s 沪港深 ETF pending review', () => {
    const s = getSettlement('517030', '沪港深300ETF')
    expect(s.mode).toBe('T1')
    expect(s.source).toBe('fallback')
    expect(s.needsReview).toBe(true)
  })

  it('treats convertible-bond codes as T0', () => {
    const s = getSettlement('113050')
    expect(s.mode).toBe('T0')
    expect(s.reason).toContain('可转债')
  })

  it('treats A-share stocks as T1', () => {
    expect(getSettlement('600519').mode).toBe('T1')
    expect(getSettlement('600519').reason).toContain('股票')
  })

  it('falls back to T1 when ETF has no name', () => {
    const s = getSettlement('513050')
    expect(s.mode).toBe('T1')
    expect(s.source).toBe('fallback')
    expect(s.needsReview).toBe(true)
  })

  it('falls back to T1 for unknown codes', () => {
    const s = getSettlement('999999')
    expect(s.mode).toBe('T1')
    expect(s.needsReview).toBe(true)
  })
})
