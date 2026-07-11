import type { OhlcvBar } from '@/domain/market-data/bars/index.js'
import type { OrderFlowCandidateContext } from './candidate-context.js'
import type { SummaryUnavailableReason } from './summary.js'
import {
  calculateOrderFlowAtr,
  isLatestBarEvidence,
  ORDER_FLOW_ATR_PERIOD,
} from './price-response.js'

export const EXHAUSTION_SEQUENCE_LENGTH = 3
export const EXHAUSTION_MINIMUM_COVERAGE = 0.9
export const EXHAUSTION_MAX_CANDIDATES = 3
export const EXHAUSTION_MINIMUM_SAMPLES = ORDER_FLOW_ATR_PERIOD + EXHAUSTION_SEQUENCE_LENGTH - 2

export type ExhaustionUnavailableReason = SummaryUnavailableReason | 'missing_atr'

export interface UnavailableExhaustionAnalysis {
  status: 'unavailable'
  reason: ExhaustionUnavailableReason
  sampleCount: number
  requiredSamples: number
  method: ExhaustionMethod
}

export interface ExhaustionEvidenceRef {
  index: number
  sourceIndex: number
  timestamp: string
}

export interface ExhaustionCandidate {
  kind: 'exhaustion'
  direction: 'upward' | 'downward'
  start: ExhaustionEvidenceRef
  end: ExhaustionEvidenceRef
  normalizedPriceProgression: number[]
  deltaStrengthProgression: number[]
  atrProgression: number[]
  coverage: number[]
  minimumObservedCoverage: number
  provisional: boolean
}

export interface ExhaustionMethod {
  sequenceLength: number
  priceProgress: 'strict_directional_close_progress_over_atr'
  deltaStrength: 'strictly_fading_same_direction_absolute_delta_ratio'
  atrPeriod: number
  minimumCoverage: number
}

export interface AvailableExhaustionAnalysis {
  status: 'available'
  sampleCount: number
  candidates: ExhaustionCandidate[]
  totalDetected: number
  truncated: boolean
  method: ExhaustionMethod
}

export type ExhaustionAnalysis = AvailableExhaustionAnalysis | UnavailableExhaustionAnalysis

const METHOD: ExhaustionMethod = {
  sequenceLength: EXHAUSTION_SEQUENCE_LENGTH,
  priceProgress: 'strict_directional_close_progress_over_atr',
  deltaStrength: 'strictly_fading_same_direction_absolute_delta_ratio',
  atrPeriod: ORDER_FLOW_ATR_PERIOD,
  minimumCoverage: EXHAUSTION_MINIMUM_COVERAGE,
}

function unavailable(
  reason: ExhaustionUnavailableReason,
  sampleCount: number,
): UnavailableExhaustionAnalysis {
  return {
    status: 'unavailable',
    reason,
    sampleCount,
    requiredSamples: EXHAUSTION_MINIMUM_SAMPLES,
    method: METHOD,
  }
}

function evidenceRef(
  bar: OhlcvBar,
  index: number,
  targetIndexOffset: number,
): ExhaustionEvidenceRef {
  return {
    index,
    sourceIndex: targetIndexOffset + index,
    timestamp: bar.date,
  }
}

export function detectExhaustionCandidates(params: OrderFlowCandidateContext): ExhaustionAnalysis {
  if (params.unavailableReason) {
    return unavailable(params.unavailableReason, params.deltaBars.length)
  }
  if (params.degraded) {
    return unavailable('degraded_data', params.deltaBars.length)
  }
  if (params.targetBars.length < EXHAUSTION_MINIMUM_SAMPLES
    || params.deltaBars.length < EXHAUSTION_MINIMUM_SAMPLES) {
    return unavailable(
      'insufficient_samples',
      Math.min(params.targetBars.length, params.deltaBars.length),
    )
  }

  const reliableSampleCount = params.deltaBars
    .filter(bar => bar.coverage >= EXHAUSTION_MINIMUM_COVERAGE)
    .length

  const atrByIndex = calculateOrderFlowAtr(params.targetBars)
  if (!atrByIndex.some(atr => Number.isFinite(atr) && atr > 0)) {
    return unavailable('missing_atr', params.targetBars.length)
  }

  const candidates: ExhaustionCandidate[] = []
  const lastStartIndex = params.targetBars.length - EXHAUSTION_SEQUENCE_LENGTH
  let atrReadySequenceCount = 0
  let evaluatedSequenceCount = 0

  for (let startIndex = 0; startIndex <= lastStartIndex; startIndex++) {
    const endIndex = startIndex + EXHAUSTION_SEQUENCE_LENGTH - 1
    const deltaBars = params.deltaBars.slice(startIndex, endIndex + 1)
    if (deltaBars.length !== EXHAUSTION_SEQUENCE_LENGTH) continue

    const atrProgression: number[] = []
    for (let index = startIndex + 1; index <= endIndex; index++) {
      const atr = atrByIndex[index]
      if (!Number.isFinite(atr) || atr <= 0) break
      atrProgression.push(atr)
    }
    if (atrProgression.length !== EXHAUSTION_SEQUENCE_LENGTH - 1) continue
    atrReadySequenceCount += 1
    if (deltaBars.some(bar => bar.coverage < EXHAUSTION_MINIMUM_COVERAGE)) continue
    evaluatedSequenceCount += 1

    const firstSign = Math.sign(deltaBars[0]!.deltaRatio)
    if (firstSign === 0 || deltaBars.some(bar => Math.sign(bar.deltaRatio) !== firstSign)) continue

    const deltaStrengthProgression = deltaBars.map(bar => Math.abs(bar.deltaRatio))
    if (!deltaStrengthProgression.every((strength, index) => (
      index === 0 || strength < deltaStrengthProgression[index - 1]!
    ))) continue

    const direction = firstSign > 0 ? 'upward' : 'downward'
    const priceSign = direction === 'upward' ? 1 : -1
    const normalizedPriceProgression: number[] = []
    let hasStrictPriceProgress = true

    for (let index = startIndex + 1; index <= endIndex; index++) {
      const atr = atrByIndex[index]
      const previousBar = params.targetBars[index - 1]
      const bar = params.targetBars[index]
      if (!previousBar || !bar) {
        hasStrictPriceProgress = false
        break
      }
      const progress = ((bar.close - previousBar.close) * priceSign) / atr
      if (progress <= 0) {
        hasStrictPriceProgress = false
        break
      }
      normalizedPriceProgression.push(progress)
    }
    if (!hasStrictPriceProgress) continue

    const startBar = params.targetBars[startIndex]!
    const endBar = params.targetBars[endIndex]!
    const coverage = deltaBars.map(bar => bar.coverage)
    candidates.push({
      kind: 'exhaustion',
      direction,
      start: evidenceRef(startBar, startIndex, params.targetIndexOffset),
      end: evidenceRef(endBar, endIndex, params.targetIndexOffset),
      normalizedPriceProgression,
      deltaStrengthProgression,
      atrProgression,
      coverage,
      minimumObservedCoverage: Math.min(...coverage),
      provisional: isLatestBarEvidence(endIndex, params.targetBars.length),
    })
  }

  if (evaluatedSequenceCount === 0) {
    return atrReadySequenceCount === 0
      ? unavailable('missing_atr', params.targetBars.length)
      : unavailable('insufficient_coverage', reliableSampleCount)
  }

  candidates.sort((a, b) => b.end.index - a.end.index)
  return {
    status: 'available',
    sampleCount: params.deltaBars.length,
    candidates: candidates.slice(0, EXHAUSTION_MAX_CANDIDATES),
    totalDetected: candidates.length,
    truncated: candidates.length > EXHAUSTION_MAX_CANDIDATES,
    method: METHOD,
  }
}
