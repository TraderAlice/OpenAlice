/**
 * Real-network e2e — keyless CcxtBroker against live public exchanges (no API
 * key). Proves the whole keyless path: construct → init() WITHOUT credentials
 * (must not throw) → getHistorical → real OHLCV. Gated; does NOT mock ccxt.
 *
 *   Run:  CCXT_E2E=1 pnpm exec vitest run --config vitest.e2e.config.ts \
 *           services/uta/src/domain/trading/brokers/ccxt/CcxtBroker.e2e.spec.ts
 */
import { describe, it, expect } from 'vitest'
import { CcxtBroker } from './CcxtBroker.js'
import { Contract } from '@traderalice/ibkr'

describe.skipIf(!process.env.CCXT_E2E)('CcxtBroker — keyless e2e (real exchange, no key)', () => {
  const intervalMs = {
    '1m': 60_000,
    '15m': 15 * 60_000,
    '1h': 60 * 60_000,
    '4h': 4 * 60 * 60_000,
    '1d': 24 * 60 * 60_000,
  } as const
  const legacyWindowDays = { '1m': 30, '15m': 450, '1h': 90, '4h': 360, '1d': 730 } as const

  for (const exchange of ['binance', 'okx', 'bybit']) {
    it(`${exchange}: keyless history stays fresh across analysis intervals`, async () => {
      const acc = new CcxtBroker({ exchange, keyless: true, sandbox: false })
      await acc.init() // no credentials — keyless must skip the credential check

      expect(acc.getCapabilities().historicalBars).toEqual({ supported: true, quality: 'realtime' })

      const c = new Contract()
      c.symbol = 'BTC'
      c.localSymbol = 'BTC/USDT'
      for (const interval of Object.keys(intervalMs) as Array<keyof typeof intervalMs>) {
        const requestedAt = Date.now()
        // Match BarService's count-only request shape. Before issue #717 this
        // returned the exchange's first page at the old start date.
        const start = new Date(requestedAt - legacyWindowDays[interval] * 24 * 60 * 60_000)
        const bars = await acc.getHistorical(c, { interval, start, limit: 50 })

        expect(bars).toHaveLength(50)
        expect(typeof bars[0].close).toBe('string')
        expect(Number(bars[bars.length - 1].close)).toBeGreaterThan(0)
        const ts = bars.map((b) => b.timestamp.getTime())
        expect(ts).toEqual([...ts].sort((a, b) => a - b))
        // Crypto trades continuously. Allow two intervals plus five minutes
        // for an in-progress candle, clock skew, and a slow public endpoint.
        expect(requestedAt - ts.at(-1)!).toBeLessThanOrEqual(intervalMs[interval] * 2 + 5 * 60_000)
      }
    }, 60_000)
  }
})
