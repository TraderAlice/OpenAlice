import type { OhlcvBar } from '../market-data/bars/index.js'
import { analyzeEvidence, semanticFingerprint } from './analysis.js'
import {
  DEFAULT_MARKET_MONITOR_STRATEGY_ID,
  type EvidenceItem,
  type MarketContext,
  type MarketHypothesis,
  type MarketMonitorAsset,
  type MarketMonitorMetrics,
  type MarketMonitorStrategyManifest,
  type SourceHealth,
} from './types.js'

export interface MarketMonitorStrategyInput {
  dailyBars: OhlcvBar[]
  intradayBars: OhlcvBar[]
  abnormalVolumeRatio: number
  abnormalMovePercent: number
}

export interface MarketMonitorStrategyOutput {
  metrics: MarketMonitorMetrics
  evidence: EvidenceItem[]
  hypothesis: MarketHypothesis
}

export interface MarketMonitorFingerprintInput extends MarketMonitorStrategyOutput {
  asset: MarketMonitorAsset
  context: MarketContext
  sourceHealth: SourceHealth[]
}

export interface MarketMonitorStrategy {
  manifest: MarketMonitorStrategyManifest
  analyze(input: MarketMonitorStrategyInput): MarketMonitorStrategyOutput
  fingerprint(input: MarketMonitorFingerprintInput): string
}

export class MarketMonitorStrategyRegistry {
  private readonly byId = new Map<string, MarketMonitorStrategy>()

  constructor(strategies: MarketMonitorStrategy[]) {
    for (const strategy of strategies) {
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(strategy.manifest.id)) {
        throw new Error(`Invalid market monitor strategy id: ${strategy.manifest.id}`)
      }
      if (this.byId.has(strategy.manifest.id)) throw new Error(`Duplicate market monitor strategy: ${strategy.manifest.id}`)
      this.byId.set(strategy.manifest.id, strategy)
    }
    if (!this.byId.size) throw new Error('At least one market monitor strategy is required')
  }

  get(id: string): MarketMonitorStrategy {
    const strategy = this.byId.get(id)
    if (!strategy) throw new Error(`Unknown market monitor strategy: ${id}`)
    return strategy
  }

  has(id: string): boolean {
    return this.byId.has(id)
  }

  list(): MarketMonitorStrategyManifest[] {
    return [...this.byId.values()].map(({ manifest }) => ({ ...manifest, requiredData: [...manifest.requiredData] }))
  }
}

export const evidenceChainV1Strategy: MarketMonitorStrategy = {
  manifest: {
    id: DEFAULT_MARKET_MONITOR_STRATEGY_ID,
    label: 'Evidence chain',
    version: 1,
    description: 'Location, structure, effort/result, weekly follow-through and an independent hourly test.',
    requiredData: ['daily-bars', 'hourly-bars', 'asset-context'],
  },
  analyze: analyzeEvidence,
  fingerprint: semanticFingerprint,
}

export function createMarketMonitorStrategyRegistry(additional: MarketMonitorStrategy[] = []): MarketMonitorStrategyRegistry {
  return new MarketMonitorStrategyRegistry([evidenceChainV1Strategy, ...additional])
}
