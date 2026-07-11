import type { VolumeProfileBin } from './delta-volume.js'
import type { SummaryUnavailableReason } from './summary.js'
import { linearInterpolatedQuantile } from './stats.js'

export type ProfileNodeKind = 'hvn' | 'lvn'

export interface ProfileNode {
  kind: ProfileNodeKind
  startIndex: number
  endIndex: number
  priceLow: number
  priceHigh: number
  totalVolume: number
  averageVolume: number
  averageSmoothedVolume: number
  significanceThreshold: number
  significancePercentile: number
}

export interface VolumeGap {
  startIndex: number
  endIndex: number
  priceLow: number
  priceHigh: number
  totalVolume: number
  maxBinVolume: number
  relativeToWindowMax: number
}

export interface ProfileStructureMethod {
  smoothing: 'weighted_moving_average_3'
  smoothingWeights: readonly [number, number, number]
  hvnSignificancePercentile: number
  lvnSignificancePercentile: number
  volumeGapRelativeFloor: number
  minimumBins: number
}

export interface AvailableProfileStructure {
  status: 'available'
  sampleCount: number
  nodes: ProfileNode[]
  volumeGaps: VolumeGap[]
  method: ProfileStructureMethod
}

export interface UnavailableProfileStructure {
  status: 'unavailable'
  reason: SummaryUnavailableReason
  sampleCount: number
  method: ProfileStructureMethod
}

export type ProfileStructure = AvailableProfileStructure | UnavailableProfileStructure

const SMOOTHING_WEIGHTS = [0.25, 0.5, 0.25] as const
const HVN_SIGNIFICANCE_PERCENTILE = 0.75
const LVN_SIGNIFICANCE_PERCENTILE = 0.25
const VOLUME_GAP_RELATIVE_FLOOR = 0.01
const MINIMUM_PROFILE_BINS = 5

const METHOD: ProfileStructureMethod = {
  smoothing: 'weighted_moving_average_3',
  smoothingWeights: SMOOTHING_WEIGHTS,
  hvnSignificancePercentile: HVN_SIGNIFICANCE_PERCENTILE,
  lvnSignificancePercentile: LVN_SIGNIFICANCE_PERCENTILE,
  volumeGapRelativeFloor: VOLUME_GAP_RELATIVE_FLOOR,
  minimumBins: MINIMUM_PROFILE_BINS,
}

function smoothVolumes(bins: VolumeProfileBin[]): number[] {
  return bins.map((bin, index) => {
    const left = bins[index - 1]?.volume ?? bin.volume
    const right = bins[index + 1]?.volume ?? bin.volume
    return left * SMOOTHING_WEIGHTS[0]
      + bin.volume * SMOOTHING_WEIGHTS[1]
      + right * SMOOTHING_WEIGHTS[2]
  })
}

function qualifyingNodeKinds(smoothed: number[]): Array<ProfileNodeKind | null> {
  const hvnThreshold = linearInterpolatedQuantile(smoothed, HVN_SIGNIFICANCE_PERCENTILE)
  const lvnThreshold = linearInterpolatedQuantile(smoothed, LVN_SIGNIFICANCE_PERCENTILE)

  return smoothed.map((current, index) => {
    if (index === 0 || index === smoothed.length - 1) return null
    const previous = smoothed[index - 1]!
    const next = smoothed[index + 1]!
    const localPeak = current >= previous && current >= next && (current > previous || current > next)
    if (localPeak && current >= hvnThreshold) return 'hvn'
    const localValley = current <= previous && current <= next && (current < previous || current < next)
    if (localValley && current <= lvnThreshold) return 'lvn'
    return null
  })
}

function buildNodes(bins: VolumeProfileBin[], smoothed: number[]): ProfileNode[] {
  const kinds = qualifyingNodeKinds(smoothed)
  const thresholds = {
    hvn: linearInterpolatedQuantile(smoothed, HVN_SIGNIFICANCE_PERCENTILE),
    lvn: linearInterpolatedQuantile(smoothed, LVN_SIGNIFICANCE_PERCENTILE),
  }
  const percentiles = {
    hvn: HVN_SIGNIFICANCE_PERCENTILE,
    lvn: LVN_SIGNIFICANCE_PERCENTILE,
  }
  const nodes: ProfileNode[] = []

  for (let index = 0; index < kinds.length;) {
    const kind = kinds[index]
    if (!kind) {
      index += 1
      continue
    }

    let endIndex = index
    while (kinds[endIndex + 1] === kind) endIndex += 1
    const nodeBins = bins.slice(index, endIndex + 1)
    const nodeSmoothed = smoothed.slice(index, endIndex + 1)
    const totalVolume = nodeBins.reduce((sum, bin) => sum + bin.volume, 0)
    nodes.push({
      kind,
      startIndex: index,
      endIndex,
      priceLow: bins[index]!.priceLow,
      priceHigh: bins[endIndex]!.priceHigh,
      totalVolume,
      averageVolume: totalVolume / nodeBins.length,
      averageSmoothedVolume: nodeSmoothed.reduce((sum, volume) => sum + volume, 0) / nodeSmoothed.length,
      significanceThreshold: thresholds[kind],
      significancePercentile: percentiles[kind],
    })
    index = endIndex + 1
  }

  return nodes
}

function buildVolumeGaps(bins: VolumeProfileBin[]): VolumeGap[] {
  const windowMax = Math.max(...bins.map(bin => bin.volume))
  if (windowMax <= 0) return []
  const negligibleFloor = windowMax * VOLUME_GAP_RELATIVE_FLOOR
  const negligible = bins.map(bin => bin.volume <= negligibleFloor)
  const gaps: VolumeGap[] = []

  for (let index = 1; index < bins.length - 1;) {
    if (!negligible[index]) {
      index += 1
      continue
    }

    let endIndex = index
    while (endIndex + 1 < bins.length - 1 && negligible[endIndex + 1]) endIndex += 1
    if (!negligible[index - 1] && !negligible[endIndex + 1]) {
      const gapBins = bins.slice(index, endIndex + 1)
      const totalVolume = gapBins.reduce((sum, bin) => sum + bin.volume, 0)
      const maxBinVolume = Math.max(...gapBins.map(bin => bin.volume))
      gaps.push({
        startIndex: index,
        endIndex,
        priceLow: bins[index]!.priceLow,
        priceHigh: bins[endIndex]!.priceHigh,
        totalVolume,
        maxBinVolume,
        relativeToWindowMax: maxBinVolume / windowMax,
      })
    }
    index = endIndex + 1
  }

  return gaps
}

export function buildProfileStructure(
  bins: VolumeProfileBin[] | null,
  unavailableReason?: SummaryUnavailableReason,
): ProfileStructure {
  if (!bins || bins.length === 0) {
    return {
      status: 'unavailable',
      reason: unavailableReason ?? 'insufficient_samples',
      sampleCount: bins?.length ?? 0,
      method: METHOD,
    }
  }
  if (bins.length < MINIMUM_PROFILE_BINS) {
    return { status: 'unavailable', reason: 'insufficient_samples', sampleCount: bins.length, method: METHOD }
  }

  const smoothed = smoothVolumes(bins)
  return {
    status: 'available',
    sampleCount: bins.length,
    nodes: buildNodes(bins, smoothed),
    volumeGaps: buildVolumeGaps(bins),
    method: METHOD,
  }
}
