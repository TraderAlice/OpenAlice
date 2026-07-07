import type { OhlcvBar } from '@/domain/market-data/bars/types.js'
import type {
  FairValueGap,
  LiquidityPool,
  LiquiditySweep,
  MarketStructureAnalysis,
  PriceActionSourceRef,
  StructureLevel,
  SwingPoint,
  SwingPointLevels,
  ZoneMitigationSource,
} from './types.js'

export interface LiquiditySweepDetectionParams {
  bars: OhlcvBar[]
  swingPoints: SwingPointLevels
  fvgs: FairValueGap[]
  liquidityPools?: LiquidityPool[]
  currentVolatility?: number
  marketStructure?: MarketStructureAnalysis
  zoneMitigationSource?: ZoneMitigationSource
}

const LEVEL_IMPORTANCE: Record<StructureLevel, number> = {
  external: 3,
  swing: 2,
  internal: 1,
}

function bodyLow(bar: OhlcvBar): number {
  return Math.min(bar.open, bar.close)
}

function bodyHigh(bar: OhlcvBar): number {
  return Math.max(bar.open, bar.close)
}

function penetrationAtr(penetration: number, currentVolatility: number | undefined): number | undefined {
  if (currentVolatility === undefined || currentVolatility <= 0) return undefined
  return Number((penetration / currentVolatility).toFixed(10))
}

function swingId(level: StructureLevel, swing: SwingPoint): string {
  return `${level}-${swing.type}-${swing.index}`
}

function fvgId(fvg: FairValueGap): string {
  return fvg.id ?? `${fvg.kind ?? fvg.variant.toLowerCase()}-${fvg.confirmationIndex}-${fvg.bottom}-${fvg.top}`
}

function fvgTarget(fvg: FairValueGap): PriceActionSourceRef {
  return {
    kind: fvg.kind ?? 'fvg',
    id: fvgId(fvg),
    index: fvg.confirmedAtIndex ?? fvg.confirmationIndex,
    timeframe: fvg.timeframe,
  }
}

function swingTarget(level: StructureLevel, swing: SwingPoint): PriceActionSourceRef {
  return {
    kind: 'swing',
    id: swingId(level, swing),
    index: swing.index,
    level,
  }
}

function poolTarget(pool: LiquidityPool): PriceActionSourceRef {
  return {
    kind: 'liquidity_pool',
    id: pool.id,
    index: pool.lastTouchedAtIndex,
    level: pool.level,
    top: pool.price + pool.tolerance,
    bottom: pool.price - pool.tolerance,
  }
}

function relatedStructureFor(
  marketStructure: MarketStructureAnalysis | undefined,
  level: StructureLevel,
  swing: SwingPoint,
): PriceActionSourceRef | undefined {
  const state = marketStructure?.stateByLevel[level]
  const related =
    swing.type === 'high' ? state?.lastConfirmedHigh : state?.lastConfirmedLow
  if (!related) return undefined

  return swingTarget(level, related)
}

function buildSwingSweep(
  bar: OhlcvBar,
  barIndex: number,
  swing: SwingPoint,
  level: StructureLevel,
  currentVolatility: number | undefined,
  marketStructure: MarketStructureAnalysis | undefined,
): LiquiditySweep | undefined {
  if (barIndex <= swing.index) return undefined

  if (swing.type === 'high') {
    const penetration = bar.high - swing.price
    if (penetration <= 0 || bodyHigh(bar) > swing.price || bar.close > swing.price) return undefined

    return {
      kind: 'swing_sweep',
      direction: 'bearish',
      sweepIndex: barIndex,
      sweptLevel: swing.price,
      wickExtreme: bar.high,
      close: bar.close,
      reclaimSource: 'body',
      reclaimConfirmed: true,
      target: swingTarget(level, swing),
      penetration,
      penetrationAtr: penetrationAtr(penetration, currentVolatility),
      relatedStructure: relatedStructureFor(marketStructure, level, swing),
    }
  }

  const penetration = swing.price - bar.low
  if (penetration <= 0 || bodyLow(bar) < swing.price || bar.close < swing.price) return undefined

  return {
    kind: 'swing_sweep',
    direction: 'bullish',
    sweepIndex: barIndex,
    sweptLevel: swing.price,
    wickExtreme: bar.low,
    close: bar.close,
    reclaimSource: 'body',
    reclaimConfirmed: true,
    target: swingTarget(level, swing),
    penetration,
    penetrationAtr: penetrationAtr(penetration, currentVolatility),
    relatedStructure: relatedStructureFor(marketStructure, level, swing),
  }
}

function buildFvgRaid(
  bar: OhlcvBar,
  barIndex: number,
  fvg: FairValueGap,
  currentVolatility: number | undefined,
): LiquiditySweep | undefined {
  const confirmedAtIndex = fvg.confirmedAtIndex ?? fvg.confirmationIndex
  if (barIndex <= confirmedAtIndex) {
    return undefined
  }

  if (fvg.type === 'bullish') {
    const penetration = fvg.top - bar.low
    if (penetration <= 0 || bodyLow(bar) < fvg.top || bar.close < fvg.top) return undefined

    return {
      kind: 'fvg_raid',
      direction: 'bullish',
      sweepIndex: barIndex,
      sweptLevel: fvg.top,
      wickExtreme: bar.low,
      close: bar.close,
      reclaimSource: 'body',
      reclaimConfirmed: true,
      target: fvgTarget(fvg),
      penetration,
      penetrationAtr: penetrationAtr(penetration, currentVolatility),
    }
  }

  const penetration = bar.high - fvg.bottom
  if (penetration <= 0 || bodyHigh(bar) > fvg.bottom || bar.close > fvg.bottom) return undefined

  return {
    kind: 'fvg_raid',
    direction: 'bearish',
    sweepIndex: barIndex,
    sweptLevel: fvg.bottom,
    wickExtreme: bar.high,
    close: bar.close,
    reclaimSource: 'body',
    reclaimConfirmed: true,
    target: fvgTarget(fvg),
    penetration,
    penetrationAtr: penetrationAtr(penetration, currentVolatility),
  }
}

function buildPoolSweep(
  bar: OhlcvBar,
  barIndex: number,
  pool: LiquidityPool,
  currentVolatility: number | undefined,
): LiquiditySweep | undefined {
  if (barIndex <= pool.lastTouchedAtIndex) return undefined

  if (pool.type === 'EQH') {
    const bandTop = pool.price + pool.tolerance
    const penetration = bar.high - bandTop
    if (penetration <= 0 || bodyHigh(bar) > pool.price || bar.close > pool.price) return undefined

    return {
      kind: 'liquidity_pool_sweep',
      direction: 'bearish',
      sweepIndex: barIndex,
      sweptLevel: pool.price,
      wickExtreme: bar.high,
      close: bar.close,
      reclaimSource: 'body',
      reclaimConfirmed: true,
      target: poolTarget(pool),
      penetration: Number(penetration.toFixed(10)),
      penetrationAtr: penetrationAtr(penetration, currentVolatility),
    }
  }

  const bandBottom = pool.price - pool.tolerance
  const penetration = bandBottom - bar.low
  if (penetration <= 0 || bodyLow(bar) < pool.price || bar.close < pool.price) return undefined

  return {
    kind: 'liquidity_pool_sweep',
    direction: 'bullish',
    sweepIndex: barIndex,
    sweptLevel: pool.price,
    wickExtreme: bar.low,
    close: bar.close,
    reclaimSource: 'body',
    reclaimConfirmed: true,
    target: poolTarget(pool),
    penetration: Number(penetration.toFixed(10)),
    penetrationAtr: penetrationAtr(penetration, currentVolatility),
  }
}

function targetRecency(sweep: LiquiditySweep): number {
  return sweep.target.index ?? -1
}

function targetLevelImportance(sweep: LiquiditySweep): number {
  return sweep.target.level ? LEVEL_IMPORTANCE[sweep.target.level] : 0
}

function isMoreImportant(candidate: LiquiditySweep, current: LiquiditySweep): boolean {
  const candidatePenetration = candidate.penetrationAtr ?? candidate.penetration
  const currentPenetration = current.penetrationAtr ?? current.penetration
  if (candidatePenetration !== currentPenetration) return candidatePenetration > currentPenetration

  const candidateRecency = targetRecency(candidate)
  const currentRecency = targetRecency(current)
  if (candidateRecency !== currentRecency) return candidateRecency > currentRecency

  return targetLevelImportance(candidate) > targetLevelImportance(current)
}

function dedupeSameBarSameKind(sweeps: LiquiditySweep[]): LiquiditySweep[] {
  const bestByKey = new Map<string, LiquiditySweep>()
  for (const sweep of sweeps) {
    const key = `${sweep.sweepIndex}:${sweep.kind}:${sweep.direction}`
    const current = bestByKey.get(key)
    if (!current || isMoreImportant(sweep, current)) {
      bestByKey.set(key, sweep)
    }
  }
  return [...bestByKey.values()]
}

function suppressSwingSweepsCoveredByPool(sweeps: LiquiditySweep[]): LiquiditySweep[] {
  const poolSweeps = sweeps.filter((sweep) => sweep.kind === 'liquidity_pool_sweep')
  if (poolSweeps.length === 0) return sweeps

  return sweeps.filter((sweep) => {
    if (sweep.kind !== 'swing_sweep') return true

    return !poolSweeps.some((poolSweep) => {
      const top = poolSweep.target.top
      const bottom = poolSweep.target.bottom
      if (top === undefined || bottom === undefined) return false

      return sweep.direction === poolSweep.direction
        && sweep.target.level === poolSweep.target.level
        && sweep.sweptLevel >= bottom
        && sweep.sweptLevel <= top
    })
  })
}

function sortedSweeps(sweeps: LiquiditySweep[]): LiquiditySweep[] {
  return [...sweeps].sort((a, b) => {
    if (a.sweepIndex !== b.sweepIndex) return b.sweepIndex - a.sweepIndex

    const penetrationDiff = (b.penetrationAtr ?? b.penetration) - (a.penetrationAtr ?? a.penetration)
    if (penetrationDiff !== 0) return penetrationDiff

    const levelDiff = targetLevelImportance(b) - targetLevelImportance(a)
    if (levelDiff !== 0) return levelDiff

    return targetRecency(b) - targetRecency(a)
  })
}

export function detectLiquiditySweeps(params: LiquiditySweepDetectionParams): LiquiditySweep[] {
  const {
    bars,
    swingPoints,
    fvgs,
    liquidityPools = [],
    currentVolatility,
    marketStructure,
  } = params
  const sweeps: LiquiditySweep[] = []
  const levels: StructureLevel[] = ['internal', 'swing', 'external']

  for (let i = 0; i < bars.length; i++) {
    for (const level of levels) {
      for (const swing of swingPoints[level].highs) {
        const sweep = buildSwingSweep(bars[i], i, swing, level, currentVolatility, marketStructure)
        if (sweep) sweeps.push(sweep)
      }
      for (const swing of swingPoints[level].lows) {
        const sweep = buildSwingSweep(bars[i], i, swing, level, currentVolatility, marketStructure)
        if (sweep) sweeps.push(sweep)
      }
    }

    for (const fvg of fvgs) {
      const sweep = buildFvgRaid(bars[i], i, fvg, currentVolatility)
      if (sweep) sweeps.push(sweep)
    }

    for (const pool of liquidityPools) {
      const sweep = buildPoolSweep(bars[i], i, pool, currentVolatility)
      if (sweep) sweeps.push(sweep)
    }
  }

  return sortedSweeps(suppressSwingSweepsCoveredByPool(dedupeSameBarSameKind(sweeps)))
}
