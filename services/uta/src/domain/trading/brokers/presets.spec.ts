/**
 * BROKER_PRESET_CATALOG round-trip tests.
 *
 * For every preset, ensure:
 *   1. A reasonable presetConfig sample passes the preset's zodSchema
 *   2. toEngineConfig(parsed) produces a dict accepted by the target
 *      engine's configSchema
 *   3. isPaper / default isPaper resolves predictably
 *
 * This catches drift between preset declarations and engine schemas
 * (e.g. a preset adding a field the engine doesn't know about).
 */

import { describe, it, expect } from 'vitest'
import {
  BROKER_PRESET_CATALOG,
  getBrokerPreset,
  isPaperPreset,
  deriveUtaId,
  BINANCE_PRESET,
  OKX_PRESET,
  BYBIT_PRESET,
  HYPERLIQUID_PRESET,
  BITGET_PRESET,
  ALPACA_PRESET,
  IBKR_PRESET,
  LONGBRIDGE_PRESET,
  CCXT_CUSTOM_PRESET,
  SIMULATOR_PRESET,
  BUILTIN_BROKER_PRESETS,
} from '@traderalice/uta-protocol'
import { BROKER_ENGINE_REGISTRY } from './registry.js'

// ==================== Sample data per preset ====================

/** Minimal valid presetConfig for each preset id. Use to round-trip through schema + engine. */
const SAMPLE_CONFIGS: Record<string, Record<string, unknown>> = {
  binance:         { mode: 'live', apiKey: 'k', secret: 's' },
  okx:             { mode: 'live', apiKey: 'k', secret: 's', password: 'p' },
  bybit:           { mode: 'live', apiKey: 'k', secret: 's' },
  hyperliquid:     { mode: 'live', walletAddress: '0xabc', privateKey: 'pk' },
  bitget:          { mode: 'live', apiKey: 'k', secret: 's', password: 'p' },
  alpaca:          { mode: 'paper', apiKey: 'k', apiSecret: 's' },
  'ibkr-tws':      { host: '127.0.0.1', port: 7497, clientId: 0 },
  longbridge:      { mode: 'live', appKey: 'k', appSecret: 's', accessToken: 't' },
  'ccxt-custom':   { exchange: 'kucoin', apiKey: 'k', secret: 's' },
  'leverup-monad': {
    mode: 'testnet',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  },
  'mock-simulator': { cash: 50000 },
}

// ==================== Catalog integrity ====================

describe('BROKER_PRESET_CATALOG', () => {
  it('declares unique preset ids', () => {
    const ids = BROKER_PRESET_CATALOG.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every preset id has a sample config in the test fixture', () => {
    for (const preset of BROKER_PRESET_CATALOG) {
      expect(SAMPLE_CONFIGS[preset.id], `missing SAMPLE_CONFIGS["${preset.id}"]`).toBeDefined()
    }
  })

  it('getBrokerPreset throws on unknown id', () => {
    expect(() => getBrokerPreset('does-not-exist')).toThrow(/Unknown broker preset/)
  })
})

// ==================== Per-preset round-trip ====================

describe.each(BROKER_PRESET_CATALOG)('preset $id', (preset) => {
  const sample = SAMPLE_CONFIGS[preset.id]

  it('zodSchema accepts the sample presetConfig', () => {
    expect(() => preset.zodSchema.parse(sample)).not.toThrow()
  })

  it('toEngineConfig output is accepted by the target engine schema', () => {
    const parsed = preset.zodSchema.parse(sample) as Record<string, unknown>
    const engineConfig = preset.toEngineConfig(parsed)
    const engineEntry = BROKER_ENGINE_REGISTRY[preset.engine]
    expect(() => engineEntry.configSchema.parse(engineConfig)).not.toThrow()
  })
})

// ==================== Mode → engine flag translation (the OKX-bug guard) ====================

describe('preset → engine config translation', () => {
  it('Binance mode=demo sets demoTrading=true (unified demo-*.binance.com)', () => {
    const cfg = BINANCE_PRESET.toEngineConfig({ mode: 'demo', apiKey: 'k', secret: 's' })
    expect(cfg.demoTrading).toBe(true)
  })

  it('Binance mode=live sets demoTrading=false, no sandbox (testnet not offered)', () => {
    const cfg = BINANCE_PRESET.toEngineConfig({ mode: 'live', apiKey: 'k', secret: 's' })
    expect(cfg.demoTrading).toBe(false)
    // Binance futures testnet is deprecated and spot-only testnet needs an
    // engine change; the preset exposes only live + demo, never sandbox.
    expect(cfg.sandbox).toBeUndefined()
  })

  it('OKX mode=demo sets sandbox=true (avoids the demoTrading footgun)', () => {
    const cfg = OKX_PRESET.toEngineConfig({ mode: 'demo', apiKey: 'k', secret: 's', password: 'p' })
    expect(cfg.sandbox).toBe(true)
    expect(cfg.demoTrading).toBeUndefined()  // never use the broken switch on OKX
  })

  it('OKX mode=live sets sandbox=false', () => {
    const cfg = OKX_PRESET.toEngineConfig({ mode: 'live', apiKey: 'k', secret: 's', password: 'p' })
    expect(cfg.sandbox).toBe(false)
  })

  it('Bybit mode=testnet sets sandbox=true (separate testnet domain)', () => {
    const cfg = BYBIT_PRESET.toEngineConfig({ mode: 'testnet', apiKey: 'k', secret: 's' })
    expect(cfg.sandbox).toBe(true)
    expect(cfg.demoTrading).toBe(false)
  })

  it('Bybit mode=demo sets demoTrading=true (production URL with simulated header)', () => {
    const cfg = BYBIT_PRESET.toEngineConfig({ mode: 'demo', apiKey: 'k', secret: 's' })
    expect(cfg.sandbox).toBe(false)
    expect(cfg.demoTrading).toBe(true)
  })

  it('Hyperliquid mode=testnet sets sandbox=true', () => {
    const cfg = HYPERLIQUID_PRESET.toEngineConfig({ mode: 'testnet', walletAddress: '0x', privateKey: 'pk' })
    expect(cfg.sandbox).toBe(true)
  })

  it('Bitget mode=demo sets demoTrading=true', () => {
    const cfg = BITGET_PRESET.toEngineConfig({ mode: 'demo', apiKey: 'k', secret: 's', password: 'p' })
    expect(cfg.demoTrading).toBe(true)
  })

  it('Alpaca mode=paper sets paper=true', () => {
    const cfg = ALPACA_PRESET.toEngineConfig({ mode: 'paper', apiKey: 'k', apiSecret: 's' })
    expect(cfg.paper).toBe(true)
  })

  it('Alpaca mode=live sets paper=false', () => {
    const cfg = ALPACA_PRESET.toEngineConfig({ mode: 'live', apiKey: 'k', apiSecret: 's' })
    expect(cfg.paper).toBe(false)
  })

  it('Longbridge mode=paper sets paper=true', () => {
    const cfg = LONGBRIDGE_PRESET.toEngineConfig({ mode: 'paper', appKey: 'k', appSecret: 's', accessToken: 't' })
    expect(cfg.paper).toBe(true)
  })

  it('Longbridge mode=live sets paper=false', () => {
    const cfg = LONGBRIDGE_PRESET.toEngineConfig({ mode: 'live', appKey: 'k', appSecret: 's', accessToken: 't' })
    expect(cfg.paper).toBe(false)
  })

  it('IBKR passes host/port/clientId straight through', () => {
    const cfg = IBKR_PRESET.toEngineConfig({ host: '10.0.0.5', port: 7496, clientId: 7 })
    expect(cfg).toMatchObject({ host: '10.0.0.5', port: 7496, clientId: 7 })
  })

  it('CCXT Custom drops empty/undefined optional fields', () => {
    const cfg = CCXT_CUSTOM_PRESET.toEngineConfig({ exchange: 'kucoin', apiKey: 'k', secret: '', uid: undefined })
    expect(cfg).toEqual({ exchange: 'kucoin', apiKey: 'k' })
  })
})

// ==================== isPaper helper ====================

describe('isPaperPreset', () => {
  it('true for OKX demo, false for OKX live', () => {
    expect(isPaperPreset('okx', { mode: 'demo' })).toBe(true)
    expect(isPaperPreset('okx', { mode: 'live' })).toBe(false)
  })

  it('true for Bybit testnet AND demo, false for live', () => {
    expect(isPaperPreset('bybit', { mode: 'testnet' })).toBe(true)
    expect(isPaperPreset('bybit', { mode: 'demo' })).toBe(true)
    expect(isPaperPreset('bybit', { mode: 'live' })).toBe(false)
  })

  it('true for Binance testnet AND demo, false for live', () => {
    expect(isPaperPreset('binance', { mode: 'testnet' })).toBe(true)
    expect(isPaperPreset('binance', { mode: 'demo' })).toBe(true)
    expect(isPaperPreset('binance', { mode: 'live' })).toBe(false)
  })

  it('true for Alpaca paper, false for Alpaca live', () => {
    expect(isPaperPreset('alpaca', { mode: 'paper' })).toBe(true)
    expect(isPaperPreset('alpaca', { mode: 'live' })).toBe(false)
  })

  it('true for Longbridge paper, false for Longbridge live', () => {
    expect(isPaperPreset('longbridge', { mode: 'paper' })).toBe(true)
    expect(isPaperPreset('longbridge', { mode: 'live' })).toBe(false)
  })

  it('IBKR uses port-based detection (7497 / 4002 → paper)', () => {
    expect(isPaperPreset('ibkr-tws', { port: 7497 })).toBe(true)
    expect(isPaperPreset('ibkr-tws', { port: 4002 })).toBe(true)
    expect(isPaperPreset('ibkr-tws', { port: 7496 })).toBe(false)
    expect(isPaperPreset('ibkr-tws', { port: 4001 })).toBe(false)
  })

  it('CCXT Custom checks sandbox/demoTrading flags', () => {
    expect(isPaperPreset('ccxt-custom', { sandbox: true })).toBe(true)
    expect(isPaperPreset('ccxt-custom', { demoTrading: true })).toBe(true)
    expect(isPaperPreset('ccxt-custom', {})).toBe(false)
  })
})

// ==================== Serialization ====================

describe('BUILTIN_BROKER_PRESETS', () => {
  it('serializes every catalog preset', () => {
    expect(BUILTIN_BROKER_PRESETS.map(p => p.id).sort()).toEqual(BROKER_PRESET_CATALOG.map(p => p.id).sort())
  })

  it('Mode field becomes oneOf with title labels (so the wizard renders human-readable options)', () => {
    const okx = BUILTIN_BROKER_PRESETS.find(p => p.id === 'okx')!
    const props = (okx.schema as { properties: Record<string, { oneOf?: Array<{ const: string; title: string }> }> }).properties
    expect(props.mode.oneOf).toEqual([
      { const: 'live', title: 'Live' },
      { const: 'demo', title: 'Demo Trading' },
    ])
  })

  it('writeOnly markers applied to credential fields', () => {
    const okx = BUILTIN_BROKER_PRESETS.find(p => p.id === 'okx')!
    const props = (okx.schema as { properties: Record<string, { writeOnly?: boolean }> }).properties
    expect(props.apiKey.writeOnly).toBe(true)
    expect(props.secret.writeOnly).toBe(true)
    expect(props.password.writeOnly).toBe(true)
  })
})

// ==================== Derived UTA id ====================

describe('deriveUtaId', () => {
  it('is deterministic — same inputs produce byte-identical id', () => {
    const a = deriveUtaId(OKX_PRESET, { mode: 'live', apiKey: 'k1', secret: 's1', password: 'p1' })
    const b = deriveUtaId(OKX_PRESET, { mode: 'live', apiKey: 'k1', secret: 's1', password: 'p1' })
    expect(a).toBe(b)
  })

  it('matches the documented `${preset.id}-${8hex}` shape', () => {
    const id = deriveUtaId(OKX_PRESET, { mode: 'live', apiKey: 'k1' })
    expect(id).toMatch(/^okx-[0-9a-f]{8}$/)
  })

  it('object-key order does not change the id', () => {
    const a = deriveUtaId(OKX_PRESET, { mode: 'live', apiKey: 'k1', secret: 's1' })
    const b = deriveUtaId(OKX_PRESET, { secret: 's1', apiKey: 'k1', mode: 'live' })
    expect(a).toBe(b)
  })

  it('only fingerprintFields contribute — non-fingerprint fields ignored', () => {
    // OKX fingerprintFields = ['mode', 'apiKey']. password / secret should not affect id.
    const a = deriveUtaId(OKX_PRESET, { mode: 'live', apiKey: 'k', secret: 's1', password: 'p1' })
    const b = deriveUtaId(OKX_PRESET, { mode: 'live', apiKey: 'k', secret: 's2', password: 'p2' })
    expect(a).toBe(b)
  })

  it('different fingerprint values produce different ids', () => {
    const live = deriveUtaId(OKX_PRESET, { mode: 'live', apiKey: 'k1' })
    const demo = deriveUtaId(OKX_PRESET, { mode: 'demo', apiKey: 'k1' })
    expect(live).not.toBe(demo)
  })

  it('different presets with identical fingerprint values still differ (preset id prefixes the hash input)', () => {
    const okx = deriveUtaId(OKX_PRESET, { mode: 'live', apiKey: 'k1' })
    const bybit = deriveUtaId(BYBIT_PRESET, { mode: 'live', apiKey: 'k1' })
    expect(okx).not.toBe(bybit)
    expect(okx.startsWith('okx-')).toBe(true)
    expect(bybit.startsWith('bybit-')).toBe(true)
  })

  it('missing optional fields normalize to null (stable across presence variations)', () => {
    // CCXT Custom fingerprintFields = ['exchange','sandbox','demoTrading','apiKey','walletAddress'].
    // Two configs that differ only on undefined-vs-null for an absent field should match.
    const a = deriveUtaId(CCXT_CUSTOM_PRESET, { exchange: 'kucoin', apiKey: 'k' })
    const b = deriveUtaId(CCXT_CUSTOM_PRESET, { exchange: 'kucoin', apiKey: 'k', walletAddress: undefined })
    expect(a).toBe(b)
  })

  it('Mock derives off _instanceId — random id every freshly-minted sim', () => {
    const a = deriveUtaId(SIMULATOR_PRESET, { _instanceId: 'aaaaaaaa', cash: 100 })
    const b = deriveUtaId(SIMULATOR_PRESET, { _instanceId: 'bbbbbbbb', cash: 100 })
    const same = deriveUtaId(SIMULATOR_PRESET, { _instanceId: 'aaaaaaaa', cash: 999 })
    expect(a).not.toBe(b)
    // Cash isn't a fingerprint field for Mock — same _instanceId gives same id.
    expect(a).toBe(same)
  })
})
