import type { BarService, BarSourceRef, GetBarsOpts } from '@/domain/market-data/bars/index.js'
import type { OhlcvBar } from '@/domain/market-data/bars/types.js'
import { calculatePriceActionVolatility } from './indicators.js'
import { buildPriceActionVolumeConfirmations } from './volume-confirmation.js'
import { analyzePriceActionBars, type AnalyzePriceActionBarsOptions, type PriceActionAnalysisResult } from './analyze.js'
import type {
  MarketStructureAnalysis,
  PriceActionDetailRequest,
  PriceActionMeta,
  PriceActionMtfAnalysis,
  PriceActionMtfIntervalSummary,
  PriceActionMtfSummary,
  StructureBreakEvent,
  TrendDirection,
} from './types.js'

export type PriceActionContextMode = 'context' | 'execution' | 'debug'

export interface PriceActionSourceRequest {
  barId: string
  assetClass?: 'equity' | 'crypto' | 'currency' | 'commodity'
}

export interface AnalyzePriceActionRuntimeParams extends PriceActionSourceRequest {
  interval: string
  count?: number
  start?: string
  end?: string
  options?: AnalyzePriceActionBarsOptions
}

export interface AnalyzePriceActionMtfParams extends PriceActionSourceRequest {
  intervals: string[]
  count?: number
  start?: string
  end?: string
  options?: AnalyzePriceActionBarsOptions
  defaults: PriceActionAnalyzeDefaults
  detailBaseArgs?: Record<string, unknown>
}

export interface AnalyzePriceActionContextParams extends PriceActionSourceRequest {
  intervals?: string[]
  count?: number
  start?: string
  end?: string
  mode?: PriceActionContextMode
}

export type PriceActionAnalyzeDefaults = Pick<
  AnalyzePriceActionBarsOptions,
  'gapVolumeConfirmation' | 'ifvgVolumeConfirmation' | 'orderBlockVolumeConfirmation' | 'maxFVGs' | 'maxIFVGs' | 'maxOrderBlocks'
>

export function buildAnalyzeOptions(
  input: AnalyzePriceActionBarsOptions = {},
  defaults: PriceActionAnalyzeDefaults,
): AnalyzePriceActionBarsOptions {
  return {
    ...input,
    gapMode: input.gapMode ?? 'FVG',
    zoneMitigationSource: input.zoneMitigationSource ?? 'body',
    gapVolumeConfirmation: input.gapVolumeConfirmation ?? defaults.gapVolumeConfirmation,
    maxFVGs: input.maxFVGs ?? defaults.maxFVGs,
    maxIFVGs: input.maxIFVGs ?? defaults.maxIFVGs,
    includeFilled: input.includeFilled ?? false,
    ifvgVolumeConfirmation: input.ifvgVolumeConfirmation ?? defaults.ifvgVolumeConfirmation,
    maxOrderBlocks: input.maxOrderBlocks ?? defaults.maxOrderBlocks,
    includeMitigatedOrderBlocks: input.includeMitigatedOrderBlocks ?? false,
    orderBlockTrigger: input.orderBlockTrigger ?? 'all',
    orderBlockPosition: input.orderBlockPosition ?? 'precise',
    orderBlockVolumeConfirmation: input.orderBlockVolumeConfirmation ?? defaults.orderBlockVolumeConfirmation,
  }
}

export function priceActionContextDefaults(mode: PriceActionContextMode = 'context'): {
  intervals: string[]
  defaults: PriceActionAnalyzeDefaults
  options: AnalyzePriceActionBarsOptions
} {
  if (mode === 'execution') {
    return {
      intervals: ['4h', '1h', '15m'],
      defaults: {
        gapVolumeConfirmation: true,
        ifvgVolumeConfirmation: true,
        orderBlockVolumeConfirmation: true,
        maxFVGs: 6,
        maxIFVGs: 4,
        maxOrderBlocks: 6,
      },
      options: {
        proximityPct: 0.05,
      },
    }
  }

  if (mode === 'debug') {
    return {
      intervals: ['1d', '4h', '1h'],
      defaults: {
        gapVolumeConfirmation: true,
        ifvgVolumeConfirmation: true,
        orderBlockVolumeConfirmation: true,
        maxFVGs: 10,
        maxIFVGs: 5,
        maxOrderBlocks: 10,
      },
      options: {},
    }
  }

  return {
    intervals: ['1d', '4h', '1h'],
    defaults: {
      gapVolumeConfirmation: false,
      ifvgVolumeConfirmation: false,
      orderBlockVolumeConfirmation: false,
      maxFVGs: 5,
      maxIFVGs: 3,
      maxOrderBlocks: 5,
    },
    options: {},
  }
}

function sourceRef(source: PriceActionSourceRequest): BarSourceRef {
  return source.assetClass ? { barId: source.barId, assetClass: source.assetClass } : { barId: source.barId }
}

function latestBreak(marketStructure: MarketStructureAnalysis): StructureBreakEvent | undefined {
  return [...marketStructure.bos, ...marketStructure.choch].sort((a, b) => b.index - a.index)[0]
}

function dominantTrend(marketStructure: MarketStructureAnalysis): TrendDirection {
  const trends = [
    marketStructure.stateByLevel.external.trend,
    marketStructure.stateByLevel.swing.trend,
    marketStructure.stateByLevel.internal.trend,
  ]
  const bullish = trends.filter((trend) => trend === 'bullish').length
  const bearish = trends.filter((trend) => trend === 'bearish').length
  if (bullish > bearish) return 'bullish'
  if (bearish > bullish) return 'bearish'
  return 'unknown'
}

function distanceFromCurrentPrice(zone: { top: number; bottom: number }, currentPrice: number): number {
  return Math.abs(((zone.top + zone.bottom) / 2) - currentPrice)
}

function nearestByPrice<T extends { top: number; bottom: number }>(zones: T[], currentPrice: number): T | undefined {
  return zones
    .map((zone) => ({ zone, distance: distanceFromCurrentPrice(zone, currentPrice) }))
    .sort((a, b) => a.distance - b.distance)[0]?.zone
}

function buildDetailRequest(args: Record<string, unknown>, interval: string): PriceActionDetailRequest {
  return {
    tool: 'analyzePriceAction',
    args: {
      ...args,
      interval,
    } as PriceActionDetailRequest['args'],
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function emptyIntervalMeta(bars: OhlcvBar[], meta: object): PriceActionMeta {
  return {
    ...meta,
    schemaVersion: 2 as const,
    volatility: calculatePriceActionVolatility(bars),
    totalFvgCount: 0,
    returnedFvgCount: 0,
    totalIfvgCount: 0,
    returnedIfvgCount: 0,
    totalBreakerCount: 0,
    returnedBreakerCount: 0,
    totalOrderBlockCount: 0,
    returnedOrderBlockCount: 0,
    mitigatedOrderBlockCount: 0,
    bosCount: 0,
    chochCount: 0,
  }
}

export function summarizePriceActionMtf(intervals: PriceActionMtfIntervalSummary[]): PriceActionMtfSummary {
  const successful = intervals.filter((entry) => entry.status === 'ok' && entry.trend)
  if (successful.length === 0) {
    return {
      bias: 'unknown',
      alignment: 'unknown',
      conflicts: [],
      confluences: [],
    }
  }

  const trendCounts = successful.reduce<Record<TrendDirection, number>>((counts, entry) => {
    const trend = entry.trend?.dominant ?? 'unknown'
    counts[trend] += 1
    return counts
  }, { bullish: 0, bearish: 0, unknown: 0 })
  const higherTimeframeTrend = successful.find((entry) => entry.trend?.dominant !== 'unknown')?.trend?.dominant
  const bias: PriceActionMtfSummary['bias'] =
    higherTimeframeTrend && higherTimeframeTrend !== 'unknown'
      ? higherTimeframeTrend
      : trendCounts.bullish > trendCounts.bearish
        ? 'bullish'
        : trendCounts.bearish > trendCounts.bullish
          ? 'bearish'
          : trendCounts.bullish === 0 && trendCounts.bearish === 0
            ? 'neutral'
            : 'mixed'

  const conflicts: string[] = []
  const confluences: string[] = []
  for (let i = 0; i < successful.length; i += 1) {
    for (let j = i + 1; j < successful.length; j += 1) {
      const left = successful[i]
      const right = successful[j]
      const leftTrend = left.trend?.swing ?? 'unknown'
      const rightTrend = right.trend?.swing ?? 'unknown'
      if (leftTrend === 'unknown' || rightTrend === 'unknown') continue
      if (leftTrend === rightTrend) {
        confluences.push(`${left.interval} and ${right.interval} swing trend both ${leftTrend}`)
      } else {
        conflicts.push(`${left.interval} swing trend ${leftTrend} conflicts with ${right.interval} swing trend ${rightTrend}`)
      }
    }
  }

  const premiumDiscountConfluences = successful
    .filter((entry) => entry.premiumDiscount?.status === 'available')
    .map((entry) => `${entry.interval} price is in ${entry.premiumDiscount?.status === 'available' ? entry.premiumDiscount.location : 'unknown'}`)
  confluences.push(...premiumDiscountConfluences)

  const alignment: PriceActionMtfSummary['alignment'] =
    conflicts.length > 0
      ? 'conflicted'
      : confluences.length > 0 && (trendCounts.bullish > 0 || trendCounts.bearish > 0)
        ? 'aligned'
        : successful.length > 1
          ? 'mixed'
          : 'unknown'

  return {
    bias,
    alignment,
    conflicts,
    confluences,
  }
}

export async function analyzePriceActionFromBars(
  barService: BarService,
  params: AnalyzePriceActionRuntimeParams,
): Promise<PriceActionAnalysisResult> {
  const ref = sourceRef(params)
  const opts: GetBarsOpts = {
    interval: params.interval,
    count: params.count ?? 200,
    start: params.start,
    end: params.end,
  }
  const result = await barService.getBars(ref, opts)
  return analyzeLoadedPriceActionBars(barService, ref, params, result.bars, result.meta)
}

async function analyzeLoadedPriceActionBars(
  barService: BarService,
  ref: BarSourceRef,
  params: AnalyzePriceActionRuntimeParams,
  bars: OhlcvBar[],
  meta: object,
): Promise<PriceActionAnalysisResult> {
  const options = params.options ?? {}

  const volumeConfirmation = bars.length > 0
    ? await buildPriceActionVolumeConfirmations({
      barService,
      ref,
      barId: params.barId,
      interval: params.interval,
      bars,
      enabled: Boolean(
        options.gapVolumeConfirmation ||
        options.ifvgVolumeConfirmation ||
        options.orderBlockVolumeConfirmation,
      ),
    })
    : { confirmations: undefined, meta: {} }

  return analyzePriceActionBars({
    bars,
    interval: params.interval,
    meta,
    options,
    volumeConfirmations: volumeConfirmation.confirmations,
    volumeConfirmationMeta: volumeConfirmation.meta,
  })
}

export async function analyzePriceActionMtf(
  barService: BarService,
  params: AnalyzePriceActionMtfParams,
): Promise<PriceActionMtfAnalysis> {
  const analysisOptions = buildAnalyzeOptions(params.options, params.defaults)
  const ref = sourceRef(params)
  const baseDetailArgs = params.detailBaseArgs ?? {
    barId: params.barId,
    ...(params.assetClass ? { assetClass: params.assetClass } : {}),
    count: params.count,
    start: params.start,
    end: params.end,
    ...analysisOptions,
  }

  const intervalResults = await Promise.all(params.intervals.map(async (interval): Promise<PriceActionMtfIntervalSummary> => {
    const detailRequest = buildDetailRequest(baseDetailArgs, interval)

    try {
      const result = await barService.getBars(ref, { interval, count: params.count ?? 200, start: params.start, end: params.end })
      if (result.bars.length < 3) {
        return {
          interval,
          status: 'insufficient',
          detailRequest,
          error: 'Insufficient bars returned for price-action summary',
          meta: emptyIntervalMeta(result.bars, result.meta),
        }
      }

      const detail = await analyzeLoadedPriceActionBars(barService, ref, {
        barId: params.barId,
        assetClass: params.assetClass,
        interval,
        count: params.count,
        start: params.start,
        end: params.end,
        options: analysisOptions,
      }, result.bars, result.meta)
      const { marketStructure, liquidityPools, liquiditySweeps, fvgs, ifvgs, orderBlocks, premiumDiscount } = detail
      const currentPrice = result.bars[result.bars.length - 1].close

      return {
        interval,
        status: 'ok',
        trend: {
          internal: marketStructure.stateByLevel.internal.trend,
          swing: marketStructure.stateByLevel.swing.trend,
          external: marketStructure.stateByLevel.external.trend,
          dominant: dominantTrend(marketStructure),
        },
        liquidity: {
          poolCount: liquidityPools.length,
          sweepCount: liquiditySweeps.length,
          recentSweeps: liquiditySweeps.slice(0, 3),
        },
        zone: {
          fvgCount: fvgs.length,
          ifvgCount: ifvgs.length,
          orderBlockCount: orderBlocks.length,
          nearestFvg: nearestByPrice(fvgs, currentPrice),
          nearestIFVG: nearestByPrice(ifvgs, currentPrice),
          nearestOrderBlock: nearestByPrice(orderBlocks, currentPrice),
        },
        premiumDiscount,
        structure: {
          mode: marketStructure.marketStructureMode,
          bosCount: marketStructure.bos.length,
          chochCount: marketStructure.choch.length,
          lastBreak: latestBreak(marketStructure),
          strongWeak: marketStructure.swingStrength.slice(-6),
        },
        detailRequest,
        meta: {
          ...detail.meta,
          returnedBreakerCount: detail.meta.totalBreakerCount,
        },
      }
    } catch (error) {
      return {
        interval,
        status: 'error',
        detailRequest,
        error: errorMessage(error),
      }
    }
  }))

  const successfulCount = intervalResults.filter((entry) => entry.status === 'ok').length
  const errorCount = intervalResults.filter((entry) => entry.status === 'error').length
  const status: PriceActionMtfAnalysis['status'] =
    successfulCount === intervalResults.length
      ? 'ok'
      : errorCount === intervalResults.length
        ? 'error'
        : 'partial'

  return {
    status,
    summary: summarizePriceActionMtf(intervalResults),
    intervals: intervalResults,
    ...(status === 'error' ? { error: 'All intervals failed' } : {}),
  }
}

export async function analyzePriceActionContext(
  barService: BarService,
  params: AnalyzePriceActionContextParams,
): Promise<PriceActionMtfAnalysis> {
  const mode = params.mode ?? 'context'
  const preset = priceActionContextDefaults(mode)
  const detailOptions = buildAnalyzeOptions(preset.options, preset.defaults)
  return analyzePriceActionMtf(barService, {
    barId: params.barId,
    assetClass: params.assetClass,
    intervals: params.intervals ?? preset.intervals,
    count: params.count,
    start: params.start,
    end: params.end,
    options: preset.options,
    defaults: preset.defaults,
    detailBaseArgs: {
      barId: params.barId,
      ...(params.assetClass ? { assetClass: params.assetClass } : {}),
      ...(params.count !== undefined ? { count: params.count } : {}),
      ...(params.start !== undefined ? { start: params.start } : {}),
      ...(params.end !== undefined ? { end: params.end } : {}),
      ...detailOptions,
    },
  })
}
