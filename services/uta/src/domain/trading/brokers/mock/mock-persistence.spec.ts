import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Decimal from 'decimal.js'
import { Order } from '@traderalice/ibkr'
import { MockBroker, makeContract } from './MockBroker.js'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'mock-restart-'))
  directories.push(directory)
  const stateFile = join(directory, 'mock.json')
  return { stateFile, create: () => new MockBroker({ cash: 10_000, stateFile }) }
}
function order(type: string, quantity: string, price?: string) {
  const order = new Order()
  order.action = 'BUY'
  order.orderType = type
  order.totalQuantity = new Decimal(quantity)
  if (price) order.lmtPrice = new Decimal(price)
  return order
}

describe('configured mock restart', () => {
  it('restores holdings, cash, realized PnL and fills without replaying them', async () => {
    const { create } = fixture()
    const broker = create()
    await broker.init()
    const contract = makeContract()
    broker.setMarkPrice('AAPL', '123.456789')
    const placed = await broker.placeOrder(contract, order('MKT', '3'))
    broker.setMarkPrice('AAPL', '130')
    await broker.closePosition(contract, new Decimal(1))
    const account = await broker.getAccount()
    const positions = await broker.getPositions()
    for (let i = 0; i < 2; i++) {
      const restored = create()
      await restored.init()
      expect(await restored.getAccount()).toEqual(account)
      expect(await restored.getPositions()).toEqual(positions)
      expect((await restored.getOrder(placed.orderId!))?.orderState.status).toBe('Filled')
    }
  })

  it('restores a partially filled order, its Decimal fields and order sequence', async () => {
    const { create } = fixture()
    const broker = create()
    await broker.init()
    broker.setMarkPrice('AAPL', '150')
    const placed = await broker.placeOrder(makeContract(), order('LMT', '3', '100'))
    broker.fillOrder(placed.orderId!, { qty: '1', price: '99' })
    const restored = create()
    await restored.init()
    const pending = await restored.getOrder(placed.orderId!)
    expect(pending?.order.totalQuantity.toString()).toBe('2')
    expect(pending?.order.filledQuantity?.toString()).toBe('1')
    expect(restored.setMarkPrice('AAPL', '98')).toEqual([placed.orderId])
    const again = create()
    await again.init()
    expect((await again.getPositions())[0].quantity.toString()).toBe('3')
    expect((await again.getOrder(placed.orderId!))?.orderState.status).toBe('Filled')
    const next = await again.placeOrder(makeContract(), order('LMT', '1', '50'))
    expect(next.orderId).not.toBe(placed.orderId)
    await again.cancelOrder(next.orderId!)
    const cancelled = create()
    await cancelled.init()
    expect((await cancelled.getOrder(next.orderId!))?.orderState.status).toBe('Cancelled')
  })

  it('persists simulator transfers and contract metadata after selling out', async () => {
    const { create } = fixture()
    const broker = create()
    await broker.init()
    broker.externalDeposit({ nativeKey: 'OPT', quantity: '2', contract: { symbol: 'AAPL', secType: 'OPT', multiplier: '100', strike: 150, right: 'C', lastTradeDateOrContractMonth: '20261218' } })
    broker.externalWithdraw('OPT', '1')
    broker.externalTrade({ nativeKey: 'OPT', side: 'SELL', quantity: '1', price: '2' })
    const restored = create()
    await restored.init()
    expect(restored.getSimulatorState()).toEqual(broker.getSimulatorState())
    expect(restored.resolveNativeKey('OPT').secType).toBe('OPT')
    expect(restored.resolveNativeKey('OPT').multiplier).toBe('100')
  })

  it('refuses corrupt state rather than silently resetting holdings', async () => {
    const { stateFile, create } = fixture()
    writeFileSync(stateFile, '{broken')
    await expect(create().init()).rejects.toThrow()
    writeFileSync(stateFile, JSON.stringify({ version: 99 }))
    await expect(create().init()).rejects.toThrow('Unsupported mock state version')
  })
})
