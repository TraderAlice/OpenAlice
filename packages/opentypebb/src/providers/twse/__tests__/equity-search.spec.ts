/**
 * Unit tests for the TWSE EquitySearch fetcher's pure transform logic.
 *
 * Raw API fixtures mirror the live shapes (verified 2026-06-07):
 * - TWSE STOCK_DAY_ALL: { Code, Name, ... }
 * - TPEx tpex_mainboard_quotes: { SecuritiesCompanyCode, CompanyName, ... }
 * - TWSE t187ap03_L: { 公司代號, 公司簡稱, 英文簡稱, ... }
 */

import { describe, it, expect } from 'vitest'
import {
  mergeTwSources,
  TwseEquitySearchFetcher,
  type TwSecurityEntry,
} from '../models/equity-search.js'

const TWSE_DAILY = [
  { Code: '2330', Name: '台積電' },
  { Code: '0050', Name: '元大台灣50' },
]

const TPEX_QUOTES = [
  { SecuritiesCompanyCode: '6488', CompanyName: '環球晶' },
  { SecuritiesCompanyCode: '00679B', CompanyName: '元大美債20年' },
]

const TWSE_PROFILES = [
  { 公司代號: '2330', 公司簡稱: '台積電', 英文簡稱: 'TSMC' },
]

describe('mergeTwSources', () => {
  it('merges listed + OTC with board tags and English names', () => {
    const merged = mergeTwSources(TWSE_DAILY, TPEX_QUOTES, TWSE_PROFILES)
    expect(merged).toHaveLength(4)

    const tsmc = merged.find((e) => e.code === '2330')
    expect(tsmc).toMatchObject({ code: '2330', name: '台積電', nameEn: 'TSMC', board: 'TWSE' })

    const gw = merged.find((e) => e.code === '6488')
    expect(gw).toMatchObject({ code: '6488', name: '環球晶', board: 'TPEX' })
    expect(gw?.nameEn).toBeUndefined()
  })

  it('tolerates an empty profiles list (English names optional)', () => {
    const merged = mergeTwSources(TWSE_DAILY, TPEX_QUOTES, [])
    expect(merged).toHaveLength(4)
    expect(merged.every((e) => e.nameEn === undefined)).toBe(true)
  })
})

describe('TwseEquitySearchFetcher.transformData', () => {
  const ENTRIES: TwSecurityEntry[] = [
    { code: '2330', name: '台積電', nameEn: 'TSMC', board: 'TWSE' },
    { code: '0050', name: '元大台灣50', board: 'TWSE' },
    { code: '6488', name: '環球晶', board: 'TPEX' },
  ]

  const transform = (query: string) =>
    TwseEquitySearchFetcher.transformData(
      TwseEquitySearchFetcher.transformQuery({ query }),
      ENTRIES,
    )

  it('suffixes listed securities with .TW and OTC with .TWO', () => {
    const all = transform('')
    expect(all.map((d) => d.symbol)).toEqual(['2330.TW', '0050.TW', '6488.TWO'])
    expect(all.map((d) => d.exchange)).toEqual(['TWSE', 'TWSE', 'TPEX'])
  })

  it('appends the English short name when available', () => {
    const all = transform('')
    expect(all[0].name).toBe('台積電 (TSMC)')
    expect(all[1].name).toBe('元大台灣50')
  })

  it('empty query returns all entries (bulk load for SymbolIndex)', () => {
    expect(transform('')).toHaveLength(3)
  })

  it('filters by code', () => {
    const hits = transform('2330')
    expect(hits).toHaveLength(1)
    expect(hits[0].symbol).toBe('2330.TW')
  })

  it('filters by Chinese name', () => {
    const hits = transform('台積電')
    expect(hits.map((d) => d.symbol)).toEqual(['2330.TW'])
  })

  it('filters by English name, case-insensitive', () => {
    const hits = transform('tsmc')
    expect(hits.map((d) => d.symbol)).toEqual(['2330.TW'])
  })
})
