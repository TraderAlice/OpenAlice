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
  OKX_PRESET,
  BYBIT_PRESET,
  HYPERLIQUID_PRESET,
  BITGET_PRESET,
  ALPACA_PRESET,
  IBKR_PRESET,
  CCXT_CUSTOM_PRESET,
} from './preset-catalog.js'
import { BROKER_ENGINE_REGISTRY } from './registry.js'
import { BUILTIN_BROKER_PRESETS } from './presets.js'

// ==================== Sample data per preset ====================

/** Minimal valid presetConfig for each preset id. Use to round-trip through schema + engine. */
const SAMPLE_CONFIGS: Record<string, Record<string, unknown>> = {
  okx:           { mode: 'live', apiKey: 'k', secret: 's', password: 'p' },
  bybit:         { mode: 'live', apiKey: 'k', secret: 's' },
  hyperliquid:   { mode: 'live', walletAddress: '0xabc', privateKey: 'pk' },
  bitget:        { mode: 'live', apiKey: 'k', secret: 's', password: 'p' },
  alpaca:        { mode: 'paper', apiKey: 'k', apiSecret: 's' },
  'ibkr-tws':    { host: '127.0.0.1', port: 7497, clientId: 0 },
  'ccxt-custom': { exchange: 'kucoin', apiKey: 'k', secret: 's' },
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

  it('true for Alpaca paper, false for Alpaca live', () => {
    expect(isPaperPreset('alpaca', { mode: 'paper' })).toBe(true)
    expect(isPaperPreset('alpaca', { mode: 'live' })).toBe(false)
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
