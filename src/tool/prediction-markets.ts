/**
 * Prediction Market Tools
 *
 * Surfaces crowd-consensus probabilities from Polymarket and Kalshi.
 * These are real-money markets — participants have skin in the game,
 * making prices a strong signal for expected event outcomes.
 *
 * No API keys required. Both APIs are public and unauthenticated.
 */

import { tool } from 'ai'
import { z } from 'zod'

// ==================== API Clients ====================

const POLYMARKET_BASE = 'https://gamma-api.polymarket.com'
const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2'

const FETCH_TIMEOUT = 10_000

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    headers: { 'Accept': 'application/json' },
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

// ==================== Polymarket ====================

interface PolymarketEvent {
  id: string
  title: string
  slug: string
  description: string
  active: boolean
  closed: boolean
  volume: string
  volume24hr: number
  liquidity: string
  startDate: string
  endDate: string
  markets: PolymarketMarket[]
  tags: Array<{ id: string; slug: string; label: string }>
}

interface PolymarketMarket {
  id: string
  question: string
  slug: string
  outcomePrices: string // stringified JSON: ["0.52","0.48"]
  outcomes: string      // stringified JSON: ["Yes","No"]
  volume: string
  volume24hr: number
  liquidity: string
  active: boolean
  closed: boolean
}

function parsePolymarketEvent(event: PolymarketEvent) {
  const markets = (event.markets ?? []).map(m => {
    let prices: number[] = []
    let outcomes: string[] = []
    try { prices = JSON.parse(m.outcomePrices).map(Number) } catch { /* */ }
    try { outcomes = JSON.parse(m.outcomes) } catch { /* */ }

    return {
      question: m.question,
      probability: prices[0] != null ? round(prices[0] * 100) : null,
      outcomes: outcomes.map((name, i) => ({
        name,
        probability: prices[i] != null ? round(prices[i] * 100) : null,
      })),
      volume24h: m.volume24hr ?? 0,
      totalVolume: parseFloat(m.volume) || 0,
      liquidity: parseFloat(m.liquidity) || 0,
    }
  })

  return {
    source: 'polymarket' as const,
    title: event.title,
    slug: event.slug,
    markets,
    totalVolume24h: markets.reduce((sum, m) => sum + m.volume24h, 0),
    tags: (event.tags ?? []).map(t => t.label),
  }
}

// ==================== Kalshi ====================

interface KalshiMarket {
  ticker: string
  event_ticker: string
  subtitle: string
  yes_sub_title: string
  no_sub_title: string
  status: string
  yes_bid: number
  yes_ask: number
  no_bid: number
  no_ask: number
  last_price: number
  volume: number
  volume_24h: number
  open_interest: number
  result: string
  close_time: string
  category: string
}

interface KalshiResponse {
  markets: KalshiMarket[]
  cursor: string
}

function parseKalshiMarket(m: KalshiMarket) {
  const midPrice = m.yes_bid && m.yes_ask
    ? (m.yes_bid + m.yes_ask) / 2
    : m.last_price
  return {
    source: 'kalshi' as const,
    ticker: m.ticker,
    event: m.event_ticker,
    question: m.yes_sub_title || m.subtitle || m.ticker,
    probability: midPrice ? round(midPrice * 100) : null,
    lastPrice: m.last_price ? round(m.last_price * 100) : null,
    volume24h: m.volume_24h ?? 0,
    totalVolume: m.volume ?? 0,
    openInterest: m.open_interest ?? 0,
    closesAt: m.close_time,
    status: m.status,
  }
}

// ==================== Helpers ====================

function round(n: number, d = 1): number {
  return parseFloat(n.toFixed(d))
}

// ==================== Tool Factory ====================

export function createPredictionMarketTools() {
  return {
    predictionMarkets: tool({
      description: `Query prediction markets for crowd-consensus probabilities on upcoming events.

Sources: Polymarket (crypto-native, broad coverage) and Kalshi (CFTC-regulated, strong on economics/politics).

Use this to gauge market expectations for:
- **Fed decisions** — rate cut/hold/hike probabilities
- **Elections** — candidate win probabilities
- **Geopolitical events** — conflict escalation, trade deals
- **Economic data** — CPI/NFP surprise expectations
- **Crypto events** — ETF approvals, protocol milestones

These are real-money markets — prices reflect actual risk assessment, not opinions.
A 72% "Yes" probability means participants are collectively betting $0.72 per $1.00 payout.

Examples:
  predictionMarkets({ query: "fed rate", source: "kalshi" })
  predictionMarkets({ query: "trump", source: "polymarket" })
  predictionMarkets({ mode: "trending" })`,
      inputSchema: z.object({
        query: z.string().optional().describe('Search term (e.g. "fed rate", "election", "recession")'),
        source: z.enum(['polymarket', 'kalshi', 'both']).default('both').describe('Which prediction market to query'),
        mode: z.enum(['search', 'trending']).default('search').describe('"search" to find specific markets, "trending" for highest-volume active markets'),
        limit: z.number().int().positive().optional().describe('Max results per source (default: 10)'),
      }),
      execute: async ({ query, source, mode, limit }) => {
        const n = limit ?? 10
        const results: Array<Record<string, unknown>> = []
        const errors: string[] = []

        const shouldSearch = mode === 'search' && query

        // Polymarket
        if (source === 'polymarket' || source === 'both') {
          try {
            const params = new URLSearchParams({
              active: 'true',
              closed: 'false',
              limit: String(n),
            })
            if (shouldSearch) {
              params.set('title', query)
            } else {
              params.set('order', 'volume24hr')
              params.set('ascending', 'false')
            }

            const events = await fetchJson<PolymarketEvent[]>(
              `${POLYMARKET_BASE}/events?${params}`,
            )
            for (const event of events) {
              results.push(parsePolymarketEvent(event))
            }
          } catch (err) {
            errors.push(`Polymarket: ${err instanceof Error ? err.message : String(err)}`)
          }
        }

        // Kalshi
        if (source === 'kalshi' || source === 'both') {
          try {
            const params = new URLSearchParams({
              status: 'open',
              limit: String(n),
            })
            if (shouldSearch) {
              // Kalshi doesn't have a text search param on /markets directly,
              // so we use the series_ticker filter for known categories
              // and fall back to fetching trending + client-side filtering
              params.set('limit', String(n * 3)) // overfetch for filtering
            }

            const data = await fetchJson<KalshiResponse>(
              `${KALSHI_BASE}/markets?${params}`,
            )

            let markets = (data.markets ?? []).map(parseKalshiMarket)

            // Client-side search filter
            if (shouldSearch) {
              const q = query.toLowerCase()
              markets = markets.filter(m =>
                m.ticker.toLowerCase().includes(q) ||
                m.question.toLowerCase().includes(q) ||
                m.event.toLowerCase().includes(q),
              )
            }

            // Sort by volume
            markets.sort((a, b) => b.volume24h - a.volume24h)

            for (const m of markets.slice(0, n)) {
              results.push(m)
            }
          } catch (err) {
            errors.push(`Kalshi: ${err instanceof Error ? err.message : String(err)}`)
          }
        }

        if (results.length === 0 && errors.length > 0) {
          return { error: 'Failed to fetch prediction market data', details: errors }
        }

        return {
          mode,
          ...(query ? { query } : {}),
          count: results.length,
          ...(errors.length > 0 ? { warnings: errors } : {}),
          markets: results,
        }
      },
    }),
  }
}
