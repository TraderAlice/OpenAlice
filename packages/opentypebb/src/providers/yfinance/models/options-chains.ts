/**
 * Yahoo Finance Options Chains Model.
 * Maps to: openbb_yfinance/models/options_chains.py
 *
 * Fetches full options chain for a given symbol using yahoo-finance2's options API,
 * with fallback to direct Yahoo Finance HTTP endpoint.
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { OptionsChainsQueryParamsSchema, OptionsChainsDataSchema } from '../../../standard-models/options-chains.js'
import { EmptyDataError, NetworkUnreachableError, RateLimitedError } from '../../../core/provider/utils/errors.js'
import { classifyYahooFetchError, getOptionsData } from '../utils/helpers.js'

export const YFinanceOptionsChainsQueryParamsSchema = OptionsChainsQueryParamsSchema
export type YFinanceOptionsChainsQueryParams = z.infer<typeof YFinanceOptionsChainsQueryParamsSchema>

export const YFinanceOptionsChainsDataSchema = OptionsChainsDataSchema
export type YFinanceOptionsChainsData = z.infer<typeof YFinanceOptionsChainsDataSchema>

/** Fetch options chain using yahoo-finance2's options() API via shared singleton */
async function fetchViaYF2(symbol: string): Promise<Record<string, unknown>[]> {
  // Step 1: Get first expiration + list of all expirations
  const optionsResult = await getOptionsData(symbol)

  const expirationDates: Date[] = optionsResult?.expirationDates ?? []
  if (!expirationDates.length) {
    throw new EmptyDataError(`No options data found for ${symbol}`)
  }

  const underlyingPrice = optionsResult?.quote?.regularMarketPrice ?? null
  const today = new Date().toISOString().slice(0, 10)
  const allContracts: Record<string, unknown>[] = []

  const processOptions = (options: any[], type: string, expirationStr: string) => {
    for (const opt of options) {
      const strike = opt.strike ?? 0
      const now = new Date()
      const exp = new Date(expirationStr)
      const dte = Math.max(0, Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))

      allContracts.push({
        underlying_symbol: symbol,
        underlying_price: underlyingPrice,
        contract_symbol: opt.contractSymbol ?? '',
        eod_date: today,
        expiration: expirationStr,
        dte,
        strike,
        option_type: type,
        open_interest: opt.openInterest ?? null,
        volume: opt.volume ?? null,
        last_trade_price: opt.lastPrice ?? null,
        last_trade_time: opt.lastTradeDate
          ? (opt.lastTradeDate instanceof Date ? opt.lastTradeDate.toISOString() : String(opt.lastTradeDate))
          : null,
        bid: opt.bid ?? null,
        ask: opt.ask ?? null,
        mark: opt.bid != null && opt.ask != null ? (opt.bid + opt.ask) / 2 : null,
        change: opt.change ?? null,
        change_percent: opt.percentChange != null ? opt.percentChange / 100 : null,
        implied_volatility: opt.impliedVolatility ?? null,
        in_the_money: opt.inTheMoney ?? null,
        currency: opt.currency ?? null,
      })
    }
  }

  // Process first expiration (already have data)
  if (optionsResult.options?.[0]) {
    const firstExpStr = expirationDates[0] instanceof Date
      ? expirationDates[0].toISOString().slice(0, 10)
      : String(expirationDates[0]).slice(0, 10)
    const firstOpts = optionsResult.options[0]
    processOptions(firstOpts.calls ?? [], 'call', firstExpStr)
    processOptions(firstOpts.puts ?? [], 'put', firstExpStr)
  }

  // Fetch remaining expirations in batches
  const remainingDates = expirationDates.slice(1)
  const batchSize = 5
  for (let i = 0; i < remainingDates.length; i += batchSize) {
    const batch = remainingDates.slice(i, i + batchSize)
    await Promise.allSettled(
      batch.map(async (expDate) => {
        const dateObj = expDate instanceof Date ? expDate : new Date(expDate)
        const dateStr = dateObj.toISOString().slice(0, 10)
        try {
          const result = await getOptionsData(symbol, dateObj)
          if (result?.options?.[0]) {
            processOptions(result.options[0].calls ?? [], 'call', dateStr)
            processOptions(result.options[0].puts ?? [], 'put', dateStr)
          }
        } catch {
          // Skip failed expirations
        }
      })
    )
  }

  return allContracts
}

/** Fetch options via direct Yahoo Finance v7 HTTP API (fallback) */
async function fetchViaDirect(symbol: string): Promise<Record<string, unknown>[]> {
  const baseUrl = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}`

  // Get first expiration + list of all expirations
  let resp: Response
  try {
    resp = await fetch(baseUrl, { signal: AbortSignal.timeout(15000) })
  } catch (err) {
    throw classifyYahooFetchError(symbol, err)
  }
  if (!resp.ok) {
    if (resp.status === 429 || resp.status === 401 || resp.status === 403) {
      throw classifyYahooFetchError(
        symbol,
        Object.assign(new Error(`Yahoo options API returned ${resp.status}`), { code: resp.status }),
      )
    }
    throw new EmptyDataError(`Yahoo options API returned ${resp.status}`)
  }
  const json = await resp.json() as any
  const result = json?.optionChain?.result?.[0]
  if (!result) throw new EmptyDataError(`No options data for ${symbol}`)

  const expirationEpochs: number[] = result.expirationDates ?? []
  if (!expirationEpochs.length) throw new EmptyDataError(`No option expirations for ${symbol}`)

  const underlyingPrice = result.quote?.regularMarketPrice ?? null
  const today = new Date().toISOString().slice(0, 10)
  const allContracts: Record<string, unknown>[] = []

  const processChain = (options: any[], type: string, expirationStr: string) => {
    for (const opt of options) {
      const strike = opt.strike ?? 0
      const now = new Date()
      const exp = new Date(expirationStr)
      const dte = Math.max(0, Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))

      allContracts.push({
        underlying_symbol: symbol,
        underlying_price: underlyingPrice,
        contract_symbol: opt.contractSymbol ?? '',
        eod_date: today,
        expiration: expirationStr,
        dte,
        strike,
        option_type: type,
        open_interest: opt.openInterest ?? null,
        volume: opt.volume ?? null,
        last_trade_price: opt.lastPrice ?? null,
        last_trade_time: opt.lastTradeDate
          ? new Date(opt.lastTradeDate * 1000).toISOString()
          : null,
        bid: opt.bid ?? null,
        ask: opt.ask ?? null,
        mark: opt.bid != null && opt.ask != null ? (opt.bid + opt.ask) / 2 : null,
        change: opt.change ?? null,
        change_percent: opt.percentChange != null ? opt.percentChange / 100 : null,
        implied_volatility: opt.impliedVolatility ?? null,
        in_the_money: opt.inTheMoney ?? null,
        currency: opt.currency ?? null,
      })
    }
  }

  // Process first expiration (already have data)
  if (result.options?.[0]) {
    const firstExpStr = new Date(expirationEpochs[0] * 1000).toISOString().slice(0, 10)
    processChain(result.options[0].calls ?? [], 'call', firstExpStr)
    processChain(result.options[0].puts ?? [], 'put', firstExpStr)
  }

  // Fetch remaining expirations
  const remaining = expirationEpochs.slice(1)
  const batchSize = 5
  for (let i = 0; i < remaining.length; i += batchSize) {
    const batch = remaining.slice(i, i + batchSize)
    await Promise.allSettled(
      batch.map(async (epoch) => {
        const dateStr = new Date(epoch * 1000).toISOString().slice(0, 10)
        try {
          const r = await fetch(`${baseUrl}?date=${epoch}`, { signal: AbortSignal.timeout(15000) })
          if (!r.ok) return
          const j = await r.json() as any
          const chain = j?.optionChain?.result?.[0]?.options?.[0]
          if (chain) {
            processChain(chain.calls ?? [], 'call', dateStr)
            processChain(chain.puts ?? [], 'put', dateStr)
          }
        } catch {
          // Skip failed expirations
        }
      })
    )
  }

  return allContracts
}

export class YFinanceOptionsChainsFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): YFinanceOptionsChainsQueryParams {
    return YFinanceOptionsChainsQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: YFinanceOptionsChainsQueryParams,
    _credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    let symbol = query.symbol.toUpperCase()
    // Prefix index symbols with ^ (matching Python behavior)
    if (['VIX', 'RUT', 'SPX', 'NDX'].includes(symbol)) {
      symbol = '^' + symbol
    }

    // Try yahoo-finance2 first, fall back to direct API
    let contracts: Record<string, unknown>[]
    try {
      contracts = await fetchViaYF2(symbol)
    } catch (yfErr) {
      try {
        contracts = await fetchViaDirect(symbol)
      } catch (err) {
        const classified = classifyYahooFetchError(symbol, err)
        if (classified instanceof NetworkUnreachableError || classified instanceof RateLimitedError) {
          throw classified
        }
        if (yfErr instanceof NetworkUnreachableError || yfErr instanceof RateLimitedError) {
          throw yfErr
        }
        throw new EmptyDataError(`Failed to fetch options for ${query.symbol}: ${classified.message}`)
      }
    }

    if (!contracts.length) {
      throw new EmptyDataError(`No options contracts found for ${query.symbol}`)
    }

    return contracts
  }

  static override transformData(
    _query: YFinanceOptionsChainsQueryParams,
    data: Record<string, unknown>[],
  ): YFinanceOptionsChainsData[] {
    return data.map(d => OptionsChainsDataSchema.parse(d))
  }
}
