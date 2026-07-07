import type {
  MarketStructureAnalysis,
  PremiumDiscountContext,
  PremiumDiscountLocation,
  PremiumDiscountZoneAnnotation,
  PremiumDiscountZoneLocation,
  StructureLevel,
  SwingPoint,
} from './types.js'

const DEFAULT_STRUCTURE_LEVEL: StructureLevel = 'swing'
const DEFAULT_EQUILIBRIUM_BAND_PCT = 0.05

export interface CalculatePremiumDiscountContextParams {
  marketStructure: MarketStructureAnalysis
  currentPrice: number
  level?: StructureLevel
  equilibriumBandPct?: number
}

export interface ZonePriceRange {
  top: number
  bottom: number
}

export function calculatePremiumDiscountContext(params: CalculatePremiumDiscountContextParams): PremiumDiscountContext {
  const level = params.level ?? DEFAULT_STRUCTURE_LEVEL
  const equilibriumBandPct = params.equilibriumBandPct ?? DEFAULT_EQUILIBRIUM_BAND_PCT
  const state = params.marketStructure.stateByLevel[level]
  const high = state.lastConfirmedHigh
  const low = state.lastConfirmedLow

  if (!high || !low || high.price === low.price) {
    return { status: 'unavailable', reason: 'missing_range' }
  }

  const normalized = normalizeRange(high, low)
  const midpoint = (normalized.high.price + normalized.low.price) / 2
  const bandHalfSize = Math.abs(normalized.high.price - normalized.low.price) * equilibriumBandPct
  const equilibrium = {
    bottom: midpoint - bandHalfSize,
    top: midpoint + bandHalfSize,
  }

  return {
    status: 'available',
    range: {
      high: normalized.high,
      low: normalized.low,
      midpoint,
      equilibrium,
    },
    currentPrice: params.currentPrice,
    location: classifyPrice(params.currentPrice, equilibrium),
    equilibriumBandPct,
  }
}

export function annotateZoneWithPremiumDiscount(
  zone: ZonePriceRange,
  context: PremiumDiscountContext,
): PremiumDiscountZoneAnnotation | undefined {
  if (context.status !== 'available') return undefined

  const top = Math.max(zone.top, zone.bottom)
  const bottom = Math.min(zone.top, zone.bottom)
  const size = top - bottom
  const midpointLocation = classifyPrice((top + bottom) / 2, context.range.equilibrium)

  if (size <= 0) {
    return {
      location: midpointLocation,
      midpointLocation,
      coverage: coverageForLocation(midpointLocation),
    }
  }

  const discount = segmentCoverage(bottom, top, Number.NEGATIVE_INFINITY, context.range.equilibrium.bottom)
  const equilibrium = segmentCoverage(bottom, top, context.range.equilibrium.bottom, context.range.equilibrium.top)
  const premium = segmentCoverage(bottom, top, context.range.equilibrium.top, Number.POSITIVE_INFINITY)
  const coverage = {
    premium: roundCoverage(premium / size),
    discount: roundCoverage(discount / size),
    equilibrium: roundCoverage(equilibrium / size),
  }

  return {
    location: locationFromCoverage(coverage),
    midpointLocation,
    coverage,
  }
}

export function annotateZonesWithPremiumDiscount<T extends ZonePriceRange>(
  zones: T[],
  context: PremiumDiscountContext,
): T[] {
  const annotation = (zone: T) => annotateZoneWithPremiumDiscount(zone, context)
  return zones.map((zone) => {
    const premiumDiscount = annotation(zone)
    return premiumDiscount ? { ...zone, premiumDiscount } : zone
  })
}

function normalizeRange(high: SwingPoint, low: SwingPoint): { high: SwingPoint; low: SwingPoint } {
  if (high.price > low.price) return { high, low }
  return {
    high: { ...low, type: 'high' },
    low: { ...high, type: 'low' },
  }
}

function classifyPrice(
  price: number,
  equilibrium: { bottom: number; top: number },
): PremiumDiscountLocation {
  if (price > equilibrium.top) return 'premium'
  if (price < equilibrium.bottom) return 'discount'
  return 'equilibrium'
}

function segmentCoverage(zoneBottom: number, zoneTop: number, segmentBottom: number, segmentTop: number): number {
  const bottom = Math.max(zoneBottom, segmentBottom)
  const top = Math.min(zoneTop, segmentTop)
  return Math.max(0, top - bottom)
}

function roundCoverage(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function coverageForLocation(location: PremiumDiscountLocation): PremiumDiscountZoneAnnotation['coverage'] {
  return {
    premium: location === 'premium' ? 1 : 0,
    discount: location === 'discount' ? 1 : 0,
    equilibrium: location === 'equilibrium' ? 1 : 0,
  }
}

function locationFromCoverage(coverage: PremiumDiscountZoneAnnotation['coverage']): PremiumDiscountZoneLocation {
  const nonZeroLocations = [
    coverage.premium > 0 ? 'premium' : undefined,
    coverage.discount > 0 ? 'discount' : undefined,
    coverage.equilibrium > 0 ? 'equilibrium' : undefined,
  ].filter((location): location is PremiumDiscountLocation => location !== undefined)

  return nonZeroLocations.length === 1 ? nonZeroLocations[0] : 'spanning'
}
