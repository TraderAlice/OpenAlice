import { describe, it, expect } from 'vitest'
import { RequestBridge } from './request-bridge.js'

/** A bridge with an account subscription started against a no-op client. */
function subscribedBridge(): RequestBridge {
  const bridge = new RequestBridge()
  ;(bridge as unknown as { client_: unknown }).client_ = { reqAccountUpdates: () => {} }
  bridge.startAccountSubscription('DU123')
  return bridge
}

describe('RequestBridge — account cache across accountDownloadEnd batches', () => {
  it('swaps in a full download', () => {
    const bridge = subscribedBridge()
    bridge.updateAccountValue('NetLiquidation', '982701.35', 'USD', 'DU123')
    bridge.updateAccountValue('TotalCashValue', '981249.13', 'USD', 'DU123')
    bridge.accountDownloadEnd('DU123')
    expect(bridge.getAccountCache()?.values.get('NetLiquidation')).toBe('982701.35')
  })

  it('keeps the cache when a later batch ends without balance tags (gateway server reconnect)', () => {
    const bridge = subscribedBridge()
    bridge.updateAccountValue('NetLiquidation', '982701.35', 'USD', 'DU123')
    bridge.updateAccountValue('TotalCashValue', '981249.13', 'USD', 'DU123')
    bridge.accountDownloadEnd('DU123')

    // Partial batch: a delta, then an end marker with no full resend
    bridge.updateAccountValue('BuyingPower', '3900000', 'USD', 'DU123')
    bridge.accountDownloadEnd('DU123')

    const values = bridge.getAccountCache()?.values
    expect(values?.get('NetLiquidation')).toBe('982701.35')
    expect(values?.get('TotalCashValue')).toBe('981249.13')
    expect(values?.get('BuyingPower')).toBe('3900000')
  })

  it('replaces the cache when a later batch is a full download', () => {
    const bridge = subscribedBridge()
    bridge.updateAccountValue('NetLiquidation', '1', 'USD', 'DU123')
    bridge.accountDownloadEnd('DU123')
    bridge.updateAccountValue('NetLiquidation', '2', 'USD', 'DU123')
    bridge.accountDownloadEnd('DU123')
    expect(bridge.getAccountCache()?.values.get('NetLiquidation')).toBe('2')
  })

  it('still resolves the first download even when it is empty', async () => {
    const bridge = subscribedBridge()
    bridge.accountDownloadEnd('DU123')
    await expect(bridge.waitForAccountReady(100)).resolves.toBeUndefined()
  })
})
