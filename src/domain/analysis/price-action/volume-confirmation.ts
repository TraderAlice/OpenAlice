import { analyzeOrderFlowContext } from '@/domain/analysis/order-flow/context.js'
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
    const analysis = await analyzeOrderFlowContext(barService, {
      barId,
      assetClass: 'assetClass' in ref ? ref.assetClass : undefined,
      interval,
      count: bars.length,
      mode: 'delta',
      targetBars: bars,
    })

    if (analysis.status === 'no_intrabars') {
      return {
        meta: {
          volumeConfirmation: 'unavailable',
          volumeConfirmationReason: analysis.error,
          volumeConfirmationIntrabarInterval: analysis.meta.intrabarInterval,
          volumeConfirmationIntrabarCount: 0,
        },
      }
    }

    if (analysis.status !== 'ok' || !analysis.delta) {
      return {
        meta: {
          volumeConfirmation: 'unavailable',
          volumeConfirmationReason: analysis.error ?? 'Order-flow delta analysis unavailable',
          volumeConfirmationIntrabarInterval: analysis.meta.intrabarInterval,
          volumeConfirmationIntrabarCount: analysis.meta.intrabarCount,
        },
      }
    }

    const confirmations = new Map<number, PriceActionVolumeConfirmationInput>()
    for (let i = 0; i < analysis.delta.bars.length; i++) {
      const bar = analysis.delta.bars[i]
      confirmations.set(analysis.meta.targetIndexOffset + i, {
        delta: bar.delta,
        deltaRatio: bar.deltaRatio,
        coverage: bar.coverage,
        confidence: bar.confidence,
        intrabarInterval: analysis.meta.intrabarInterval,
        intrabarCount: analysis.meta.intrabarCount,
      })
    }

    return {
      confirmations,
      meta: {
        volumeConfirmation: 'available',
        volumeConfirmationCoverageBars: analysis.delta.bars.length,
        volumeConfirmationLowConfidenceBars: analysis.meta.lowConfidenceBars,
        volumeConfirmationIntrabarInterval: analysis.meta.intrabarInterval,
        volumeConfirmationIntrabarCount: analysis.meta.intrabarCount,
        volumeConfirmationReason: analysis.meta.degradationReason as string | undefined,
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
