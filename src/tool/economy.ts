/**
 * Economy & Macro Data Tools
 *
 * Provides access to FRED, CPI, interest rates, GDP, employment,
 * FOMC documents, and consumer sentiment via the economy client.
 * Requires FRED API key in market-data.json providerKeys.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { EconomyClientLike } from '@/domain/market-data/client/types.js'

export function createEconomyTools(economyClient: EconomyClientLike) {
  return {
    fredSearch: tool({
      description: `Search the FRED (Federal Reserve Economic Data) database for data series.

FRED contains 800,000+ economic time series: interest rates, inflation, employment,
GDP, housing, money supply, trade, and more. Use this to find the right series ID
before calling fredSeries to get actual data.

Examples:
  fredSearch({ query: "10 year treasury" })
  fredSearch({ query: "core CPI" })
  fredSearch({ query: "unemployment rate" })
  fredSearch({ query: "federal funds rate" })`,
      inputSchema: z.object({
        query: z.string().describe('Search term (e.g. "10 year treasury yield")'),
        limit: z.number().int().positive().optional().describe('Max results (default: 10)'),
      }),
      execute: async ({ query, limit }) => {
        const results = await economyClient.fredSearch({
          query,
          provider: 'federal_reserve',
          limit: limit ?? 10,
        })
        if (results.length === 0) return { query, results: [], message: 'No matching FRED series found.' }
        return results.map(r => ({
          id: r.id ?? r.series_id,
          title: r.title,
          frequency: r.frequency,
          units: r.units,
          lastUpdated: r.last_updated,
          notes: typeof r.notes === 'string' ? r.notes.slice(0, 200) : undefined,
        }))
      },
    }),

    fredSeries: tool({
      description: `Fetch data for a specific FRED series by ID.

Returns time series data points. Use fredSearch first to find the series ID.

Common series IDs:
  DGS10 — 10-Year Treasury yield
  DGS2 — 2-Year Treasury yield
  FEDFUNDS — Federal Funds rate
  CPIAUCSL — Consumer Price Index (all urban)
  UNRATE — Unemployment rate
  GDP — Gross Domestic Product
  T10Y2Y — 10Y-2Y Treasury spread (yield curve)
  VIXCLS — VIX close
  DTWEXBGS — Trade-weighted US Dollar index
  BAMLH0A0HYM2 — High-yield bond spread (ICE BofA)`,
      inputSchema: z.object({
        seriesId: z.string().describe('FRED series ID (e.g. "DGS10", "FEDFUNDS")'),
        startDate: z.string().optional().describe('Start date YYYY-MM-DD (default: 1 year ago)'),
        endDate: z.string().optional().describe('End date YYYY-MM-DD (default: today)'),
        limit: z.number().int().positive().optional().describe('Max data points (default: 100)'),
      }),
      execute: async ({ seriesId, startDate, endDate, limit }) => {
        const params: Record<string, unknown> = {
          symbol: seriesId,
          provider: 'federal_reserve',
        }
        if (startDate) params.start_date = startDate
        if (endDate) params.end_date = endDate
        if (limit) params.limit = limit

        const data = await economyClient.fredSeries(params)
        if (data.length === 0) return { seriesId, data: [], message: 'No data returned — check the series ID.' }
        return { seriesId, count: data.length, data }
      },
    }),

    economyCPI: tool({
      description: `Get Consumer Price Index (CPI) data — the primary inflation measure.

Returns CPI readings over time. Monitor this for Fed policy implications:
rising CPI → hawkish Fed → pressure on equities/bonds.`,
      inputSchema: z.object({
        country: z.string().optional().describe('Country code (default: "united_states")'),
      }),
      execute: async ({ country }) => {
        return economyClient.getCPI({
          country: country ?? 'united_states',
          provider: 'federal_reserve',
        })
      },
    }),

    economyInterestRates: tool({
      description: `Get interest rate data across maturities — treasury yields, Fed funds rate.

Useful for:
- Yield curve analysis (compare 2Y vs 10Y)
- Assessing monetary policy stance
- Estimating discount rates for equity valuation`,
      inputSchema: z.object({}),
      execute: async () => {
        return economyClient.getInterestRates({ provider: 'federal_reserve' })
      },
    }),

    economyUnemployment: tool({
      description: `Get unemployment rate data. Key labor market indicator.

Rising unemployment → dovish Fed, potential recession.
Falling unemployment → tight labor market, potential inflation pressure.`,
      inputSchema: z.object({
        country: z.string().optional().describe('Country code (default: "united_states")'),
      }),
      execute: async ({ country }) => {
        return economyClient.getUnemployment({
          country: country ?? 'united_states',
          provider: 'federal_reserve',
        })
      },
    }),

    economyGDP: tool({
      description: `Get real GDP data and forecasts.

Two modes:
- "actual" — historical real GDP growth
- "forecast" — IMF/OECD GDP forecasts

GDP is the broadest measure of economic health.`,
      inputSchema: z.object({
        mode: z.enum(['actual', 'forecast']).default('actual').describe('"actual" for historical, "forecast" for projections'),
        country: z.string().optional().describe('Country code (default: "united_states")'),
      }),
      execute: async ({ mode, country }) => {
        const params = { country: country ?? 'united_states', provider: 'federal_reserve' }
        return mode === 'forecast'
          ? economyClient.getGdpForecast(params)
          : economyClient.getGdpReal(params)
      },
    }),

    economyCalendar: tool({
      description: `Get upcoming economic events calendar — data releases, Fed meetings, etc.

Check this before making trading decisions to avoid being surprised by
scheduled macro events (NFP, CPI release, FOMC decision, etc.).`,
      inputSchema: z.object({}),
      execute: async () => {
        return economyClient.getCalendar({ provider: 'fmp' }).catch(() =>
          ({ message: 'Economic calendar requires FMP API key in market-data config.' }),
        )
      },
    }),

    economySentiment: tool({
      description: `Get consumer/market sentiment survey data.

Sources:
- "michigan" — University of Michigan consumer sentiment (monthly)
- "nonfarm" — Nonfarm payrolls (employment report)
- "inflation_expectations" — Market-based inflation expectations

These are leading indicators — sentiment shifts before economic data confirms.`,
      inputSchema: z.object({
        survey: z.enum(['michigan', 'nonfarm', 'inflation_expectations']).describe('Which survey to fetch'),
      }),
      execute: async ({ survey }) => {
        switch (survey) {
          case 'michigan':
            return economyClient.getUniversityOfMichigan({ provider: 'federal_reserve' })
          case 'nonfarm':
            return economyClient.getNonfarmPayrolls({ provider: 'federal_reserve' })
          case 'inflation_expectations':
            return economyClient.getInflationExpectations({ provider: 'federal_reserve' })
        }
      },
    }),

    economyFOMC: tool({
      description: `Get recent FOMC (Federal Open Market Committee) documents.

Returns meeting minutes, statements, and press conference transcripts.
Essential for understanding current Fed policy direction and forward guidance.`,
      inputSchema: z.object({}),
      execute: async () => {
        return economyClient.getFomcDocuments({ provider: 'federal_reserve' })
      },
    }),
  }
}
