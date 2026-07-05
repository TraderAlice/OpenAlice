import type { FairValueGap, InverseFVG, MarketStructureAnalysis } from './types.js'

export interface ScoringContext {
  currentPrice: number
  volatility: number
  barCount: number
  marketStructure?: MarketStructureAnalysis
}

function normalizedDistance(top: number, bottom: number, context: ScoringContext): number {
  const midPrice = (top + bottom) / 2
  return Math.abs(midPrice - context.currentPrice) / volatilityUnit(context)
}

function volatilityUnit(context: ScoringContext): number {
  return context.volatility > 0 ? context.volatility : Math.max(Math.abs(context.currentPrice) * 0.01, 1)
}

function recencyScore(index: number, barCount: number): number {
  if (barCount <= 1) return 0
  const ageRatio = Math.max(0, Math.min(1, index / (barCount - 1)))
  return ageRatio * 20
}

function hasAlignedRecentBOS(fvg: FairValueGap, marketStructure: MarketStructureAnalysis): boolean {
  return marketStructure.bos
    .filter((bos) => bos.index > fvg.formationIndex)
    .slice(-3)
    .some((bos) => bos.type === fvg.type)
}

export function scoreFVGImportance(fvg: FairValueGap, context: ScoringContext): number {
  let score = 0

  if (!fvg.isFilled) {
    score += 100
  } else if (!fvg.completelyFilled) {
    score += 50
  }

  const distanceVolatility = normalizedDistance(fvg.top, fvg.bottom, context)
  score += Math.max(0, 50 - distanceVolatility * 10)

  const sizeVolatility = fvg.size / volatilityUnit(context)
  score += Math.min(30, sizeVolatility * 10)

  score += recencyScore(fvg.formationIndex, context.barCount)

  if (context.marketStructure && hasAlignedRecentBOS(fvg, context.marketStructure)) {
    score += 20
  }

  return score
}

export function scoreIFVGImportance(ifvg: InverseFVG, context: ScoringContext): number {
  let score = 0

  score += ifvg.engulfingStrength * 30
  score += ifvg.impulseRatio * 20

  const distanceVolatility = normalizedDistance(ifvg.top, ifvg.bottom, context)
  score += Math.max(0, 50 - distanceVolatility * 10)

  score += recencyScore(ifvg.reversalIndex, context.barCount)

  return score
}
