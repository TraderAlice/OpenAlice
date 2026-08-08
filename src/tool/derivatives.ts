/**
 * Derivatives AI Tools
 *
 * Crypto options surface (Deribit, keyless). The futures curve is already
 * served by the Term Structure board / reference contract; this exposes the
 * options chain to the agent for vol / skew / positioning reads.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { DerivativesClientLike } from '@/domain/market-data/client/types'

export function createDerivativesTools(derivativesClient: DerivativesClientLike) {
  return {
    equityOptionsHistory: tool({
      description: `Get a filtered historical end-of-day US equity-option chain from MarketData.app.

Use for option-strategy research and as-of validation, never for a current executable quote.
Date, expiration, side, and a bounded strike range are required to preserve point-in-time meaning
and avoid consuming credits on an entire chain. Returns bid/ask, mark, last, volume, open interest,
IV and Greeks when the provider has them.`,
      inputSchema: z.object({
        symbol: z.string().min(1).transform((value) => value.toUpperCase()),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
        expiration: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
        side: z.enum(['call', 'put']),
        minStrike: z.number().finite(),
        maxStrike: z.number().finite(),
      }).refine(({ minStrike, maxStrike }) => minStrike <= maxStrike, {
        message: 'minStrike must be less than or equal to maxStrike',
        path: ['minStrike'],
      }).meta({ examples: [{
        symbol: 'MSTR', date: '2026-07-20', expiration: '2026-09-18',
        side: 'put', minStrike: 75, maxStrike: 105,
      }] }),
      execute: async ({ symbol, date, expiration, side, minStrike, maxStrike }) => {
        return await derivativesClient.getOptionsChains({
          provider: 'marketdata', symbol, date, expiration, side,
          strike_min: minStrike, strike_max: maxStrike,
        })
      },
    }),

    cryptoOptionsChains: tool({
      description: `Get the crypto options chain from Deribit (keyless).

Returns all listed option contracts for the underlying: strike, expiration,
option type, bid/ask, mark, implied volatility, open interest and volume.
The chain is LARGE (hundreds of contracts) — filter by expiration/strike
range in your analysis, and prefer reading a few expiries at a time.

Use for: IV levels and skew (puts vs calls), open-interest walls near
strikes, positioning around events.`,
      inputSchema: z.object({
        symbol: z.enum(['BTC', 'ETH', 'PAXG']).describe('Underlying: BTC, ETH, or PAXG (gold token)'),
      }).meta({ examples: [{ symbol: 'BTC' }] }),
      execute: async ({ symbol }) => {
        return await derivativesClient.getOptionsChains({ symbol, provider: 'deribit' })
      },
    }),

    cryptoFuturesInstruments: tool({
      description: `List all Deribit futures instruments (keyless).

Returns every listed future/perpetual: instrument id, symbol
(e.g. BTC-PERPETUAL, BTC-26JUN26), base/counter currency, contract size,
expiration. Use to discover what's tradeable before reading the curve or
a specific contract.`,
      inputSchema: z.object({}).meta({ examples: [{}] }),
      execute: async () => {
        return await derivativesClient.getFuturesInstruments({ provider: 'deribit' })
      },
    }),
  }
}
