/**
 * Hourly analyzer — runs each trading hour for today's pick.
 *
 * Order of operations:
 *   1. Fetch live price.
 *   2. Compute P&L since entry (if entered).
 *   3. Check hard rules: -5% stop-loss, +10% take-profit.
 *      If triggered → force EXIT, skip council.
 *   4. Otherwise → StrategyCouncil deliberates.
 *   5. Append HourlyEntry, update entry/exit fields, persist.
 */

import Decimal from 'decimal.js'
import type { StrategyCouncil } from '../../core/strategy-council/index.js'
import type { TwstockMcpClient } from '../twstock/client.js'
import type { DailyPick, HourlyEntry, PickAction, HardRule } from './types.js'
import { readDailyPick, writeDailyPick } from './store.js'
import { todayInTaipei, hourLabelInTaipei, nowIso } from './time.js'

const STOP_LOSS_PCT = new Decimal('-5')
const TAKE_PROFIT_PCT = new Decimal('10')

export interface AnalyzerDeps {
  strategyCouncil: StrategyCouncil
  /** Either fugle or twstock client — both expose `get_stock_intraday_quote` / `get_stock_realtime_quote`. */
  quoteClient: TwstockMcpClient | null
}

export class HourlyAnalyzer {
  constructor(private deps: AnalyzerDeps) {}

  /** Run one hourly analysis for today's pick. No-op if no pick or status closed. */
  async runOnce(): Promise<HourlyEntry | null> {
    const date = todayInTaipei()
    const pick = await readDailyPick(date)
    if (!pick) return null
    if (pick.status === 'closed') return null

    const price = await this.fetchPrice(pick.symbol)
    if (price === null) {
      console.warn(`[hourly-analyzer] could not fetch price for ${pick.symbol}, skipping`)
      return null
    }

    const entry: HourlyEntry = await this.deliberate(pick, price)
    pick.hourly.push(entry)

    // Update entry/exit fields based on action.
    if (entry.action === 'BUY' && pick.entryPrice === null) {
      pick.entryPrice = price.toString()
      pick.entryAt = entry.timestamp
    }
    if (entry.action === 'EXIT' && pick.exitPrice === null) {
      pick.exitPrice = price.toString()
      pick.exitAt = entry.timestamp
      pick.status = 'closed'
    }

    await writeDailyPick(pick)
    return entry
  }

  private async deliberate(pick: DailyPick, price: Decimal): Promise<HourlyEntry> {
    const pnlPct = pick.entryPrice
      ? price.minus(pick.entryPrice).dividedBy(pick.entryPrice).times(100)
      : null

    const hardRule = this.checkHardRule(pnlPct)

    if (hardRule) {
      return {
        timestamp: nowIso(),
        hour: hourLabelInTaipei(),
        price: price.toString(),
        pnlPct: pnlPct ? pnlPct.toFixed(2) : null,
        action: 'EXIT',
        confidence: 100,
        reason:
          hardRule === 'stop-loss'
            ? `Stop-loss triggered at ${pnlPct!.toFixed(2)}% (threshold ${STOP_LOSS_PCT.toString()}%).`
            : `Take-profit triggered at ${pnlPct!.toFixed(2)}% (threshold +${TAKE_PROFIT_PCT.toString()}%).`,
        verdicts: { trend: '(skipped)', signal: '(skipped)', risk: '(skipped — hard rule)' },
        hardRuleTriggered: hardRule,
      }
    }

    const input = this.buildCouncilInput(pick, price, pnlPct)
    const decision = await this.deps.strategyCouncil.deliberate(input)

    const action = mapCouncilActionToPickAction(decision.finalAction, pick)
    const confidence = Math.round(decision.positionFactor * 100)

    return {
      timestamp: nowIso(),
      hour: hourLabelInTaipei(),
      price: price.toString(),
      pnlPct: pnlPct ? pnlPct.toFixed(2) : null,
      action,
      confidence,
      reason: decision.rationale.slice(0, 400),
      verdicts: extractVerdicts(decision),
      hardRuleTriggered: null,
    }
  }

  private checkHardRule(pnlPct: Decimal | null): HardRule {
    if (!pnlPct) return null
    if (pnlPct.lte(STOP_LOSS_PCT)) return 'stop-loss'
    if (pnlPct.gte(TAKE_PROFIT_PCT)) return 'take-profit'
    return null
  }

  private buildCouncilInput(pick: DailyPick, price: Decimal, pnlPct: Decimal | null): string {
    const positionStatus = pick.entryPrice
      ? `Currently holding from entry ${pick.entryPrice} @ ${pick.entryAt}; unrealized PnL: ${pnlPct!.toFixed(2)}%.`
      : 'No open position yet — should we enter?'

    const recentHours = pick.hourly
      .slice(-3)
      .map((h) => `  - ${h.hour}: ${h.action} @ ${h.price} (conf ${h.confidence}, ${h.reason.slice(0, 80)}…)`)
      .join('\n')

    return [
      `TWSE intraday deliberation for ${pick.symbol}${pick.symbolName ? ` (${pick.symbolName})` : ''}.`,
      `Pick reason at open: ${pick.pickReason}`,
      '',
      `Now (${hourLabelInTaipei()}): price = ${price.toString()}`,
      positionStatus,
      '',
      recentHours ? `Recent hourly decisions:\n${recentHours}` : '(first hour)',
      '',
      'Each role (trend / signal / risk) should output 1-2 sentences in Traditional Chinese.',
      'The coordinator combines into long / short / hold / blocked.',
    ].join('\n')
  }

  private async fetchPrice(symbol: string): Promise<Decimal | null> {
    const client = this.deps.quoteClient
    if (!client) return null

    // Tool naming differs between fugle and twstock; try both with their
    // respective parameter conventions.
    const attempts: Array<{ tool: string; args: Record<string, unknown> }> = [
      { tool: 'get_intraday_quote', args: { symbol } },         // fugle
      { tool: 'get_stock_realtime_quote', args: { code: symbol } }, // twstock
    ]
    for (const { tool, args } of attempts) {
      try {
        const raw = await client.callTool(tool, args)
        const price = extractPrice(raw)
        if (price !== null) return new Decimal(price)
      } catch {
        // try next
      }
    }
    return null
  }
}

// ==================== Helpers ====================

function mapCouncilActionToPickAction(council: 'long' | 'short' | 'hold' | 'blocked', pick: DailyPick): PickAction {
  // We're long-only intraday on TWSE; map non-long actions accordingly.
  if (council === 'long') {
    return pick.entryPrice ? 'HOLD' : 'BUY'
  }
  if (council === 'hold') return 'HOLD'
  // 'short' or 'blocked' → exit if we hold; otherwise just hold (don't enter).
  return pick.entryPrice ? 'EXIT' : 'HOLD'
}

function extractVerdicts(decision: { verdicts: Array<{ role?: string; verdict?: string; rationale?: string }> }): {
  trend: string
  signal: string
  risk: string
} {
  const find = (role: string) =>
    decision.verdicts.find((v) => (v.role ?? '').toLowerCase().includes(role))?.rationale ?? '(no verdict)'
  return {
    trend: find('trend'),
    signal: find('signal'),
    risk: find('risk'),
  }
}

function extractPrice(raw: unknown): string | null {
  // Walk the response object looking for any of these keys; fugle, twstock,
  // and various wrappers all surface the latest price under one of them.
  const keys = ['lastPrice', 'closePrice', 'price', 'last', 'close', 'currentPrice', 'tradePrice']
  return walkForKey(raw, new Set(keys))
}

function walkForKey(node: unknown, keys: Set<string>, depth = 0): string | null {
  if (depth > 4 || node === null || node === undefined) return null
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>
    for (const k of Object.keys(obj)) {
      if (keys.has(k)) {
        const v = obj[k]
        if (typeof v === 'number' && Number.isFinite(v)) return String(v)
        if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) return v.trim()
      }
    }
    for (const k of Object.keys(obj)) {
      const found = walkForKey(obj[k], keys, depth + 1)
      if (found !== null) return found
    }
  }
  return null
}
