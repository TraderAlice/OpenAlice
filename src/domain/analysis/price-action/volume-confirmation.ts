import { calculateDeltaVolume } from '@/domain/analysis/order-flow/delta-volume.js'
import { confidenceForCoverage } from '@/domain/analysis/order-flow/intrabar-plan.js'
import { loadIntrabarWindow } from '@/domain/analysis/order-flow/intrabar-window.js'
import { parseBarId, type BarService, type BarSourceRef } from '@/domain/market-data/bars/index.js'
import type { OhlcvBar } from '@/domain/market-data/bars/types.js'
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
    const window = await loadIntrabarWindow({
      barService,
      ref,
      barId,
      targetInterval: interval,
      requestedCount: bars.length,
      targetBars: bars,
    })

    if (window.status === 'no_intrabars') {
      return {
        meta: {
          volumeConfirmation: 'unavailable',
          volumeConfirmationReason: `No intrabar data (${window.plan.intrabarInterval}) returned for the target window`,
          volumeConfirmationIntrabarInterval: window.plan.intrabarInterval,
          volumeConfirmationIntrabarCount: 0,
        },
      }
    }

    const delta = calculateDeltaVolume({
      targetBars: window.targetBars,
      intrabars: window.intrabars,
      targetInterval: interval,
    })
    const confirmations = new Map<number, PriceActionVolumeConfirmationInput>()
    for (let i = 0; i < window.targetBars.length; i++) {
      confirmations.set(window.targetIndexOffset + i, {
        delta: delta.deltas[i],
        deltaRatio: delta.deltaRatios[i],
        coverage: delta.coverage[i],
        confidence: confidenceForCoverage(delta.coverage[i]),
        intrabarInterval: window.plan.intrabarInterval,
        intrabarCount: window.intrabars.length,
      })
    }

    return {
      confirmations,
      meta: {
        volumeConfirmation: 'available',
        volumeConfirmationCoverageBars: window.targetBars.length,
        volumeConfirmationLowConfidenceBars: delta.lowConfidenceIndices.length,
        volumeConfirmationIntrabarInterval: window.plan.intrabarInterval,
        volumeConfirmationIntrabarCount: window.intrabars.length,
        volumeConfirmationReason: window.plan.degradationReason,
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
