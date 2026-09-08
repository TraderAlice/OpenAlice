/**
 * A notional order sets `cashQty` and leaves `totalQuantity` unset, so no
 * sentinel digits may reach the encoded payload.
 */

import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import { EClient } from '../src/client/index.js'
import { Contract } from '../src/contract.js'
import { Order } from '../src/order.js'
import { UNSET_DECIMAL } from '../src/const.js'
import { MAX_CLIENT_VER } from '../src/server-versions.js'
import type { EWrapper } from '../src/wrapper.js'

/** Sentinel as it would reach the wire, in either notation. */
const SENTINEL_DIGITS = '17014118346046923'

class CaptureClient extends EClient {
  readonly sent: string[] = []
  override isConnected(): boolean { return true }
  override serverVersion(): number { return MAX_CLIENT_VER }
  override sendMsg(_msgId: number, msg: string): void { this.sent.push(msg) }
}

function newClient(): CaptureClient {
  const errors: unknown[] = []
  const wrapper = {
    error: (...args: unknown[]) => { errors.push(args) },
  } as unknown as EWrapper
  return new CaptureClient(wrapper)
}

function stockContract(): Contract {
  const contract = new Contract()
  contract.symbol = 'IBIT'
  contract.secType = 'STK'
  contract.exchange = 'SMART'
  contract.currency = 'USD'
  return contract
}

describe('placeOrder — monetary-value order', () => {
  it('sends an empty totalQuantity when only cashQty is set', () => {
    const client = newClient()
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.tif = 'DAY'
    order.cashQty = new Decimal('5000')
    expect(order.totalQuantity.equals(UNSET_DECIMAL)).toBe(true)

    client.placeOrder(1, stockContract(), order)

    expect(client.sent).toHaveLength(1)
    const payload = client.sent[0]!
    // BUY is followed by the totalQuantity field, which must be empty.
    expect(payload).toContain('BUY\0\0')
    expect(payload).toContain('5000\0')
    expect(payload).not.toContain(SENTINEL_DIGITS)
  })

  it('still sends a share quantity when totalQuantity is set', () => {
    const client = newClient()
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.tif = 'DAY'
    order.totalQuantity = new Decimal('15')

    client.placeOrder(1, stockContract(), order)

    const payload = client.sent[0]!
    expect(payload).toContain('BUY\u000015\u0000')
    expect(payload).not.toContain(SENTINEL_DIGITS)
  })

  it('keeps fractional share quantities exact', () => {
    const client = newClient()
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal('0.00000001')

    client.placeOrder(1, stockContract(), order)

    const payload = client.sent[0]!
    expect(payload).toContain('0.00000001\0')
    expect(payload).not.toContain('1e-8')
  })
})
