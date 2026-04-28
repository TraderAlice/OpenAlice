/**
 * Rust-backed formula evaluator. Bridges OpenAlice's `IndicatorContext` shape
 * (the `getHistoricalData(symbol, interval) → { data, meta }` callback) into
 * the napi-rs `evaluateFormula` shape (the per-column `(symbol, interval, field)`
 * fetcher), then unpacks the tagged-union result back into the legacy
 * `{ value: number | number[] | Record<string, number>, dataRange }` form that
 * the existing TS callers expect.
 *
 * Activated by the `ALICE_RUST_INDICATORS` env flag — see `./rust-adapter.ts`.
 */

import { evaluateFormula } from '@traderalice/alice-analysis'
import type { IndicatorContext, OhlcvData, DataSourceMeta } from './types'

export interface CalculateOutput {
  value: number | number[] | Record<string, number>
  dataRange: Record<string, DataSourceMeta>
}

/**
 * In-call cache for `(symbol, interval) → { data, meta }`. The Rust side
 * pre-fetches each unique `(symbol, interval, field)` triple, so without a
 * cache here we'd hit `getHistoricalData` once per field even though they all
 * pull the same OHLCV bars. The TS implementation has the same de-dup behavior
 * via `IndicatorContext`'s caller-controlled caching.
 */
type FetchCache = Map<string, Promise<{ data: OhlcvData[]; meta: DataSourceMeta }>>

function getColumn(data: OhlcvData[], field: string): Float64Array {
  const out = new Float64Array(data.length)
  switch (field) {
    case 'close':
      for (let i = 0; i < data.length; i++) out[i] = data[i].close
      return out
    case 'open':
      for (let i = 0; i < data.length; i++) out[i] = data[i].open
      return out
    case 'high':
      for (let i = 0; i < data.length; i++) out[i] = data[i].high
      return out
    case 'low':
      for (let i = 0; i < data.length; i++) out[i] = data[i].low
      return out
    case 'volume':
      // VOLUME quirk #6: null → 0.
      for (let i = 0; i < data.length; i++) out[i] = data[i].volume ?? 0
      return out
    default:
      throw new Error(`Unknown OHLCV field: ${field}`)
  }
}

export async function evaluateWithRust(
  formula: string,
  context: IndicatorContext,
  precision: number,
): Promise<CalculateOutput> {
  const cache: FetchCache = new Map()

  const fetcher = async (
    symbol: string,
    interval: string,
    field: string,
  ): Promise<{
    values: Float64Array
    source: { symbol: string; from: string; to: string; bars: number }
  }> => {
    const key = `${symbol}|${interval}`
    let pending = cache.get(key)
    if (!pending) {
      pending = context.getHistoricalData(symbol, interval)
      cache.set(key, pending)
    }
    const { data, meta } = await pending
    return {
      values: getColumn(data, field),
      source: {
        symbol: meta.symbol,
        from: meta.from,
        to: meta.to,
        bars: meta.bars,
      },
    }
  }

  const raw = await evaluateFormula(formula, fetcher, precision)

  let value: number | number[] | Record<string, number>
  switch (raw.value.kind) {
    case 'number':
      value = raw.value.n
      break
    case 'array':
      value = raw.value.a
      break
    case 'object':
      value = raw.value.o
      break
  }

  const dataRange: Record<string, DataSourceMeta> = {}
  for (const [sym, meta] of Object.entries(raw.dataRange)) {
    dataRange[sym] = {
      symbol: meta.symbol,
      from: meta.from,
      to: meta.to,
      bars: meta.bars,
    }
  }

  return { value, dataRange }
}
