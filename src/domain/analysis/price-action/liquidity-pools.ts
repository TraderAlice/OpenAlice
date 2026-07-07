import type { LiquidityPool, StructureLevel, SwingPoint, SwingPointLevels } from './types.js'

export interface LiquidityPoolDetectionParams {
  swingPoints: SwingPointLevels
  currentVolatility: number
  liquidityPoolToleranceAtrMultiplier?: number
  liquidityPoolTolerancePctCap?: number
  minLiquidityPoolTouches?: number
  liquidityPoolLevels?: StructureLevel[]
}

const DEFAULT_LEVELS: StructureLevel[] = ['internal', 'swing']

function roundPrice(value: number): number {
  return Number(value.toFixed(10))
}

function averagePrice(touches: SwingPoint[]): number {
  return roundPrice(touches.reduce((sum, touch) => sum + touch.price, 0) / touches.length)
}

function toleranceFor(
  price: number,
  currentVolatility: number,
  atrMultiplier: number,
  pctCap: number,
): number {
  const atrTolerance = Math.max(0, currentVolatility) * atrMultiplier
  if (pctCap === 0) return roundPrice(atrTolerance)

  return roundPrice(Math.min(atrTolerance, Math.abs(price) * pctCap))
}

function poolId(type: LiquidityPool['type'], level: StructureLevel, touches: SwingPoint[]): string {
  return `liquidity-pool-${type}-${level}-${touches.map((touch) => touch.index).join('-')}`
}

function toPool(
  type: LiquidityPool['type'],
  level: StructureLevel,
  touches: SwingPoint[],
  currentVolatility: number,
  atrMultiplier: number,
  pctCap: number,
): LiquidityPool {
  const sortedTouches = [...touches].sort((a, b) => a.index - b.index)
  const price = averagePrice(sortedTouches)
  const tolerance = toleranceFor(sortedTouches[0].price, currentVolatility, atrMultiplier, pctCap)

  return {
    id: poolId(type, level, sortedTouches),
    kind: 'liquidity_pool',
    type,
    direction: type === 'EQH' ? 'bearish' : 'bullish',
    level,
    price,
    tolerance,
    toleranceAtr: currentVolatility > 0 ? roundPrice(tolerance / currentVolatility) : undefined,
    touches: sortedTouches,
    firstTouchedAtIndex: sortedTouches[0].index,
    lastTouchedAtIndex: sortedTouches.at(-1)!.index,
    swept: false,
  }
}

function collectPoolsForTouches(
  type: LiquidityPool['type'],
  level: StructureLevel,
  points: SwingPoint[],
  currentVolatility: number,
  atrMultiplier: number,
  pctCap: number,
  minTouches: number,
): LiquidityPool[] {
  const ordered = [...points].sort((a, b) => a.price - b.price || a.index - b.index)
  const pools: LiquidityPool[] = []
  let cluster: SwingPoint[] = []

  for (const point of ordered) {
    if (cluster.length === 0) {
      cluster = [point]
      continue
    }

    const candidateTouches = [...cluster, point]
    const candidatePrice = averagePrice(candidateTouches)
    const tolerance = toleranceFor(candidatePrice, currentVolatility, atrMultiplier, pctCap)
    const minPrice = Math.min(...candidateTouches.map((touch) => touch.price))
    const maxPrice = Math.max(...candidateTouches.map((touch) => touch.price))

    if (maxPrice - minPrice <= tolerance) {
      cluster = candidateTouches
      continue
    }

    if (cluster.length >= minTouches) {
      pools.push(toPool(type, level, cluster, currentVolatility, atrMultiplier, pctCap))
    }
    cluster = [point]
  }

  if (cluster.length >= minTouches) {
    pools.push(toPool(type, level, cluster, currentVolatility, atrMultiplier, pctCap))
  }

  return pools
}

export function detectLiquidityPools(params: LiquidityPoolDetectionParams): LiquidityPool[] {
  const {
    swingPoints,
    currentVolatility,
    liquidityPoolToleranceAtrMultiplier = 0.1,
    liquidityPoolTolerancePctCap = 0.001,
    minLiquidityPoolTouches = 2,
    liquidityPoolLevels = DEFAULT_LEVELS,
  } = params
  const pools: LiquidityPool[] = []

  if (minLiquidityPoolTouches < 2) return []

  for (const level of liquidityPoolLevels) {
    pools.push(...collectPoolsForTouches(
      'EQH',
      level,
      swingPoints[level].highs,
      currentVolatility,
      liquidityPoolToleranceAtrMultiplier,
      liquidityPoolTolerancePctCap,
      minLiquidityPoolTouches,
    ))
    pools.push(...collectPoolsForTouches(
      'EQL',
      level,
      swingPoints[level].lows,
      currentVolatility,
      liquidityPoolToleranceAtrMultiplier,
      liquidityPoolTolerancePctCap,
      minLiquidityPoolTouches,
    ))
  }

  return pools.sort((a, b) => b.lastTouchedAtIndex - a.lastTouchedAtIndex || b.touches.length - a.touches.length)
}
