import { describe, expect, it } from 'vitest'
import { resolveCnRealtimeQuote } from './cn-realtime-quote'

describe('resolveCnRealtimeQuote', () => {
  it('routes Eastmoney secids through Tencent at 3s', () => {
    expect(resolveCnRealtimeQuote('1.600519', 'eastmoney|1.600519')).toEqual({
      symbol: '1.600519',
      provider: 'tencent',
      pollMs: 3000,
    })
    expect(resolveCnRealtimeQuote('0.000001', 'eastmoney|0.000001')?.provider).toBe('tencent')
  })

  it('routes Yahoo / prefixed / bare A-share tickers', () => {
    expect(resolveCnRealtimeQuote('600519.SS')?.provider).toBe('tencent')
    expect(resolveCnRealtimeQuote('sz000001')?.provider).toBe('tencent')
    expect(resolveCnRealtimeQuote('300750')?.provider).toBe('tencent')
  })

  it('leaves non-A-share symbols on the default quote path', () => {
    expect(resolveCnRealtimeQuote('AAPL')).toBeNull()
    expect(resolveCnRealtimeQuote('2330.TW')).toBeNull()
    expect(resolveCnRealtimeQuote('AAPL', 'yfinance|AAPL')).toBeNull()
  })
})
