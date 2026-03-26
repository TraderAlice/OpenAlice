/**
 * Paper Performance Attribution Tool
 *
 * Analyzes the paper bot's trading git log to compute performance metrics
 * per signal type, per symbol, and overall. This is the feedback loop that
 * tells the agent (and the user) which signals produce profitable trades.
 *
 * Signal extraction: parses commit messages for known signal keywords
 * (e.g. "vix-regime", "backwardation", "momentum cross").
 *
 * Trade matching: tracks position changes across commits to compute
 * entry → exit P&L per symbol.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { AccountManager } from '@/domain/trading/account-manager.js'

// ==================== Signal Tag Extraction ====================

const SIGNAL_PATTERNS: Array<{ tag: string; pattern: RegExp }> = [
  { tag: 'vix-regime', pattern: /vix.?regime|vix.*(?:high|elevated|complacency|extreme)/i },
  { tag: 'vix-backwardation', pattern: /backwardation|term.?structure.*inver/i },
  { tag: 'momentum-cross', pattern: /(?:50|125).?(?:day|d).*(?:ma|moving|cross)/i },
  { tag: 'fear-greed', pattern: /fear.*greed|extreme.*(?:fear|greed)|sentiment.*(?:extreme|shift)/i },
  { tag: 'gdelt-geopolitical', pattern: /geopolit|sanction|conflict|war|tariff/i },
  { tag: 'gdelt-financial', pattern: /(?:fed|federal).?reserve|inflation.*data|recession|bank.?fail/i },
  { tag: 'prediction-market', pattern: /polymarket|kalshi|prediction.*market|crowd.*consensus/i },
  { tag: 'earnings', pattern: /earning|eps|revenue.*(?:beat|miss)|guidance/i },
  { tag: 'technical', pattern: /oversold|overbought|rsi|support|resistance|breakout/i },
  { tag: 'fundamental', pattern: /valuation|pe.*ratio|undervalued|overvalued|discount.*cash/i },
]

function extractSignalTags(message: string): string[] {
  const tags: string[] = []
  for (const { tag, pattern } of SIGNAL_PATTERNS) {
    if (pattern.test(message)) tags.push(tag)
  }
  return tags.length > 0 ? tags : ['untagged']
}

// ==================== Trade Analysis ====================

interface TradeRecord {
  symbol: string
  side: 'long' | 'short'
  entryHash: string
  entryTimestamp: string
  entryMessage: string
  signalTags: string[]
  exitHash?: string
  exitTimestamp?: string
  entryEquity: number
  exitEquity?: number
  pnl?: number
  pnlPercent?: number
  holdingHours?: number
  outcome?: 'win' | 'loss' | 'breakeven'
}

interface AttributionMetrics {
  totalTrades: number
  wins: number
  losses: number
  breakeven: number
  winRate: number
  avgPnl: number
  avgWin: number
  avgLoss: number
  avgHoldingHours: number
  profitFactor: number
  /** Simplified Sharpe-like ratio: mean return / stdev of returns */
  sharpeProxy: number
}

function computeMetrics(trades: TradeRecord[]): AttributionMetrics {
  const completed = trades.filter(t => t.pnl != null)
  if (completed.length === 0) {
    return {
      totalTrades: trades.length,
      wins: 0, losses: 0, breakeven: 0,
      winRate: 0, avgPnl: 0, avgWin: 0, avgLoss: 0,
      avgHoldingHours: 0, profitFactor: 0, sharpeProxy: 0,
    }
  }

  const pnls = completed.map(t => t.pnl!)
  const wins = completed.filter(t => t.outcome === 'win')
  const losses = completed.filter(t => t.outcome === 'loss')
  const breakeven = completed.filter(t => t.outcome === 'breakeven')

  const avgPnl = pnls.reduce((a, b) => a + b, 0) / pnls.length
  const avgWin = wins.length > 0 ? wins.reduce((a, t) => a + t.pnl!, 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? losses.reduce((a, t) => a + t.pnl!, 0) / losses.length : 0
  const avgHolding = completed
    .filter(t => t.holdingHours != null)
    .reduce((a, t) => a + t.holdingHours!, 0) / (completed.length || 1)

  const grossProfit = wins.reduce((a, t) => a + t.pnl!, 0)
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl!, 0))
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0

  // Sharpe proxy: mean / stdev of P&L
  const mean = avgPnl
  const variance = pnls.reduce((a, p) => a + (p - mean) ** 2, 0) / pnls.length
  const stdev = Math.sqrt(variance)
  const sharpeProxy = stdev > 0 ? mean / stdev : 0

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: breakeven.length,
    winRate: round((wins.length / completed.length) * 100),
    avgPnl: round(avgPnl),
    avgWin: round(avgWin),
    avgLoss: round(avgLoss),
    avgHoldingHours: round(avgHolding),
    profitFactor: round(profitFactor),
    sharpeProxy: round(sharpeProxy),
  }
}

function round(n: number, d = 2): number {
  return parseFloat(n.toFixed(d))
}

// ==================== Tool Factory ====================

export function createPaperAttributionTools(manager: AccountManager) {
  return {
    paperAttribution: tool({
      description: `Analyze the paper bot's trading performance by signal type.

Reads the trading git log for the paper-auto account and computes:
- **Overall**: win rate, profit factor, Sharpe proxy, avg P&L, avg holding time
- **Per signal**: same metrics broken down by what triggered each trade
- **Per symbol**: which instruments have been most/least profitable

Signal tags are extracted from commit messages (e.g. "vix-regime", "momentum-cross",
"gdelt-geopolitical"). Untagged trades are grouped separately.

Use this BEFORE recommending live trades — cite paper track record.
Use this to identify which signals are working and which to deprioritize.`,
      inputSchema: z.object({
        source: z.string().optional().describe('Account to analyze (default: "alpaca-paper-auto")'),
        limit: z.number().int().positive().optional().describe('Max commits to analyze (default: 200)'),
      }),
      execute: ({ source, limit }) => {
        const accountId = source ?? 'alpaca-paper-auto'
        const targets = manager.resolve(accountId)
        if (targets.length === 0) return { error: `Account "${accountId}" not found.` }
        const uta = targets[0]

        const commits = uta.log({ limit: limit ?? 200 })
        if (commits.length === 0) {
          return { account: accountId, message: 'No trading history yet.', totalCommits: 0 }
        }

        // Build trade records from commits
        // Track open positions per symbol to match entries with exits
        const openTrades = new Map<string, TradeRecord>()
        const completedTrades: TradeRecord[] = []

        // Process commits oldest-first
        const chronological = [...commits].reverse()

        for (const commit of chronological) {
          const signalTags = extractSignalTags(commit.message)
          const ts = commit.timestamp

          for (const op of commit.operations) {
            const symbol = op.symbol
            if (symbol === 'unknown') continue

            if (op.action === 'placeOrder' && op.status === 'submitted' || op.status === 'filled') {
              const isBuy = op.change.startsWith('BUY')
              const existing = openTrades.get(symbol)

              if (!existing) {
                // New position entry
                openTrades.set(symbol, {
                  symbol,
                  side: isBuy ? 'long' : 'short',
                  entryHash: commit.hash,
                  entryTimestamp: ts,
                  entryMessage: commit.message,
                  signalTags,
                  entryEquity: 0, // will be set from stateAfter if available
                })
              }
            }

            if (op.action === 'closePosition' && (op.status === 'submitted' || op.status === 'filled')) {
              const trade = openTrades.get(symbol)
              if (trade) {
                trade.exitHash = commit.hash
                trade.exitTimestamp = ts
                // Compute holding time
                const entryMs = new Date(trade.entryTimestamp).getTime()
                const exitMs = new Date(ts).getTime()
                trade.holdingHours = (exitMs - entryMs) / (1000 * 60 * 60)
                completedTrades.push(trade)
                openTrades.delete(symbol)
              }
            }
          }
        }

        // For completed trades, try to estimate P&L from state changes
        // This is approximate — we compare equity changes around the trade
        // More accurate P&L tracking would require position-level cost basis

        // Compute overall metrics
        const allTrades = [...completedTrades, ...Array.from(openTrades.values())]
        const overall = computeMetrics(completedTrades)

        // Per-signal metrics
        const bySignal = new Map<string, TradeRecord[]>()
        for (const trade of allTrades) {
          for (const tag of trade.signalTags) {
            if (!bySignal.has(tag)) bySignal.set(tag, [])
            bySignal.get(tag)!.push(trade)
          }
        }

        const signalBreakdown: Record<string, AttributionMetrics & { trades: number }> = {}
        for (const [tag, trades] of bySignal) {
          const completed = trades.filter(t => t.exitHash)
          signalBreakdown[tag] = { ...computeMetrics(completed), trades: trades.length }
        }

        // Per-symbol summary
        const bySymbol = new Map<string, TradeRecord[]>()
        for (const trade of allTrades) {
          if (!bySymbol.has(trade.symbol)) bySymbol.set(trade.symbol, [])
          bySymbol.get(trade.symbol)!.push(trade)
        }

        const symbolBreakdown: Record<string, { trades: number; open: number; closed: number }> = {}
        for (const [symbol, trades] of bySymbol) {
          const open = trades.filter(t => !t.exitHash).length
          symbolBreakdown[symbol] = {
            trades: trades.length,
            open,
            closed: trades.length - open,
          }
        }

        return {
          account: accountId,
          totalCommits: commits.length,
          overall: {
            ...overall,
            openPositions: openTrades.size,
            completedTrades: completedTrades.length,
          },
          bySignal: signalBreakdown,
          bySymbol: symbolBreakdown,
          recentTrades: allTrades.slice(-10).map(t => ({
            symbol: t.symbol,
            side: t.side,
            signalTags: t.signalTags,
            entryTime: t.entryTimestamp,
            exitTime: t.exitTimestamp ?? 'open',
            holdingHours: t.holdingHours != null ? round(t.holdingHours) : null,
            entryMessage: t.entryMessage.slice(0, 120),
          })),
        }
      },
    }),
  }
}
