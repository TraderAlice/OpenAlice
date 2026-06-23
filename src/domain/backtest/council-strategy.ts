/**
 * CouncilStrategy — adapter that turns a StrategyCouncil into a
 * backtest StrategyFn.
 *
 * Caveat: the council internally calls an LLM per role, which means
 * a 1000-bar backtest at 3 LLM calls per bar would cost O(thousands)
 * of API calls. The MVP adapter is therefore best used for sparse
 * evaluation — e.g. deliberate once every N bars, or only after a
 * simple pre-filter fires — rather than every bar.
 *
 * For large-scale backtests of the coordinator logic itself, use
 * pure-function strategies (see tests) and fake the council only
 * when you specifically want to measure the fusion rules end-to-end.
 */

import type { StrategyFn, StrategyAction, BarCursor, StrategyState } from './types.js'
import type { StrategyCouncil, FinalAction } from '../../core/strategy-council/index.js'

export interface CouncilStrategyOpts {
  council: StrategyCouncil
  /** Only deliberate every N bars (default 1 = every bar). */
  deliberateEvery?: number
  /** Position size used when the council says long/short. */
  defaultSize: number
  /** Build the prompt fed to the council from the current cursor. */
  buildPrompt?: (cursor: BarCursor, state: StrategyState) => string
}

export function createCouncilStrategy(opts: CouncilStrategyOpts): StrategyFn {
  const every = opts.deliberateEvery ?? 1
  const build = opts.buildPrompt ?? defaultPromptBuilder

  return async (cursor, state) => {
    if (state.barsSeen % every !== 0) {
      return { type: 'hold' }
    }
    const prompt = build(cursor, state)
    const decision = await opts.council.deliberate(prompt)
    return toStrategyAction(decision.finalAction, opts.defaultSize * decision.positionFactor, state)
  }
}

// ==================== Helpers ====================

function toStrategyAction(
  action: FinalAction,
  size: number,
  state: StrategyState,
): StrategyAction {
  const hasPosition = state.position !== null
  switch (action) {
    case 'long':
      if (hasPosition && state.position?.side === 'long') return { type: 'hold' }
      if (hasPosition && state.position?.side === 'short') {
        return { type: 'exit', reason: 'council flipped to long' }
      }
      return { type: 'enter', side: 'long', size, reason: 'council:long' }
    case 'short':
      if (hasPosition && state.position?.side === 'short') return { type: 'hold' }
      if (hasPosition && state.position?.side === 'long') {
        return { type: 'exit', reason: 'council flipped to short' }
      }
      return { type: 'enter', side: 'short', size, reason: 'council:short' }
    case 'blocked':
      // Blocked means "don't enter". If we hold an open position we
      // leave it alone — blocking does not imply exit.
      return { type: 'hold' }
    case 'hold':
      return { type: 'hold' }
  }
}

function defaultPromptBuilder(cursor: BarCursor, _state: StrategyState): string {
  const recent = cursor.lastN(20)
  const latest = cursor.current
  const first = recent[0]
  const pct = first ? (((latest.close - first.open) / first.open) * 100).toFixed(2) : '0.00'
  const lines: string[] = []
  lines.push(`Intraday context at bar ${cursor.index}.`)
  lines.push(`Latest close: ${latest.close}, high: ${latest.high}, low: ${latest.low}, volume: ${latest.volume}.`)
  lines.push(`Last 20 bars moved ${pct}% from open. Evaluate the setup.`)
  return lines.join(' ')
}
