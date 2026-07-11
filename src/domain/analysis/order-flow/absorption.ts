import type { OrderFlowCandidateContext } from './candidate-context.js'
import type { OrderFlowDeltaBar } from './context.js'
import type { SummaryUnavailableReason } from './summary.js'
import {
  calculateOrderFlowAtr,
  directionalOpenToCloseProgress,
  isLatestBarEvidence,
  ORDER_FLOW_ATR_PERIOD,
} from './price-response.js'
import { linearInterpolatedQuantile } from './stats.js'

export const ABSORPTION_DELTA_PERCENTILE = 0.9
export const ABSORPTION_MAX_DIRECTIONAL_PROGRESS = 0.25
export const ABSORPTION_MINIMUM_COVERAGE = 0.9
export const ABSORPTION_MAX_CANDIDATES = 3
export const ABSORPTION_MINIMUM_SAMPLES = ORDER_FLOW_ATR_PERIOD

export type AbsorptionUnavailableReason = SummaryUnavailableReason | 'missing_atr'

export interface UnavailableAbsorptionAnalysis {
  status: 'unavailable'
  reason: AbsorptionUnavailableReason
  sampleCount: number
  requiredSamples: number
  method: AbsorptionMethodDefaults
}

export interface AbsorptionCandidate {
  kind: 'absorption'
  direction: 'positive' | 'negative'
  index: number
  sourceIndex: number
  timestamp: string
  deltaRatio: number
  absoluteDeltaRatio: number
  percentileThreshold: number
  directionalPriceProgress: number
  atr: number
  coverage: number
  confidence: OrderFlowDeltaBar['confidence']
  provisional: boolean
}

export interface AbsorptionMethodDefaults {
  deltaExtreme: 'absolute_delta_ratio_window_percentile'
  percentile: number
  priceResponse: 'directional_open_to_close_over_atr'
  maximumDirectionalProgress: number
  atrPeriod: number
  minimumCoverage: number
}

export interface AvailableAbsorptionAnalysis {
  status: 'available'
  sampleCount: number
  candidates: AbsorptionCandidate[]
  totalDetected: number
  truncated: boolean
  method: AbsorptionMethodDefaults & {
    percentileThreshold: number
  }
}

export type AbsorptionAnalysis = AvailableAbsorptionAnalysis | UnavailableAbsorptionAnalysis

const METHOD_DEFAULTS: AbsorptionMethodDefaults = {
  deltaExtreme: 'absolute_delta_ratio_window_percentile',
  percentile: ABSORPTION_DELTA_PERCENTILE,
  priceResponse: 'directional_open_to_close_over_atr',
  maximumDirectionalProgress: ABSORPTION_MAX_DIRECTIONAL_PROGRESS,
  atrPeriod: ORDER_FLOW_ATR_PERIOD,
  minimumCoverage: ABSORPTION_MINIMUM_COVERAGE,
}

function unavailable(
  reason: AbsorptionUnavailableReason,
  sampleCount: number,
): UnavailableAbsorptionAnalysis {
  return {
    status: 'unavailable',
    reason,
    sampleCount,
    requiredSamples: ABSORPTION_MINIMUM_SAMPLES,
    method: METHOD_DEFAULTS,
  }
}

export function detectAbsorptionCandidates(params: OrderFlowCandidateContext): AbsorptionAnalysis {
  if (params.unavailableReason) {
    return unavailable(params.unavailableReason, params.deltaBars.length)
  }
  if (params.degraded) {
    return unavailable('degraded_data', params.deltaBars.length)
  }
  if (params.targetBars.length < ABSORPTION_MINIMUM_SAMPLES
    || params.deltaBars.length < ABSORPTION_MINIMUM_SAMPLES) {
    return unavailable('insufficient_samples', Math.min(params.targetBars.length, params.deltaBars.length))
  }

  const reliableDeltaBars = params.deltaBars.filter(bar => bar.coverage >= ABSORPTION_MINIMUM_COVERAGE)
  if (reliableDeltaBars.length < ABSORPTION_MINIMUM_SAMPLES) {
    return unavailable('insufficient_coverage', reliableDeltaBars.length)
  }

  const atrByIndex = calculateOrderFlowAtr(params.targetBars)
  if (!atrByIndex.some(atr => Number.isFinite(atr) && atr > 0)) {
    return unavailable('missing_atr', params.targetBars.length)
  }

  const percentileThreshold = linearInterpolatedQuantile(
    reliableDeltaBars.map(bar => Math.abs(bar.deltaRatio)),
    ABSORPTION_DELTA_PERCENTILE,
  )
  const minimumAbsoluteDeltaRatio = Math.min(...reliableDeltaBars.map(bar => Math.abs(bar.deltaRatio)))
  const candidates: AbsorptionCandidate[] = []

  for (let index = 0; index < params.targetBars.length; index++) {
    const bar = params.targetBars[index]
    const deltaBar = params.deltaBars[index]
    const atr = atrByIndex[index]
    if (!bar || !deltaBar || deltaBar.coverage < ABSORPTION_MINIMUM_COVERAGE) continue

    const absoluteDeltaRatio = Math.abs(deltaBar.deltaRatio)
    if (percentileThreshold <= minimumAbsoluteDeltaRatio || absoluteDeltaRatio < percentileThreshold) continue

    const response = directionalOpenToCloseProgress(bar, deltaBar.deltaRatio, atr)
    if (!response || response.directionalPriceProgress > ABSORPTION_MAX_DIRECTIONAL_PROGRESS) continue

    candidates.push({
      kind: 'absorption',
      direction: deltaBar.deltaRatio > 0 ? 'positive' : 'negative',
      index,
      sourceIndex: params.targetIndexOffset + index,
      timestamp: bar.date,
      deltaRatio: deltaBar.deltaRatio,
      absoluteDeltaRatio,
      percentileThreshold,
      directionalPriceProgress: response.directionalPriceProgress,
      atr: response.atr,
      coverage: deltaBar.coverage,
      confidence: deltaBar.confidence,
      provisional: isLatestBarEvidence(index, params.targetBars.length),
    })
  }

  candidates.sort((a, b) => b.index - a.index)
  return {
    status: 'available',
    sampleCount: reliableDeltaBars.length,
    candidates: candidates.slice(0, ABSORPTION_MAX_CANDIDATES),
    totalDetected: candidates.length,
    truncated: candidates.length > ABSORPTION_MAX_CANDIDATES,
    method: {
      ...METHOD_DEFAULTS,
      percentileThreshold,
    },
  }
}
