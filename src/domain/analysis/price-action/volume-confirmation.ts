import { calculateDeltaVolume } from '@/domain/analysis/order-flow/delta-volume'
import { chooseIntrabarPlan, confidenceForCoverage } from '@/domain/analysis/order-flow/intrabar-plan'
import { parseBarId, type BarService, type BarSourceRef } from '@/domain/market-data/bars/index'
import type { OhlcvBar } from '@/domain/market-data/bars/types'
import type { PriceActionVolumeConfirmationInput } from './types.js'

type PriceActionVolumeConfirmationStatus = 'available' | 'disabled' | 'unavailable'

export interface BuildPriceActionVolumeConfirmationsResult {
  confirmations?: Map<number, PriceActionVolumeConfirmationInput>
  meta: {
    volumeConfirmation: PriceActionVolumeConfirmationStatus
    volumeConfirmationReason?: string
    volumeConfirmationCoverageBars?: number
    volumeConfirmationLowConfidenceBars?: number
    volumeConfirmationIntrabarInterval?: string
    volumeConfirmationIntrabarCount?: number
  }
}

export async function buildPriceActionVolumeConfirmations(params: {
  barService: BarService
  ref: BarSourceRef
  barId: string
  interval: string
  bars: OhlcvBar[]
  enabled: boolean
}): Promise<BuildPriceActionVolumeConfirmationsResult> {
  const { barService, ref, barId, interval, bars, enabled } = params

  if (!enabled) {
    return { meta: { volumeConfirmation: 'disabled' } }
  }
  if (bars.length === 0) {
    return {
      meta: {
        volumeConfirmation: 'unavailable',
        volumeConfirmationReason: 'No target bars returned',
      },
    }
  }
  if (interval === '1m') {
    return {
      meta: {
        volumeConfirmation: 'unavailable',
        volumeConfirmationReason: 'No lower timeframe is available below 1m bars',
      },
    }
  }
  if ('barId' in ref && parseBarId(ref.barId) && !ref.assetClass) {
    return {
      meta: {
        volumeConfirmation: 'unavailable',
        volumeConfirmationReason: `Vendor barId "${ref.barId}" needs an assetClass to route intrabar volume confirmation. Pass { barId, assetClass } or disable volume confirmation.`,
      },
    }
  }

  try {
    const intrabarPlan = chooseIntrabarPlan(interval, bars.length, barId)
    const targetBars = bars.slice(-intrabarPlan.actualCount)
    const indexOffset = bars.length - targetBars.length
    const firstBar = targetBars[0]
    const lastBar = targetBars[targetBars.length - 1]
    const intrabarResult = await barService.getBars(ref, {
      interval: intrabarPlan.intrabarInterval,
      start: firstBar.date.slice(0, 10),
      end: lastBar.date.slice(0, 10),
    })

    if (intrabarResult.bars.length === 0) {
      return {
        meta: {
          volumeConfirmation: 'unavailable',
          volumeConfirmationReason: `No intrabar data (${intrabarPlan.intrabarInterval}) returned for the target window`,
          volumeConfirmationIntrabarInterval: intrabarPlan.intrabarInterval,
          volumeConfirmationIntrabarCount: 0,
        },
      }
    }

    const delta = calculateDeltaVolume({
      targetBars,
      intrabars: intrabarResult.bars,
      targetInterval: interval,
    })
    const confirmations = new Map<number, PriceActionVolumeConfirmationInput>()
    for (let i = 0; i < targetBars.length; i++) {
      confirmations.set(indexOffset + i, {
        delta: delta.deltas[i],
        deltaRatio: delta.deltaRatios[i],
        coverage: delta.coverage[i],
        confidence: confidenceForCoverage(delta.coverage[i]),
        intrabarInterval: intrabarPlan.intrabarInterval,
        intrabarCount: intrabarResult.bars.length,
      })
    }

    return {
      confirmations,
      meta: {
        volumeConfirmation: 'available',
        volumeConfirmationCoverageBars: targetBars.length,
        volumeConfirmationLowConfidenceBars: delta.lowConfidenceIndices.length,
        volumeConfirmationIntrabarInterval: intrabarPlan.intrabarInterval,
        volumeConfirmationIntrabarCount: intrabarResult.bars.length,
        volumeConfirmationReason: intrabarPlan.degradationReason,
      },
    }
  } catch (err) {
    return {
      meta: {
        volumeConfirmation: 'unavailable',
        volumeConfirmationReason: err instanceof Error ? err.message : String(err),
      },
    }
  }
}
