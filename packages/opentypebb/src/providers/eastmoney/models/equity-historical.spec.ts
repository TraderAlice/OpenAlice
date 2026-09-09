import { describe, expect, it } from 'vitest'
import { EastmoneyEquityHistoricalFetcher as F } from './equity-historical.js'
describe('Eastmoney bar contract', () => {
  it('retains exchange timezone for minutes and calendar labels for daily bars', () => {
    const q = F.transformQuery({ symbol: '1.600519', interval: '5m' })
    const rows = F.transformData(q, ['2026-09-08 09:35,10,12,13,9,100,0', '2026-09-08,10,12,13,9,100,0'])
    expect(rows[0]).toMatchObject({ date: '2026-09-08T01:35:00.000Z', open: 10, close: 12, high: 13, low: 9 })
    expect(rows[1].date).toBe('2026-09-08')
  })
  it('does not silently substitute daily candles for unsupported intervals', async () => {
    await expect(F.extractData(F.transformQuery({ symbol: '1.600519', interval: '4h' }), null)).rejects.toThrow('does not supply 4h')
  })
})
