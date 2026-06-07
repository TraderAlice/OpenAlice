/**
 * Unit tests for shared TWSE provider helpers.
 *
 * Raw value fixtures mirror live API shapes (verified 2026-06-08):
 * - ROC dates: "1150605" (= 2026-06-05)
 * - Numeric strings: "14.55", "-0.3100", "+0.06", "" (empty = no data)
 */

import { describe, it, expect } from 'vitest'
import { rocToIso, toNum, parseTwSymbol, boardsNeeded } from '../models/common.js'

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
