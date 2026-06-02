/**
 * Kronos K-line prediction tool.
 *
 * Bridges OpenAlice tool layer to the Python FastAPI sidecar wrapping the
 * NeoQuasar Kronos transformer (services/kronos/server.py).
 */
import { tool } from 'ai'
import { z } from 'zod'

export interface KronosPredictDeps {
  endpoint: string
}

const INTERVALS = ['15m', '1h', '4h', '1d'] as const

export function createKronosPredictTools(deps: KronosPredictDeps) {
  return {
    kronosPredict: tool({
      description:
        'Predict future crypto OHLC candles using the Kronos transformer ' +
        '(NeoQuasar foundation model for K-line forecasting). ' +
        'Use this for queries like "預測 BTC", "forecast ETH next 24h", ' +
        '"Kronos 推一下 SOL", "用模型預測 K 線", "推演下一根 K". ' +
        'Returns predicted OHLCV for the next `pred_len` candles plus a summary delta_pct. ' +
        'Stochastic — raise sample_count to 3 for a smoother mean prediction.',
      inputSchema: z.object({
        symbol: z.string().describe('Binance spot pair symbol, e.g. BTCUSDT, ETHUSDT, SOLUSDT'),
        interval: z.enum(INTERVALS).optional().describe('Candle interval. Default 1h'),
        lookback: z
          .number()
          .int()
          .min(64)
          .max(500)
          .optional()
          .describe('Historical candles fed to the model. Default 400'),
        pred_len: z
          .number()
          .int()
          .min(1)
          .max(120)
          .optional()
          .describe('How many future candles to predict. Default 24'),
        sample_count: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe('Sampling runs averaged. Default 1. Use 3 for smoother mean'),
      }),
      execute: async ({ symbol, interval, lookback, pred_len, sample_count }) => {
        const res = await fetch(`${deps.endpoint}/predict`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            symbol,
            interval: interval ?? '1h',
            lookback: lookback ?? 400,
            pred_len: pred_len ?? 24,
            sample_count: sample_count ?? 1,
          }),
        })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(`kronos sidecar ${res.status}: ${text}`)
        }
        return await res.json()
      },
    }),
  }
}
