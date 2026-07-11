import type { BarMeta, BarService, BarSourceRef, OhlcvBar } from '@/domain/market-data/bars/index.js'
import {
  calculateDeltaVolume,
  calculateVolumeProfile,
  type VolumeProfileBin,
} from './delta-volume.js'
import { confidenceForCoverage, type IntrabarPlan } from './intrabar-plan.js'
import { loadIntrabarWindow } from './intrabar-window.js'
import { buildOrderFlowStructureSummary, type OrderFlowStructureSummary } from './summary.js'

export type OrderFlowContextMode = 'context' | 'summary' | 'delta' | 'profile'
export type OrderFlowContextStatus = 'ok' | 'no_target_bars' | 'no_intrabars'

export interface OrderFlowSourceRequest {
  barId: string
  assetClass?: 'equity' | 'crypto' | 'currency' | 'commodity'
}

export interface AnalyzeOrderFlowContextParams extends OrderFlowSourceRequest {
  interval: string
  count?: number
  start?: string
  end?: string
  mode?: OrderFlowContextMode
  numBins?: number
  targetBars?: OhlcvBar[]
  targetMeta?: BarMeta
}

export interface OrderFlowDeltaBar extends OhlcvBar {
  delta: number
  approxDelta: number
  cumulativeDelta: number
  cvd: number
  deltaRatio: number
  coverage: number
  confidence: ReturnType<typeof confidenceForCoverage>
  lowConfidence: boolean
  isApproximation: true
}

export interface OrderFlowMeta extends IntrabarPlan {
  intrabarTimeframe: string
  intrabarCount: number
  targetBars: number
  targetIndexOffset: number
  lowConfidenceBars?: number
  isApproximation: true
  [key: string]: unknown
}

export interface OrderFlowDeltaContext {
  bars: OrderFlowDeltaBar[]
}

export interface OrderFlowProfileContext {
  bins: VolumeProfileBin[]
  poc: VolumeProfileBin | null
  valueArea: {
    high: number
    low: number
  } | null
}

export interface OrderFlowContextAnalysis {
  status: OrderFlowContextStatus
  error?: string
  delta?: OrderFlowDeltaContext
  profile?: OrderFlowProfileContext
  summary?: OrderFlowStructureSummary
  meta: OrderFlowMeta
}

const DEFAULT_ORDER_FLOW_COUNT = 100
const DEFAULT_PROFILE_BINS = 20

function sourceRef(source: OrderFlowSourceRequest): BarSourceRef {
  return source.assetClass ? { barId: source.barId, assetClass: source.assetClass } : { barId: source.barId }
}

function wantsDelta(mode: OrderFlowContextMode): boolean {
  return mode === 'context' || mode === 'delta'
}

function wantsProfile(mode: OrderFlowContextMode): boolean {
  return mode === 'context' || mode === 'profile'
}

function wantsSummary(mode: OrderFlowContextMode): boolean {
  return mode === 'context' || mode === 'summary'
}

function baseMeta(params: {
  targetMeta?: BarMeta
  plan: IntrabarPlan
  intrabarCount: number
  targetBars: number
  targetIndexOffset: number
  lowConfidenceBars?: number
}): OrderFlowMeta {
  return {
    ...params.targetMeta,
    ...params.plan,
    intrabarTimeframe: params.plan.intrabarInterval,
    intrabarCount: params.intrabarCount,
    targetBars: params.targetBars,
    targetIndexOffset: params.targetIndexOffset,
    ...(params.lowConfidenceBars === undefined ? {} : { lowConfidenceBars: params.lowConfidenceBars }),
    isApproximation: true,
  }
}

function emptyDelta(enabled: boolean): OrderFlowDeltaContext | undefined {
  return enabled ? { bars: [] } : undefined
}

function emptyProfile(enabled: boolean): OrderFlowProfileContext | undefined {
  return enabled ? { bins: [], poc: null, valueArea: null } : undefined
}

export async function analyzeOrderFlowContext(
  barService: BarService,
  params: AnalyzeOrderFlowContextParams,
): Promise<OrderFlowContextAnalysis> {
  const mode = params.mode ?? 'context'
  const ref = sourceRef(params)
  const requestedCount = params.count ?? DEFAULT_ORDER_FLOW_COUNT
  const window = await loadIntrabarWindow({
    barService,
    ref,
    barId: params.barId,
    targetInterval: params.interval,
    requestedCount,
    start: params.start,
    end: params.end,
    targetBars: params.targetBars,
    targetMeta: params.targetMeta,
  })

  if (window.status === 'no_target_bars') {
    return {
      status: 'no_target_bars',
      error: 'No target bars returned for the requested window',
      delta: emptyDelta(wantsDelta(mode)),
      profile: emptyProfile(wantsProfile(mode)),
      summary: wantsSummary(mode)
        ? buildOrderFlowStructureSummary({
          targetBars: [],
          deltaBars: [],
          profile: null,
          intrabarCount: 0,
          targetIndexOffset: window.targetIndexOffset,
          unavailableReason: 'missing_target_bars',
        })
        : undefined,
      meta: baseMeta({
        targetMeta: window.targetMeta,
        plan: window.plan,
        intrabarCount: 0,
        targetBars: 0,
        targetIndexOffset: window.targetIndexOffset,
      }),
    }
  }

  if (window.status === 'no_intrabars') {
    return {
      status: 'no_intrabars',
      error: `No intrabar data (${window.plan.intrabarInterval}) returned for the target window`,
      delta: emptyDelta(wantsDelta(mode)),
      profile: emptyProfile(wantsProfile(mode)),
      summary: wantsSummary(mode)
        ? buildOrderFlowStructureSummary({
          targetBars: window.targetBars,
          deltaBars: [],
          profile: null,
          intrabarCount: 0,
          targetIndexOffset: window.targetIndexOffset,
          unavailableReason: 'missing_intrabars',
        })
        : undefined,
      meta: baseMeta({
        targetMeta: window.targetMeta,
        plan: window.plan,
        intrabarCount: 0,
        targetBars: window.targetBars.length,
        targetIndexOffset: window.targetIndexOffset,
      }),
    }
  }

  const delta = (wantsDelta(mode) || wantsSummary(mode))
    ? calculateDeltaVolume({
      targetBars: window.targetBars,
      intrabars: window.intrabars,
      targetInterval: params.interval,
    })
    : undefined
  const profile = (wantsProfile(mode) || wantsSummary(mode))
    ? calculateVolumeProfile({
      bars: window.intrabars,
      numBins: params.numBins ?? DEFAULT_PROFILE_BINS,
    })
    : undefined

  const deltaBars: OrderFlowDeltaBar[] = delta
    ? window.targetBars.map((bar, i) => ({
      ...bar,
      delta: delta.deltas[i],
      approxDelta: delta.deltas[i],
      cumulativeDelta: delta.cumulativeDeltas[i],
      cvd: delta.cumulativeDeltas[i],
      deltaRatio: delta.deltaRatios[i],
      coverage: delta.coverage[i],
      confidence: confidenceForCoverage(delta.coverage[i]),
      lowConfidence: delta.lowConfidenceIndices.includes(i),
      isApproximation: true,
    }))
    : []
  const profileContext: OrderFlowProfileContext | null = profile
    ? {
      bins: profile.bins,
      poc: profile.poc,
      valueArea: {
        high: profile.valueAreaHigh,
        low: profile.valueAreaLow,
      },
    }
    : null

  return {
    status: 'ok',
    delta: wantsDelta(mode) ? { bars: deltaBars } : undefined,
    profile: wantsProfile(mode) ? profileContext ?? undefined : undefined,
    summary: wantsSummary(mode)
      ? buildOrderFlowStructureSummary({
        targetBars: window.targetBars,
        deltaBars,
        profile: profileContext,
        intrabarCount: window.intrabars.length,
        targetIndexOffset: window.targetIndexOffset,
        degraded: window.plan.degradationReason !== undefined,
      })
      : undefined,
    meta: baseMeta({
      targetMeta: window.targetMeta,
      plan: window.plan,
      intrabarCount: window.intrabars.length,
      targetBars: window.targetBars.length,
      targetIndexOffset: window.targetIndexOffset,
      lowConfidenceBars: delta?.lowConfidenceIndices.length,
    }),
  }
}
