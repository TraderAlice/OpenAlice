import type { OhlcvBar } from '@/domain/market-data/bars/index.js'
import { detectSwingPoints } from '@/domain/analysis/price-action/swing-detector.js'
import type { SwingPoint } from '@/domain/analysis/price-action/types.js'
import type { OrderFlowDeltaBar } from './context.js'
import type { OrderFlowCandidateContext } from './candidate-context.js'
import type { SummaryUnavailableReason } from './summary.js'

const INTERNAL_PIVOT_LOOKBACK = 5
const MINIMUM_COVERAGE = 0.9
const MAX_RETURNED_CANDIDATES = 3

export interface OrderFlowDivergencePivot {
  index: number
  sourceIndex: number
  timestamp: string
  price: number
  cvd: number
}

export interface OrderFlowDivergenceCandidate {
  kind: 'order_flow_divergence'
  method: 'confirmed_internal_pivot_cvd'
  direction: 'bullish' | 'bearish'
  provisional: false
  priorPivot: OrderFlowDivergencePivot
  currentPivot: OrderFlowDivergencePivot
  priceChange: number
  cvdChange: number
  reliability: {
    minimumCoverage: number
  }
}

export interface OrderFlowDivergenceMethod {
  pivotLevel: 'internal'
  pivotLookback: number
  cvdComparison: 'at_confirmed_price_pivots'
  minimumCoverage: number
}

export type OrderFlowDivergenceSummary = {
  status: 'available'
  sampleCount: number
  minimumCoverage: number
  candidates: OrderFlowDivergenceCandidate[]
  totalDetected: number
  truncated: boolean
  method: OrderFlowDivergenceMethod
} | {
  status: 'unavailable'
  reason: SummaryUnavailableReason
  sampleCount: number
  method: OrderFlowDivergenceMethod
}

const METHOD: OrderFlowDivergenceMethod = {
  pivotLevel: 'internal',
  pivotLookback: INTERNAL_PIVOT_LOOKBACK,
  cvdComparison: 'at_confirmed_price_pivots',
  minimumCoverage: MINIMUM_COVERAGE,
}

function unavailable(
  reason: SummaryUnavailableReason,
  sampleCount: number,
): OrderFlowDivergenceSummary {
  return { status: 'unavailable', reason, sampleCount, method: METHOD }
}

function pivotReference(
  pivot: SwingPoint,
  targetBars: OhlcvBar[],
  deltaBars: OrderFlowDeltaBar[],
  targetIndexOffset: number,
): OrderFlowDivergencePivot {
  return {
    index: pivot.index,
    sourceIndex: targetIndexOffset + pivot.index,
    timestamp: targetBars[pivot.index]!.date,
    price: pivot.price,
    cvd: deltaBars[pivot.index]!.cvd,
  }
}

function candidatesFor(
  pivots: SwingPoint[],
  direction: OrderFlowDivergenceCandidate['direction'],
  targetBars: OhlcvBar[],
  deltaBars: OrderFlowDeltaBar[],
  targetIndexOffset: number,
): {
  candidates: OrderFlowDivergenceCandidate[]
  evaluatedPairCoverages: number[]
} {
  const candidates: OrderFlowDivergenceCandidate[] = []
  const evaluatedPairCoverages: number[] = []

  for (let index = 1; index < pivots.length; index++) {
    const prior = pivotReference(pivots[index - 1]!, targetBars, deltaBars, targetIndexOffset)
    const current = pivotReference(pivots[index]!, targetBars, deltaBars, targetIndexOffset)
    const evidenceBars = deltaBars.slice(0, current.index + 1)
    const minimumCoverage = Math.min(...evidenceBars.map((bar) => bar.coverage))
    if (minimumCoverage < MINIMUM_COVERAGE) continue

    evaluatedPairCoverages.push(minimumCoverage)
    const priceChange = current.price - prior.price
    const cvdChange = current.cvd - prior.cvd
    const diverges = direction === 'bearish'
      ? priceChange > 0 && cvdChange <= 0
      : priceChange < 0 && cvdChange >= 0

    if (!diverges) continue

    candidates.push({
      kind: 'order_flow_divergence',
      method: 'confirmed_internal_pivot_cvd',
      direction,
      provisional: false,
      priorPivot: prior,
      currentPivot: current,
      priceChange,
      cvdChange,
      reliability: {
        minimumCoverage,
      },
    })
  }

  return { candidates, evaluatedPairCoverages }
}

export function buildOrderFlowDivergence(params: OrderFlowCandidateContext): OrderFlowDivergenceSummary {
  if (params.unavailableReason) {
    return unavailable(params.unavailableReason, params.deltaBars.length)
  }
  if (params.degraded) {
    return unavailable('degraded_data', params.deltaBars.length)
  }
  if (
    params.targetBars.length === 0
    || params.deltaBars.length !== params.targetBars.length
    || params.deltaBars.some((bar) => !Number.isFinite(bar.cvd))
  ) {
    return unavailable('insufficient_samples', params.deltaBars.length)
  }

  const swings = detectSwingPoints({
    bars: params.targetBars,
    internalLookback: INTERNAL_PIVOT_LOOKBACK,
  }).internal
  if (swings.highs.length < 2 && swings.lows.length < 2) {
    return unavailable('insufficient_confirmed_pivots', params.targetBars.length)
  }

  const bearish = candidatesFor(
    swings.highs,
    'bearish',
    params.targetBars,
    params.deltaBars,
    params.targetIndexOffset,
  )
  const bullish = candidatesFor(
    swings.lows,
    'bullish',
    params.targetBars,
    params.deltaBars,
    params.targetIndexOffset,
  )
  const evaluatedPairCoverages = [
    ...bearish.evaluatedPairCoverages,
    ...bullish.evaluatedPairCoverages,
  ]
  if (evaluatedPairCoverages.length === 0) {
    return unavailable('insufficient_coverage', params.targetBars.length)
  }
  const minimumCoverage = Math.min(...evaluatedPairCoverages)

  const detected = [
    ...bearish.candidates,
    ...bullish.candidates,
  ].sort((left, right) => right.currentPivot.index - left.currentPivot.index)
  const candidates = detected.slice(0, MAX_RETURNED_CANDIDATES)

  return {
    status: 'available',
    sampleCount: params.targetBars.length,
    minimumCoverage,
    candidates,
    totalDetected: detected.length,
    truncated: detected.length > candidates.length,
    method: METHOD,
  }
}
