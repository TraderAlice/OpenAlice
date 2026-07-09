import { supportsTradingViewInternalIntrabar } from '@traderalice/opentypebb'
import { parseBarId } from '@/domain/market-data/bars/index'
import { intervalToMinutes } from './interval-time.js'

export const MAX_INTRABAR_BARS = 5000

const INTRABAR_CANDIDATES: Record<string, string[]> = {
  '15m': ['1m', '3m', '5m'],
  '30m': ['1m', '3m', '5m'],
  '1h': ['1m', '3m', '5m', '15m'],
  '4h': ['3m', '5m', '15m', '1h'],
  '1d': ['3m', '5m', '15m', '1h'],
  '1w': ['1h', '4h', '1d'],
}

export interface IntrabarPlan {
  intrabarInterval: string
  intrabarsPerParent: number
  requestedCount: number
  actualCount: number
  maxSupportedCount: number
  requiredIntrabarBars: number
  maxBars: number
  truncated: boolean
  degradationReason?: string
}

function candidatesFor(targetInterval: string, barId: string): string[] {
  const targetMinutes = intervalToMinutes(targetInterval)
  const candidates = INTRABAR_CANDIDATES[targetInterval]
    ?? (targetMinutes == null || targetMinutes <= 15
      ? ['1m', '3m', '5m']
      : targetMinutes <= 30
        ? ['1m', '3m', '5m']
        : targetMinutes <= 60
          ? ['1m', '3m', '5m', '15m']
          : targetMinutes <= 240
            ? ['3m', '5m', '15m', '1h']
            : targetMinutes <= 1440
              ? ['3m', '5m', '15m', '1h']
              : ['1h', '4h', '1d'])
  const sourceId = parseBarId(barId)?.sourceId ?? ''
  return candidates.filter((interval) => interval !== '3m' || supportsTradingViewInternalIntrabar(sourceId, interval))
}

function intrabarsPerParent(parentInterval: string, intrabarInterval: string): number {
  const parentMinutes = intervalToMinutes(parentInterval) ?? 60
  const intrabarMinutes = intervalToMinutes(intrabarInterval) ?? 1
  return Math.max(1, Math.ceil(parentMinutes / intrabarMinutes))
}

export function chooseIntrabarPlan(targetInterval: string, requestedCount: number, barId: string): IntrabarPlan {
  const candidates = candidatesFor(targetInterval, barId)
  const rejected: Array<{ interval: string; required: number }> = []

  for (const intrabarInterval of candidates) {
    const perParent = intrabarsPerParent(targetInterval, intrabarInterval)
    const required = requestedCount * perParent
    if (required <= MAX_INTRABAR_BARS) {
      const degradationReason = rejected.length > 0
        ? `${rejected[0].interval} intrabar would require ${rejected[0].required} bars, exceeding MAX_BARS=${MAX_INTRABAR_BARS}. Auto-selected ${intrabarInterval}.`
        : undefined
      return {
        intrabarInterval,
        intrabarsPerParent: perParent,
        requestedCount,
        actualCount: requestedCount,
        maxSupportedCount: Math.floor(MAX_INTRABAR_BARS / perParent),
        requiredIntrabarBars: required,
        maxBars: MAX_INTRABAR_BARS,
        truncated: false,
        degradationReason,
      }
    }
    rejected.push({ interval: intrabarInterval, required })
  }

  const intrabarInterval = candidates[candidates.length - 1] ?? '1m'
  const perParent = intrabarsPerParent(targetInterval, intrabarInterval)
  const maxSupportedCount = Math.max(1, Math.floor(MAX_INTRABAR_BARS / perParent))
  return {
    intrabarInterval,
    intrabarsPerParent: perParent,
    requestedCount,
    actualCount: maxSupportedCount,
    maxSupportedCount,
    requiredIntrabarBars: maxSupportedCount * perParent,
    maxBars: MAX_INTRABAR_BARS,
    truncated: true,
    degradationReason: `All intrabar candidates would exceed MAX_BARS=${MAX_INTRABAR_BARS}. Auto-selected ${intrabarInterval} and reduced count from ${requestedCount} to ${maxSupportedCount}.`,
  }
}

export function confidenceForCoverage(coverage: number): 'high' | 'usable' | 'low' | 'not_recommended' {
  if (coverage >= 0.98) return 'high'
  if (coverage >= 0.9) return 'usable'
  if (coverage >= 0.7) return 'low'
  return 'not_recommended'
}
