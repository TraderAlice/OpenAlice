/**
 * Optional live check against qt.gtimg.cn. Skipped unless
 * OPENALICE_TENCENT_LIVE=1 — keeps the hermetic suite free of network.
 */
import { describe, expect, it } from 'vitest'
import { TencentEquityQuoteFetcher } from '../models/equity-quote.js'
import type { TencentEquityQuoteData } from '../models/equity-quote.js'

const live = process.env.OPENALICE_TENCENT_LIVE === '1'

describe.runIf(live)('Tencent EquityQuote live', () => {
  it('fetches a batch snapshot for moutai + pingan', async () => {
    const rows = await TencentEquityQuoteFetcher.fetchData({
      symbol: 'sh600519,sz000001',
    }) as TencentEquityQuoteData[]
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(typeof rows[0].last_price).toBe('number')
    expect(rows[0].name).toBeTruthy()
    expect(rows[0].exchange === 'SSE' || rows[0].exchange === 'SZSE').toBe(true)
  }, 20_000)
})
