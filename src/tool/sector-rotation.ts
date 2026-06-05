/**
 * Sector Rotation Tool
 *
 * sectorRotation: cross-sectional view of the 11 GICS sector ETFs (+ SPY anchor)
 *   on multi-period momentum and the two volume axes, ranked by a blended
 *   rotation score. Pure orchestration: fetch daily histories, hand to the
 *   domain compute (`domain/analysis/sector-rotation`).
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { EquityClientLike } from '@/domain/market-data/client/types'
import { fetchSectorRotation } from '@/domain/analysis/sector-rotation.js'

export function createSectorRotationTools(equityClient: EquityClientLike) {
  return {
    sectorRotation: tool({
      description: `Read sector rotation — which GICS sectors capital is rotating into or out of.

Compares the 11 SPDR sector ETFs (XLK/XLF/XLV/XLY/XLP/XLE/XLI/XLB/XLU/XLRE/XLC)
plus SPY as the benchmark, across 1D/1W/1M/3M/6M, on two volume axes
(dollar-volume share + RVOL) and price momentum.

Each row carries: returns + rel_strength (vs SPY) per period; momentum_acceleration
(short-window pace vs long-window pace); dollar_volume and dv_share (capital weight);
dv_share_change (this sector taking a bigger/smaller slice of sector volume than its
recent norm — the rotation signal); rvol; and rotation_score.

rotation_score is the blended cross-sectional rank (momentum acceleration + dollar-volume
share change). Rows come sorted by it, descending — top = rotating in, bottom = rotating
out. SPY is returned separately as the benchmark.

This is the broad-sector lens. For a specific theme (robotics, uranium, cybersecurity,
...) use etfSearch + etfGetInfo to go one level deeper. See the methodology field for the
exact definitions and the fund-flow-proxy caveat.`,
      inputSchema: z.object({}).meta({ examples: [{}] }),
      execute: async () => fetchSectorRotation(equityClient),
    }),
  }
}
