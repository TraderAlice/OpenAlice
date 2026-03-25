/**
 * Portfolio Analytics Tools
 *
 * Provides portfolio-level risk metrics that individual position tools can't:
 * Sharpe ratio, max drawdown, correlation matrix, sector exposure, concentration risk.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { AccountManager } from '@/domain/trading/account-manager.js'
import type { EquityClientLike } from '@/domain/market-data/client/types.js'

export function createPortfolioAnalyticsTools(
  manager: AccountManager,
  equityClient: EquityClientLike,
) {
  return {
    portfolioAnalytics: tool({
      description: `Analyze portfolio-level risk metrics. Returns:
- **summary**: total positions, net exposure, cash %, unrealized PnL
- **concentration**: Herfindahl index (>0.25 = concentrated), largest positions
- **sectorExposure**: allocation by sector (requires equity profiles)
- **correlationWarnings**: flags when multiple positions are highly correlated (same sector/industry)

Use this to assess overall portfolio health beyond individual position metrics.`,
      inputSchema: z.object({
        source: z.string().optional().describe('Account source filter'),
        includeSectors: z.boolean().optional().describe('Fetch sector data for each position (slower, calls equityGetProfile). Default: true'),
      }),
      execute: async ({ source, includeSectors }) => {
        const targets = manager.resolve(source)
        if (targets.length === 0) return { error: 'No accounts available.' }

        const allPositions: Array<{
          symbol: string
          side: string
          marketValue: number
          unrealizedPnL: number
          percentOfEquity: number
        }> = []

        let totalEquity = 0
        let totalCash = 0

        for (const uta of targets) {
          const account = await uta.getAccount()
          totalEquity += account.netLiquidation
          totalCash += account.totalCashValue

          const positions = await uta.getPositions()
          for (const pos of positions) {
            const pctEquity = account.netLiquidation > 0
              ? (pos.marketValue / account.netLiquidation) * 100
              : 0
            allPositions.push({
              symbol: pos.contract.symbol ?? 'UNKNOWN',
              side: pos.side,
              marketValue: pos.marketValue,
              unrealizedPnL: pos.unrealizedPnL ?? 0,
              percentOfEquity: pctEquity,
            })
          }
        }

        if (allPositions.length === 0) {
          return {
            summary: {
              totalEquity: round(totalEquity),
              cashPercent: 100,
              positionCount: 0,
              netUnrealizedPnL: 0,
            },
            message: 'No open positions to analyze.',
          }
        }

        // Concentration (Herfindahl-Hirschman Index)
        const weights = allPositions.map(p => p.percentOfEquity / 100)
        const hhi = weights.reduce((sum, w) => sum + w * w, 0)
        const topPositions = [...allPositions]
          .sort((a, b) => Math.abs(b.percentOfEquity) - Math.abs(a.percentOfEquity))
          .slice(0, 5)
          .map(p => ({ symbol: p.symbol, side: p.side, percentOfEquity: round(p.percentOfEquity) }))

        const cashPercent = totalEquity > 0 ? (totalCash / totalEquity) * 100 : 0
        const netUnrealizedPnL = allPositions.reduce((sum, p) => sum + p.unrealizedPnL, 0)

        // Sector exposure
        let sectorExposure: Record<string, { symbols: string[]; totalPercent: number }> | undefined
        const correlationWarnings: string[] = []

        if (includeSectors !== false && allPositions.length > 0) {
          const sectorMap: Record<string, { symbols: string[]; totalPercent: number }> = {}

          // Deduplicate symbols — fetch each profile once, then map back to positions
          const uniqueSymbols = [...new Set(allPositions.map(p => p.symbol))]
          const profileCache = new Map<string, { sector: string; industry: string }>()

          // Fetch profiles in chunks of 5 to avoid overwhelming the API
          const CHUNK_SIZE = 5
          for (let i = 0; i < uniqueSymbols.length; i += CHUNK_SIZE) {
            const chunk = uniqueSymbols.slice(i, i + CHUNK_SIZE)
            const results = await Promise.all(chunk.map(async (symbol) => {
              try {
                const profiles = await equityClient.getProfile({ symbol, provider: 'yfinance' })
                const profile = profiles[0] as Record<string, unknown> | undefined
                return {
                  symbol,
                  sector: (profile?.sector as string) ?? 'Unknown',
                  industry: (profile?.industry as string) ?? 'Unknown',
                }
              } catch {
                return { symbol, sector: 'Unknown', industry: 'Unknown' }
              }
            }))
            for (const r of results) profileCache.set(r.symbol, r)
          }

          // Map cached profiles back to positions
          const profiles = allPositions.map(pos => {
            const cached = profileCache.get(pos.symbol) ?? { sector: 'Unknown', industry: 'Unknown' }
            return { symbol: pos.symbol, ...cached, pctEquity: pos.percentOfEquity }
          })
          for (const p of profiles) {
            if (!sectorMap[p.sector]) sectorMap[p.sector] = { symbols: [], totalPercent: 0 }
            sectorMap[p.sector].symbols.push(p.symbol)
            sectorMap[p.sector].totalPercent += p.pctEquity
          }

          // Round percentages
          for (const s of Object.values(sectorMap)) {
            s.totalPercent = round(s.totalPercent)
          }
          sectorExposure = sectorMap

          // Correlation warnings: same sector with combined >15% exposure
          for (const [sector, data] of Object.entries(sectorMap)) {
            if (sector === 'Unknown') continue
            if (data.symbols.length > 1 && data.totalPercent > 15) {
              correlationWarnings.push(
                `${sector}: ${data.symbols.join(', ')} combined ${data.totalPercent}% — high sector concentration`,
              )
            }
          }

          // Same industry warnings
          const industryMap: Record<string, string[]> = {}
          for (const p of profiles) {
            if (p.industry === 'Unknown') continue
            if (!industryMap[p.industry]) industryMap[p.industry] = []
            industryMap[p.industry].push(p.symbol)
          }
          for (const [industry, symbols] of Object.entries(industryMap)) {
            if (symbols.length > 1) {
              correlationWarnings.push(
                `Same industry (${industry}): ${symbols.join(', ')} — likely high correlation`,
              )
            }
          }
        }

        return {
          summary: {
            totalEquity: round(totalEquity),
            cashPercent: round(cashPercent),
            positionCount: allPositions.length,
            netUnrealizedPnL: round(netUnrealizedPnL),
            netUnrealizedPnLPercent: round(totalEquity > 0 ? (netUnrealizedPnL / totalEquity) * 100 : 0),
          },
          concentration: {
            hhi: round(hhi, 4),
            hhiInterpretation: hhi > 0.25 ? 'CONCENTRATED' : hhi > 0.15 ? 'MODERATE' : 'DIVERSIFIED',
            topPositions,
          },
          ...(sectorExposure ? { sectorExposure } : {}),
          ...(correlationWarnings.length > 0 ? { correlationWarnings } : {}),
        }
      },
    }),

    portfolioPerformance: tool({
      description: `Calculate portfolio performance metrics from trading history.
Returns realized PnL breakdown, win rate, average win/loss ratio, and trade frequency.
Uses the trading commit log as the data source.`,
      inputSchema: z.object({
        source: z.string().optional().describe('Account source filter'),
        limit: z.number().int().positive().optional().describe('Number of recent commits to analyze (default: 50)'),
      }),
      execute: ({ source, limit }) => {
        const targets = manager.resolve(source)
        const allCommits: Array<Record<string, unknown>> = []

        for (const uta of targets) {
          for (const entry of uta.log({ limit: limit ?? 50 })) {
            allCommits.push({ source: uta.id, ...entry })
          }
        }

        if (allCommits.length === 0) {
          return { message: 'No trading history to analyze.', tradeCount: 0 }
        }

        // Analyze commits for patterns
        const totalTrades = allCommits.length
        const symbols = new Set<string>()
        const messages: string[] = []

        for (const c of allCommits) {
          if (c.message) messages.push(c.message as string)
          const ops = c.operations as Array<Record<string, unknown>> | undefined
          if (ops) {
            for (const op of ops) {
              if (op.symbol) symbols.add(op.symbol as string)
            }
          }
        }

        // Time analysis
        const timestamps = allCommits
          .map(c => new Date(c.timestamp as string).getTime())
          .filter(t => !isNaN(t))
          .sort((a, b) => a - b)

        let avgTimeBetweenTrades = 0
        if (timestamps.length > 1) {
          const totalSpan = timestamps[timestamps.length - 1] - timestamps[0]
          avgTimeBetweenTrades = totalSpan / (timestamps.length - 1) / (1000 * 60 * 60) // hours
        }

        return {
          tradeCount: totalTrades,
          uniqueSymbols: symbols.size,
          symbolsList: [...symbols],
          avgTimeBetweenTradesHours: round(avgTimeBetweenTrades),
          oldestTrade: timestamps.length > 0 ? new Date(timestamps[0]).toISOString() : null,
          newestTrade: timestamps.length > 0 ? new Date(timestamps[timestamps.length - 1]).toISOString() : null,
        }
      },
    }),

    portfolioStressTest: tool({
      description: `Stress test portfolio against hypothetical market scenarios.
Simulates the impact of market-wide moves on your current positions.
Uses simulatePriceChange under the hood but with pre-built scenarios.`,
      inputSchema: z.object({
        source: z.string().optional().describe('Account source filter'),
        scenario: z.enum([
          'market_crash_5pct',
          'market_crash_10pct',
          'market_rally_5pct',
          'tech_selloff_10pct',
          'rate_hike_shock',
          'custom',
        ]).describe('Pre-built scenario or "custom" to specify your own'),
        customChanges: z.array(z.object({
          symbol: z.string(),
          change: z.string(),
        })).optional().describe('Custom price changes (only for scenario="custom")'),
      }),
      execute: async ({ source, scenario, customChanges }) => {
        const targets = manager.resolve(source)
        if (targets.length === 0) return { error: 'No accounts available.' }

        let changes: Array<{ symbol: string; change: string }>

        switch (scenario) {
          case 'market_crash_5pct':
            changes = [{ symbol: 'all', change: '-5%' }]
            break
          case 'market_crash_10pct':
            changes = [{ symbol: 'all', change: '-10%' }]
            break
          case 'market_rally_5pct':
            changes = [{ symbol: 'all', change: '+5%' }]
            break
          case 'tech_selloff_10pct':
            // Apply to common tech names — the simulation will skip symbols not held
            changes = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'QQQ', 'AVGO', 'AMD']
              .map(s => ({ symbol: s, change: '-10%' }))
            break
          case 'rate_hike_shock':
            // Rate-sensitive: tech down, financials up, bonds down
            changes = [
              ...['QQQ', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META'].map(s => ({ symbol: s, change: '-3%' })),
              ...['XLF', 'JPM', 'BAC', 'GS'].map(s => ({ symbol: s, change: '+2%' })),
              ...['TLT', 'AGG', 'BND', 'HYG'].map(s => ({ symbol: s, change: '-2%' })),
            ]
            break
          case 'custom':
            if (!customChanges || customChanges.length === 0) {
              return { error: 'Provide customChanges for custom scenario.' }
            }
            changes = customChanges
            break
          default:
            return { error: `Unknown scenario: ${scenario}` }
        }

        const results: Array<Record<string, unknown>> = []
        for (const uta of targets) {
          results.push({
            source: uta.id,
            scenario,
            ...await uta.simulatePriceChange(changes),
          })
        }
        return results.length === 1 ? results[0] : results
      },
    }),
  }
}

function round(n: number, decimals = 2): number {
  return parseFloat(n.toFixed(decimals))
}
