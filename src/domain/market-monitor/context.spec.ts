import { describe, expect, it, vi } from 'vitest'
import { MarketContextProviderRegistry } from './context.js'

describe('market context provider registry', () => {
  it('allows multiple independent providers for one asset', () => {
    const providers = [
      { manifest: { id: 'btc-a', label: 'A', assets: ['BTC'] as const, description: 'A' }, load: vi.fn() },
      { manifest: { id: 'btc-b', label: 'B', assets: ['BTC'] as const, description: 'B' }, load: vi.fn() },
    ]
    const registry = new MarketContextProviderRegistry(providers.map((provider) => ({ ...provider, manifest: { ...provider.manifest, assets: [...provider.manifest.assets] } })))
    expect(registry.forAsset('BTC').map((provider) => provider.manifest.id)).toEqual(['btc-a', 'btc-b'])
  })

  it('rejects duplicate module identities and uncovered assets', () => {
    const provider = { manifest: { id: 'same', label: 'Same', assets: ['BTC'] as const, description: 'fixture' }, load: vi.fn() }
    expect(() => new MarketContextProviderRegistry([
      { ...provider, manifest: { ...provider.manifest, assets: [...provider.manifest.assets] } },
      { ...provider, manifest: { ...provider.manifest, assets: [...provider.manifest.assets] } },
    ])).toThrow(/Duplicate market context provider/)
    const registry = new MarketContextProviderRegistry([{ ...provider, manifest: { ...provider.manifest, assets: [...provider.manifest.assets] } }])
    expect(() => registry.forAsset('TSLA')).toThrow(/No market context provider/)
  })

  it('rejects ids that cannot be used as stable module identities', () => {
    expect(() => new MarketContextProviderRegistry([{
      manifest: { id: 'bad/provider', label: 'Bad', assets: ['BTC'], description: 'fixture' },
      load: vi.fn(),
    }])).toThrow(/Invalid market context provider id/)
  })
})
