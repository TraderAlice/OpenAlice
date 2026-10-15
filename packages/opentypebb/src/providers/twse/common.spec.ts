import { describe, it, expect } from 'vitest'
import { rocToISO, cleanNum, cleanStr, parseTwSymbol } from './common.js'

describe('common normalizers', () => {
  it('rocToISO — ROC + Gregorian + boundaries + junk', () => {
    expect(rocToISO('1150626')).toBe('2026-06-26') // 民國115 = 2026 (7-digit)
    expect(rocToISO('0760907')).toBe('1987-09-07') // 民國076 = 1987 (7-digit)
    expect(rocToISO('20180808')).toBe('2018-08-08') // 8-digit Gregorian
    expect(rocToISO('19110626')).toBe('1911-06-26') // 1911 boundary = Gregorian, not ROC
    expect(rocToISO('00010626')).toBe('1912-06-26') // 8-digit zero-padded ROC year 1 = 1912
    expect(rocToISO('20340645')).toBeNull() // invalid day 45 → null
    expect(rocToISO('20260026')).toBeNull() // month 00 → null
    expect(rocToISO('')).toBeNull()
    expect(rocToISO(null)).toBeNull()
    expect(rocToISO('abc')).toBeNull()
  })

  it('cleanNum — commas, trailing/full-width spaces, blanks, dashes', () => {
    expect(cleanNum('1,234.5')).toBe(1234.5)
    expect(cleanNum('-2.88 ')).toBe(-2.88) // trailing space
    expect(cleanNum('14.82')).toBe(14.82)
    expect(cleanNum('')).toBeNull()
    expect(cleanNum('－')).toBeNull()
    expect(cleanNum('  ')).toBeNull()
  })

  it('cleanStr — trims full-width (U+3000) space, dash-only → null', () => {
    expect(cleanStr('MORNSUN　')).toBe('MORNSUN')
    expect(cleanStr('  台積電 ')).toBe('台積電')
    expect(cleanStr('－ ')).toBeNull()
    expect(cleanStr(null)).toBeNull()
  })

  it('parseTwSymbol — board split, ETF letter codes, rejects non-TW', () => {
    expect(parseTwSymbol('2330.TW')).toEqual({ code: '2330', board: 'TW' })
    expect(parseTwSymbol('6488.TWO')).toEqual({ code: '6488', board: 'TWO' })
    expect(parseTwSymbol('00400A.TW')).toEqual({ code: '00400A', board: 'TW' })
    expect(parseTwSymbol('AAPL')).toBeNull()
    expect(parseTwSymbol('2330')).toBeNull()
  })
})
