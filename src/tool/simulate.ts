/**
 * Simulate / backtest — MCP tool.
 *
 * Wraps `simulate` (domain/analysis): enter at a date, apply one built-in exit
 * rule, walk dated bars to asOf (no lookahead), report the round-trip. Same
 * freshest-source resolution as marketSnapshot — a bare symbol auto-picks a
 * realtime broker over a delayed vendor.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { BarService } from '@/domain/market-data/bars/index'
import { simulate, type ExitRule } from '@/domain/analysis/simulate'
import { resolveBarSource } from './source-resolve.js'

export function createSimulateTools(barService: BarService) {
  return {
    simulate: tool({
      description: `Backtest ONE entry + ONE exit rule over dated bars (no lookahead past asOf). Answers "if I'd bought X on date D, would <exit rule> have saved me?" — the reusable version of hand-rolling an equity path in Python.

Exit rules (pass exitRule + its param):
  - trailing_stop  exitPct=N   → exit when close falls N% from the running peak
  - ma_break       exitPeriod=N → exit on the first close below its N-bar SMA
  - stop           exitPct=N   → exit when close falls N% below entry
  - target         exitPct=N   → exit when close rises N% above entry
  - hold                        → never exit; measure entry → asOf

Returns entry/exit (date·price·reason), returnPct, MFE/MAE (max favorable/adverse excursion %), peak/trough, and a sampled path. open=true means no exit triggered by asOf (return is mark-to-market). Source: a barId pins one; a bare symbol/query auto-picks the freshest (realtime broker > delayed vendor).`,
      inputSchema: z.object({
        query: z.string().optional().describe('Symbol/keyword — auto-picks the freshest source. Omit if barId given.'),
        barId: z.string().optional().describe('Pin a source, e.g. "alpaca-paper|XLE". Wins over query.'),
        asset: z.enum(['equity', 'crypto', 'currency', 'commodity']).optional().describe('Needed only for a VENDOR barId/symbol.'),
        entryDate: z.string().describe('Enter at the close of the first bar on/after this date (YYYY-MM-DD).'),
        exitRule: z.enum(['trailing_stop', 'ma_break', 'stop', 'target', 'hold']).describe('Which built-in exit.'),
        exitPct: z.number().positive().optional().describe('Percent for trailing_stop / stop / target.'),
        exitPeriod: z.number().int().positive().optional().describe('SMA period for ma_break.'),
        interval: z.string().optional().describe('Bar interval (default "1d").'),
        asOf: z.string().optional().describe('Evaluate up to here (YYYY-MM-DD). Default: now.'),
      }).meta({ examples: [{ query: 'XLE', entryDate: '2026-04-01', exitRule: 'trailing_stop', exitPct: 8 }] }),
      execute: async ({ query, barId, asset, entryDate, exitRule, exitPct, exitPeriod, interval, asOf }) => {
        // Build the exit rule from flat params, validating the required param.
        let exit: ExitRule
        switch (exitRule) {
          case 'trailing_stop': case 'stop': case 'target':
            if (exitPct == null) return { error: `exitRule "${exitRule}" needs exitPct (a percent).` }
            exit = { type: exitRule, pct: exitPct }
            break
          case 'ma_break':
            if (exitPeriod == null) return { error: 'exitRule "ma_break" needs exitPeriod (the SMA length).' }
            exit = { type: 'ma_break', period: exitPeriod }
            break
          case 'hold':
            exit = { type: 'hold' }
            break
        }

        const resolved = await resolveBarSource(barService, { query, barId, asset })
        if ('error' in resolved) return resolved

        return simulate(barService, resolved.ref as never, {
          entryDate,
          exit,
          ...(interval ? { interval } : {}),
          ...(asOf ? { asOf } : {}),
        })
      },
    }),
  }
}
