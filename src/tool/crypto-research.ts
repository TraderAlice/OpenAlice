/**
 * Crypto Research Tools — public, key-less APIs for advisor-mode crypto context.
 *
 * Sources:
 *   - Binance Futures public (fapi.binance.com) — funding, OI, taker, long/short ratios
 *   - alternative.me — Fear & Greed index
 *   - mempool.space — BTC fees / mempool / difficulty
 *   - CoinGecko — global market cap, top coins
 *   - Frankfurter — ECB-based forex (USD index proxy)
 *
 * All endpoints are public, no API key. Conservative defaults; AI can override via params.
 */

import { tool } from 'ai'
import { z } from 'zod'

const BINANCE_FAPI = 'https://fapi.binance.com'
const ALTERNATIVE_FNG = 'https://api.alternative.me/fng'
const MEMPOOL_SPACE = 'https://mempool.space/api'
const COINGECKO = 'https://api.coingecko.com/api/v3'
const FRANKFURTER = 'https://api.frankfurter.app'

const PERIOD_VALUES = ['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d'] as const

async function fetchJson<T = unknown>(url: string, timeoutMs = 15000): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'OpenAlice/1.0' } })
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${url}`)
    }
    return (await resp.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export function createCryptoResearchTools() {
  return {
    cryptoFundingRate: tool({
      description: `Get historical funding rate for a Binance perpetual futures pair. Funding rate is paid every 8 hours and reflects market positioning bias — positive = longs paying shorts (bullish crowding), negative = shorts paying longs (bearish crowding). High abs values (>0.05% per 8h) signal extreme positioning.`,
      inputSchema: z.object({
        symbol: z.string().describe('Binance perp symbol e.g. BTCUSDT, ETHUSDT, SOLUSDT'),
        limit: z.number().int().positive().max(1000).optional().describe('Number of historical funding events (default 30, ~10 days at 8h cadence)'),
      }),
      execute: async ({ symbol, limit }) => {
        const url = `${BINANCE_FAPI}/fapi/v1/fundingRate?symbol=${encodeURIComponent(symbol.toUpperCase())}&limit=${limit ?? 30}`
        const data = await fetchJson<Array<{ symbol: string; fundingRate: string; fundingTime: number }>>(url)
        return {
          symbol: symbol.toUpperCase(),
          count: data.length,
          rates: data.map((r) => ({
            time: new Date(r.fundingTime).toISOString(),
            rate_pct: parseFloat(r.fundingRate) * 100,
          })),
        }
      },
    }),

    cryptoOpenInterestHistory: tool({
      description: `Get historical open interest (OI) for a Binance perpetual futures pair. OI = total outstanding contracts. Rising OI + rising price = trend confirmation; rising OI + falling price = shorts piling in. Divergence (price up, OI flat) = weak trend.`,
      inputSchema: z.object({
        symbol: z.string().describe('Binance perp symbol e.g. BTCUSDT'),
        period: z.enum(PERIOD_VALUES).optional().describe('Bar period (default 1h)'),
        limit: z.number().int().positive().max(500).optional().describe('Bars (default 24)'),
      }),
      execute: async ({ symbol, period, limit }) => {
        const url = `${BINANCE_FAPI}/futures/data/openInterestHist?symbol=${encodeURIComponent(symbol.toUpperCase())}&period=${period ?? '1h'}&limit=${limit ?? 24}`
        const data = await fetchJson<Array<{ symbol: string; sumOpenInterest: string; sumOpenInterestValue: string; timestamp: number }>>(url)
        return {
          symbol: symbol.toUpperCase(),
          period: period ?? '1h',
          bars: data.map((r) => ({
            time: new Date(r.timestamp).toISOString(),
            oi_contracts: parseFloat(r.sumOpenInterest),
            oi_usd: parseFloat(r.sumOpenInterestValue),
          })),
        }
      },
    }),

    cryptoTakerImbalance: tool({
      description: `Get taker buy/sell ratio for a Binance perpetual futures pair. Aggregates aggressive (market) orders. Ratio > 1 = more aggressive buyers; < 1 = more aggressive sellers. Sustained imbalance signals short-term momentum.`,
      inputSchema: z.object({
        symbol: z.string().describe('Binance perp symbol e.g. BTCUSDT'),
        period: z.enum(PERIOD_VALUES).optional().describe('Bar period (default 1h)'),
        limit: z.number().int().positive().max(500).optional().describe('Bars (default 24)'),
      }),
      execute: async ({ symbol, period, limit }) => {
        const url = `${BINANCE_FAPI}/futures/data/takerlongshortRatio?symbol=${encodeURIComponent(symbol.toUpperCase())}&period=${period ?? '1h'}&limit=${limit ?? 24}`
        const data = await fetchJson<Array<{ buySellRatio: string; buyVol: string; sellVol: string; timestamp: number }>>(url)
        return {
          symbol: symbol.toUpperCase(),
          period: period ?? '1h',
          bars: data.map((r) => ({
            time: new Date(r.timestamp).toISOString(),
            ratio: parseFloat(r.buySellRatio),
            buy_vol: parseFloat(r.buyVol),
            sell_vol: parseFloat(r.sellVol),
          })),
        }
      },
    }),

    cryptoLongShortRatio: tool({
      description: `Get long/short ratio for top traders or all accounts on Binance Futures. type='topAccount' = top trader L/S by account count; type='topPosition' = top trader L/S weighted by position size; type='global' = all accounts. Top traders are smart money; global is retail-heavy.`,
      inputSchema: z.object({
        symbol: z.string().describe('Binance perp symbol e.g. BTCUSDT'),
        type: z.enum(['topAccount', 'topPosition', 'global']).optional().describe('Default topPosition'),
        period: z.enum(PERIOD_VALUES).optional().describe('Bar period (default 1h)'),
        limit: z.number().int().positive().max(500).optional().describe('Bars (default 24)'),
      }),
      execute: async ({ symbol, type, period, limit }) => {
        const t = type ?? 'topPosition'
        const path = t === 'topAccount'
          ? 'topLongShortAccountRatio'
          : t === 'global'
            ? 'globalLongShortAccountRatio'
            : 'topLongShortPositionRatio'
        const url = `${BINANCE_FAPI}/futures/data/${path}?symbol=${encodeURIComponent(symbol.toUpperCase())}&period=${period ?? '1h'}&limit=${limit ?? 24}`
        const data = await fetchJson<Array<{ longShortRatio: string; longAccount: string; shortAccount: string; timestamp: number }>>(url)
        return {
          symbol: symbol.toUpperCase(),
          type: t,
          period: period ?? '1h',
          bars: data.map((r) => ({
            time: new Date(r.timestamp).toISOString(),
            ratio: parseFloat(r.longShortRatio),
            long_pct: parseFloat(r.longAccount) * 100,
            short_pct: parseFloat(r.shortAccount) * 100,
          })),
        }
      },
    }),

    cryptoFearGreed: tool({
      description: `Get crypto Fear & Greed Index (0-100) from alternative.me. <25 = extreme fear (potential bottom), >75 = extreme greed (potential top). Daily resolution.`,
      inputSchema: z.object({
        days: z.number().int().positive().max(365).optional().describe('History length in days (default 30, max 365)'),
      }),
      execute: async ({ days }) => {
        const url = `${ALTERNATIVE_FNG}/?limit=${days ?? 30}`
        const resp = await fetchJson<{ data: Array<{ value: string; value_classification: string; timestamp: string }> }>(url)
        return {
          count: resp.data.length,
          series: resp.data.map((d) => ({
            date: new Date(parseInt(d.timestamp, 10) * 1000).toISOString().slice(0, 10),
            value: parseInt(d.value, 10),
            label: d.value_classification,
          })),
        }
      },
    }),

    cryptoMempoolStatus: tool({
      description: `Get current Bitcoin mempool status: recommended fee rates (sat/vB) for next-block / 30-min / hour confirmation, mempool size, and unconfirmed tx count. Useful for assessing on-chain congestion. Source: mempool.space.`,
      inputSchema: z.object({}),
      execute: async () => {
        const [fees, summary] = await Promise.all([
          fetchJson<{ fastestFee: number; halfHourFee: number; hourFee: number; minimumFee: number }>(`${MEMPOOL_SPACE}/v1/fees/recommended`),
          fetchJson<{ count: number; vsize: number; total_fee: number }>(`${MEMPOOL_SPACE}/mempool`),
        ])
        return {
          fees_sat_vb: {
            next_block: fees.fastestFee,
            thirty_min: fees.halfHourFee,
            one_hour: fees.hourFee,
            minimum: fees.minimumFee,
          },
          mempool: {
            unconfirmed_tx: summary.count,
            vsize_bytes: summary.vsize,
            total_fees_btc: summary.total_fee / 1e8,
          },
        }
      },
    }),

    cryptoGlobalMarket: tool({
      description: `Get global crypto market snapshot from CoinGecko: total market cap (USD), total 24h volume, BTC dominance %, ETH dominance %, top10 dominance %, active cryptocurrencies, markets count, market cap change 24h.`,
      inputSchema: z.object({}),
      execute: async () => {
        const resp = await fetchJson<{ data: { total_market_cap: { usd: number }; total_volume: { usd: number }; market_cap_percentage: Record<string, number>; active_cryptocurrencies: number; markets: number; market_cap_change_percentage_24h_usd: number } }>(`${COINGECKO}/global`)
        const d = resp.data
        return {
          total_mcap_usd: d.total_market_cap.usd,
          total_vol_24h_usd: d.total_volume.usd,
          btc_dominance_pct: d.market_cap_percentage.btc,
          eth_dominance_pct: d.market_cap_percentage.eth,
          active_coins: d.active_cryptocurrencies,
          markets_count: d.markets,
          mcap_change_24h_pct: d.market_cap_change_percentage_24h_usd,
        }
      },
    }),

    cryptoTopCoins: tool({
      description: `Get top N coins by market cap from CoinGecko with price, 24h change, 7d change, market cap, volume. Useful for narrative/dominance analysis ("which coins are leading the rally?").`,
      inputSchema: z.object({
        limit: z.number().int().positive().max(100).optional().describe('Top N (default 20, max 100)'),
      }),
      execute: async ({ limit }) => {
        const n = limit ?? 20
        const url = `${COINGECKO}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${n}&page=1&price_change_percentage=24h,7d`
        const data = await fetchJson<Array<{ symbol: string; name: string; current_price: number; market_cap: number; total_volume: number; price_change_percentage_24h: number; price_change_percentage_7d_in_currency: number }>>(url)
        return {
          coins: data.map((c) => ({
            symbol: c.symbol.toUpperCase(),
            name: c.name,
            price_usd: c.current_price,
            mcap_usd: c.market_cap,
            vol_24h_usd: c.total_volume,
            chg_24h_pct: c.price_change_percentage_24h,
            chg_7d_pct: c.price_change_percentage_7d_in_currency,
          })),
        }
      },
    }),

    forexRates: tool({
      description: `Get current ECB-published forex rates (Frankfurter API). Use base=USD, to=DXY-basket (EUR,JPY,GBP,CAD,SEK,CHF) for a poor-man's DXY proxy. No API key.`,
      inputSchema: z.object({
        base: z.string().optional().describe('Base currency (default USD)'),
        to: z.string().optional().describe('Comma-separated target currencies, e.g. "EUR,JPY,GBP,CAD,SEK,CHF" (default = full set)'),
      }),
      execute: async ({ base, to }) => {
        const params = new URLSearchParams()
        params.set('from', (base ?? 'USD').toUpperCase())
        if (to) params.set('to', to.toUpperCase())
        const resp = await fetchJson<{ amount: number; base: string; date: string; rates: Record<string, number> }>(`${FRANKFURTER}/latest?${params.toString()}`)
        return {
          base: resp.base,
          date: resp.date,
          rates: resp.rates,
        }
      },
    }),
  }
}
