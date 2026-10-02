import { describe, it, expect } from 'vitest'
import { TWSEEquitySearchFetcher } from './equity-search.js'
const q = {} as never

describe('EquitySearch transformData', () => {
  it('emits Yahoo-suffix symbol + prefers short-name', () => {
    const out = TWSEEquitySearchFetcher.transformData(q, [
      { code: '2330', name: '台灣積體電路製造股份有限公司', abbr: '台積電', enName: 'TSMC', industry: '24', board: 'TW', raw: {} },
      { code: '6488', name: '環球晶圓股份有限公司', abbr: '環球晶', enName: 'GWC', industry: '33', board: 'TWO', raw: {} },
    ])
    expect(out[0]).toMatchObject({ symbol: '2330.TW', name: '台積電', exchange: 'TWSE' })
    expect(out[1]).toMatchObject({ symbol: '6488.TWO', name: '環球晶', exchange: 'TPEx' })
  })
})
