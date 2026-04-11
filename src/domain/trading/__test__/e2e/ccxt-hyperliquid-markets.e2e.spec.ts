/**
 * CcxtBroker hyperliquid markets loading e2e.
 *
 * Verifies that OpenAlice's CcxtBroker can load ALL hyperliquid market types
 * (spot AND swap), not just the subset that intersects with bybit-style
 * type names (linear/inverse).
 *
 * This test does NOT require real wallet credentials — it uses dummy values
 * that pass checkRequiredCredentials() but never make any private API calls.
 * Hyperliquid's loadMarkets is a public endpoint.
 *
 * Run: pnpm test:e2e
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { CcxtBroker } from '../../brokers/ccxt/CcxtBroker.js'

const DUMMY_WALLET = '0x0000000000000000000000000000000000000001'
const DUMMY_PRIVATE_KEY = '0x' + '0'.repeat(64)

let broker: CcxtBroker | null = null
let initError: unknown = null

beforeAll(async () => {
  try {
    broker = new CcxtBroker({
      id: 'hyperliquid-markets-test',
      exchange: 'hyperliquid',
      sandbox: true, // testnet — sandbox flag is the official ccxt mechanism
      walletAddress: DUMMY_WALLET,
      privateKey: DUMMY_PRIVATE_KEY,
    })
    await broker.init()
  } catch (err) {
    initError = err
    console.warn('hyperliquid markets test: init failed:', err instanceof Error ? err.message : err)
  }
}, 60_000)

describe('CcxtBroker — hyperliquid markets loading', () => {
  it('connects to hyperliquid testnet via sandbox flag', () => {
    expect(initError, `init failed: ${String(initError)}`).toBeNull()
    expect(broker).not.toBeNull()
  })

  it('loads at least 100 markets total', () => {
    if (!broker) return
    const exchange = (broker as unknown as { exchange: { markets: Record<string, unknown> } }).exchange
    const count = Object.keys(exchange.markets).length
    console.log(`  hyperliquid testnet: ${count} markets loaded`)
    expect(count).toBeGreaterThan(100)
  })

  it('loads BOTH spot AND swap market types (regression: was only spot)', () => {
    if (!broker) return
    const exchange = (broker as unknown as { exchange: { markets: Record<string, { type: string }> } }).exchange
    const types = new Set<string>()
    for (const m of Object.values(exchange.markets)) types.add(m.type)
    console.log(`  market types: ${[...types].join(', ')}`)
    expect(types.has('spot'), 'spot markets missing').toBe(true)
    expect(types.has('swap'), 'swap markets missing — fetchMarkets is filtering them out').toBe(true)
  })

  it('can search for a BTC perpetual contract', async () => {
    if (!broker) return
    const results = await broker.searchContracts('BTC')
    expect(results.length).toBeGreaterThan(0)
    // Hyperliquid perp BTC should appear in results
    const btcPerp = results.find(r => {
      const sym = r.contract.symbol ?? ''
      const local = r.contract.localSymbol ?? ''
      return sym === 'BTC' || local.startsWith('BTC')
    })
    expect(btcPerp, `BTC perpetual not found in results: ${results.slice(0, 5).map(r => r.contract.localSymbol).join(', ')}`).toBeDefined()
    if (btcPerp) {
      console.log(`  found BTC perp: localSymbol=${btcPerp.contract.localSymbol}, secType=${btcPerp.contract.secType}`)
    }
  })
})
