/**
 * ETF AI Tools
 *
 * etfSearch / etfGetInfo / etfGetHoldings / etfGetSectors:
 *   thin bridge to the openTypeBB etf-router endpoints. Lets the agent
 *   self-serve thematic ETFs — find a theme's ETF, then read whether the
 *   theme actually attracted capital (the reflexivity read; see etfGetInfo).
 *
 * Provider note: ETF search/holdings/sectors are FMP-only; ETF info is served
 * by yfinance (keyless) which also carries the reflexivity fields
 * (total_assets / category / inception_date / volume_avg).
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { EtfClientLike } from '@/domain/market-data/client/types'

export function createEtfTools(etfClient: EtfClientLike) {
  return {
    etfSearch: tool({
      description: `Find ETFs by keyword or theme.

Use this to locate the ETF(s) for a specific theme (e.g. "robotics", "uranium",
"cybersecurity", "semiconductors") — the broad GICS sector ETFs are handled
elsewhere; this is for going one level deeper into a specific theme.

Reflexivity read: the *existence* of a thematic ETF means an issuer judged the
theme had enough capital behind it to support a fund — a market-validated
signal. But that signal is coarse and LATE (thematic ETFs cluster near theme
peaks). After finding candidates, call etfGetInfo to gauge how much capital
actually showed up (AUM × volume) before trusting the theme.`,
      inputSchema: z.object({
        query: z.string().describe('Theme or keyword, e.g. "robotics", "uranium", "semiconductor"'),
        limit: z.number().int().positive().optional().describe('Max results (default: provider default)'),
      }).meta({ examples: [{ query: 'robotics' }] }),
      execute: async ({ query, limit }) => {
        // yfinance: keyless, and name/theme-matches (FMP's etf_search hits
        // company-screener which filters by financials, not name).
        const params: Record<string, unknown> = { query, provider: 'yfinance' }
        if (limit) params.limit = limit
        return await etfClient.search(params)
      },
    }),

    etfGetInfo: tool({
      description: `Get an ETF's profile — issuer, category, inception date, AUM
(total_assets), NAV, and average volume.

This is the reflexivity gauge for a theme. Existence is binary; capital is
graded — read it as a thermometer, not a switch:
- AUM × dollar volume = how much money the theme actually attracted. High on
  both = real; low AUM + thin volume = a zombie ETF = a bet that did NOT pay
  off = an anti-signal for the theme.
- A young inception_date (< ~1 year) on a fund already trading heavy = the
  theme is in its reflexive acceleration phase — the most interesting case.
- Caveat: thematic ETFs launch near theme tops and on average underperform
  after launch. Treat all of this as right-side confirmation / an attention
  radar, NOT as early alpha.

If unsure of the ticker, use etfSearch first.`,
      inputSchema: z.object({
        symbol: z.string().describe('ETF ticker, e.g. "XLK", "SMH", "BOTZ"'),
      }).meta({ examples: [{ symbol: 'SMH' }] }),
      execute: async ({ symbol }) => {
        // yfinance: keyless, and carries total_assets / category / inception_date / volume_avg.
        const info = await etfClient.getInfo({ symbol, provider: 'yfinance' }).catch(() => [])
        return info[0] ?? null
      },
    }),

    etfGetHoldings: tool({
      description: `Get an ETF's holdings — the underlying positions and their weights.

Use this to see what's actually inside an ETF, and to catch single-name
concentration that a sector/theme label hides (e.g. a "tech" ETF that is really
a bet on two mega-caps). Complements etfGetSectors.

If unsure of the ticker, use etfSearch first.`,
      inputSchema: z.object({
        symbol: z.string().describe('ETF ticker, e.g. "XLK", "SMH"'),
      }).meta({ examples: [{ symbol: 'XLK' }] }),
      execute: async ({ symbol }) => {
        return await etfClient.getHoldings({ symbol, provider: 'fmp' })
      },
    }),

    etfGetSectors: tool({
      description: `Get an ETF's sector breakdown — its exposure weight per GICS sector.

Use this to understand what an ETF actually bets on across sectors (a thematic
ETF often spans several), or to confirm a broad sector ETF is as pure as its
name implies.

If unsure of the ticker, use etfSearch first.`,
      inputSchema: z.object({
        symbol: z.string().describe('ETF ticker, e.g. "XLK", "SMH"'),
      }).meta({ examples: [{ symbol: 'XLK' }] }),
      execute: async ({ symbol }) => {
        return await etfClient.getSectors({ symbol, provider: 'fmp' })
      },
    }),
  }
}
