import { expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { renderMarketChart } from './market-chart.js'

const data = { bars: [{ date: '2026-09-11', open: 10, high: 12, low: 9, close: 11, volume: null }],
  meta: { barId: 'yfinance|AAPL', sourceId: 'yfinance', barCapability: 'delayed' } }
it('renders a bounded real PNG including a flat/one-bar chart without native dependencies', async () => {
  const result = await renderMarketChart('market/yfinance|AAPL/1d', data)
  const bytes = Buffer.from(result.contentBase64, 'base64')
  expect(bytes.subarray(1, 4).toString()).toBe('PNG')
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([2400, 1600])
  expect(result.sizeBytes).toBeLessThan(1024 * 1024)
  expect(result.contentSha256).toBe(createHash('sha256').update(bytes).digest('hex'))
  expect(result.mediaType).toBe('image/png')
})
it('refuses another source, empty data, malformed OHLC and unbounded data', async () => {
  await expect(renderMarketChart('market/other|AAPL/1d', data)).rejects.toThrow('source mismatch')
  await expect(renderMarketChart('market/yfinance|AAPL/1d', { ...data, bars: [] })).rejects.toThrow()
  await expect(renderMarketChart('market/yfinance|AAPL/1d', { ...data, bars: [{ ...data.bars[0], high: 1 }] })).rejects.toThrow('OHLC')
  await expect(renderMarketChart('market/yfinance|AAPL/1d', { ...data, bars: Array(301).fill(data.bars[0]) })).rejects.toThrow()
})
