/**
 * Optional keyless read-only data UTAs (binance/okx/bybit-readonly) — verify the
 * opt-in config path constructs them correctly (no API key). Pure construction;
 * no network.
 */
import { describe, it, expect } from 'vitest'
import { createBroker } from './brokers/factory.js'
import { buildKeylessDataUTAs } from './keyless-data-sources.js'
import type { UTAConfig } from '@/core/config.js'

function cfgFor(ex: string): UTAConfig {
  return {
    id: `${ex}-readonly`, label: `${ex} (read-only)`, presetId: 'ccxt-custom',
    enabled: true, guards: [], presetConfig: { exchange: ex },
    keyless: true, readOnly: true, editable: false,
  } as unknown as UTAConfig
}

describe('keyless data UTA injection', () => {
  it('defaults to no keyless data accounts', () => {
    expect(buildKeylessDataUTAs([], new Set())).toEqual([])
  })

  it('builds only the exchanges selected by the user', () => {
    const utas = buildKeylessDataUTAs(['binance', 'okx'], new Set())
    expect(utas.map((u) => u.id)).toEqual(['binance-readonly', 'okx-readonly'])
  })

  it('does not shadow a user-defined account id', () => {
    const utas = buildKeylessDataUTAs(['binance', 'okx'], new Set(['binance-readonly']))
    expect(utas.map((u) => u.id)).toEqual(['okx-readonly'])
  })

  for (const ex of ['binance', 'okx', 'bybit']) {
    it(`${ex}-readonly: constructs a keyless broker (no throw, keyless flag flows)`, () => {
      let broker: unknown
      expect(() => { broker = createBroker(cfgFor(ex)) }).not.toThrow()
      expect((broker as { id: string }).id).toBe(`${ex}-readonly`)
      // keyless must reach the broker (factory → fromConfig → constructor) so
      // init() skips the credential check.
      expect((broker as Record<string, unknown>).keyless).toBe(true)
      // and it declares the historical-bars capability for the federation.
      expect((broker as { getCapabilities(): { historicalBars?: { supported: boolean } } }).getCapabilities().historicalBars?.supported).toBe(true)
    })
  }

  it('reports every contract as crypto (a crypto venue\'s "stock" is synthetic)', () => {
    const broker = createBroker(cfgFor('okx')) as unknown as { assetClassFor(c: unknown): string }
    // Even a "FUT" or a tokenized-equity-looking contract → crypto, by venue.
    expect(broker.assetClassFor({ symbol: 'BTC', secType: 'FUT' })).toBe('crypto')
    expect(broker.assetClassFor({ symbol: 'AAPL', secType: 'STK' })).toBe('crypto')
  })

  it('keyless account-reads return empty without auth (no fetchBalance / no init)', async () => {
    const broker = createBroker(cfgFor('binance')) as unknown as {
      getAccount(): Promise<{ totalCashValue: string; netLiquidation: string }>
      getPositions(): Promise<unknown[]>
      getOrders(ids: string[]): Promise<unknown[]>
    }
    const acct = await broker.getAccount()
    expect(acct.totalCashValue).toBe('0')
    expect(acct.netLiquidation).toBe('0')
    expect(await broker.getPositions()).toEqual([])
    expect(await broker.getOrders([])).toEqual([])
  })
})
