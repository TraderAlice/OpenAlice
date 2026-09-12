import { describe, expect, it } from 'vitest'
import { MarketMonitorStrategyRegistry, evidenceChainV1Strategy } from './strategy.js'

describe('market monitor strategy registry', () => {
  it('rejects duplicate identities and protects manifest arrays from mutation', () => {
    expect(() => new MarketMonitorStrategyRegistry([evidenceChainV1Strategy, evidenceChainV1Strategy])).toThrow(/Duplicate/)
    const registry = new MarketMonitorStrategyRegistry([evidenceChainV1Strategy])
    const listed = registry.list()
    listed[0]!.requiredData.length = 0
    expect(registry.get('evidence-chain-v1').manifest.requiredData).toHaveLength(3)
  })

  it('rejects an unknown strategy instead of silently falling back', () => {
    const registry = new MarketMonitorStrategyRegistry([evidenceChainV1Strategy])
    expect(() => registry.get('unknown')).toThrow(/Unknown market monitor strategy/)
  })

  it('rejects ids that cannot be used as stable persistence keys', () => {
    expect(() => new MarketMonitorStrategyRegistry([{
      ...evidenceChainV1Strategy,
      manifest: { ...evidenceChainV1Strategy.manifest, id: 'bad/strategy' },
    }])).toThrow(/Invalid market monitor strategy id/)
  })
})
