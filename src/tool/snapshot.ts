/**
 * Market Snapshot — MCP tool.
 *
 * The honest as-of read for "what did/does it look like at time T". Wraps
 * `getSnapshot` (domain/analysis) over the federated bar service, and — given a
 * bare symbol instead of a barId — resolves to the FRESHEST source (realtime
 * broker before delayed vendor), so the analyst's natural reach lands on the
 * live price, not a delayed vendor that silently stopped a day behind. That
 * source mis-wiring (analysis CLI defaults to delayed; realtime hid in the
 * trading CLI) is the gap this closes.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { BarService } from '@/domain/market-data/bars/index'
import { getSnapshot } from '@/domain/analysis/snapshot'
import { resolveBarSource } from './source-resolve.js'

export function createSnapshotTools(barService: BarService) {
  return {
    marketSnapshot: tool({
      description: `Honest as-of snapshot of a symbol: DATED bars (no lookahead past asOf), the most-recent ACTUAL print (close + vs-prevClose + day high/low + amplitude), a compact technical state (sma20/50, rsi14, distance from period high/low), AND a loud freshness contract.

Use this — not calculateQuant — whenever the question is "what does/did X look like" or "rewind X to a date":
  - "how's XLE right now" → marketSnapshot --query XLE
  - "what did NVDA look like on 2026-04-15" → marketSnapshot --query NVDA --asOf 2026-04-15
Why it beats hand-rolling from quant: quant returns latest scalars with NO dates and CANNOT emit a dated series; snapshot returns the dated path AND guarantees no-lookahead at asOf.

Source: pass a barId (from searchBars) to pin one, OR a bare symbol/query — then it auto-picks the FRESHEST source (realtime broker > delayed vendor). For a vendor symbol you may need asset=.

FRESHNESS IS LOAD-BEARING. The result carries asOf / isLatestActual / staleTradingDays, and a freshnessWarning when the data does not reach the anchor. If isLatestActual is false, the "latest" close is STALE — do not report it as the current price (this is the exact trap that turns an overnight catalyst into a missed/【misread】move). Prefer a realtime broker source for anything time-sensitive.`,
      inputSchema: z.object({
        query: z.string().optional().describe('Symbol or keyword (e.g. "XLE", "NVDA"). Auto-picks the freshest source. Omit if barId is given.'),
        barId: z.string().optional().describe('Pin a specific source, e.g. "alpaca-paper|XLE". Takes precedence over query.'),
        asset: z.enum(['equity', 'crypto', 'currency', 'commodity']).optional().describe('Asset class — needed only for a VENDOR barId/symbol; broker barIds infer it.'),
        asOf: z.string().optional().describe('Point-in-time YYYY-MM-DD. Bars never run past it (no lookahead). Default: now.'),
        interval: z.string().optional().describe('Bar interval (default "1d").'),
        count: z.number().int().positive().optional().describe('Analysis window fetched for the levels (default 90; sma50 needs ≥50). NOT the output size.'),
        bars: z.number().int().nonnegative().optional().describe('How many recent dated bars to RETURN in `bars` (default 0 = summary only — latest + levels + freshness). Set e.g. 30/90 when you need the dated path (it can be large). `windowBars` tells how many are available.'),
      }).meta({ examples: [{ query: 'XLE' }, { query: 'NVDA', asOf: '2026-04-15', bars: 30 }] }),
      execute: async ({ query, barId, asset, asOf, interval, count, bars }) => {
        const resolved = await resolveBarSource(barService, { query, barId, asset })
        if ('error' in resolved) return resolved
        const snap = await getSnapshot(barService, resolved.ref as never, {
          ...(asOf ? { asOf } : {}),
          ...(interval ? { interval } : {}),
          ...(count ? { count } : {}),
          ...(bars != null ? { barsOut: bars } : {}),
        })
        return resolved.pickedFrom ? { ...snap, autoPickedSource: resolved.pickedFrom } : snap
      },
    }),
  }
}
