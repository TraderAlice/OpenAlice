import { createServer, type Socket } from 'node:net'

import { describe, it, expect, vi } from 'vitest'
import Decimal from 'decimal.js'
import { Connection, Contract, EClient, makeField, makeMsg, NO_VALID_ID, Order, OrderState, TickTypeEnum } from '@traderalice/ibkr'
import { RequestBridge, acceptsCancelStatus } from './request-bridge.js'

function stk(conId: number, symbol: string): Contract {
  const c = new Contract()
  c.conId = conId
  c.symbol = symbol
  c.secType = 'STK'
  c.currency = 'USD'
  return c
}

function pushUpdate(b: RequestBridge, contract: Contract, qty: number, avgCost = '100'): void {
  b.updatePortfolio(contract, new Decimal(qty), '101', String(qty * 101), avgCost, '1', '0', 'DU1')
}

describe('RequestBridge — connection handshake', () => {
  it('still completes the normal serverVersion → nextValidId handshake', async () => {
    const server = createServer((socket) => {
      let stage: 'greeting' | 'start-api' | 'done' = 'greeting'
      socket.on('data', () => {
        if (stage === 'greeting') {
          stage = 'start-api'
          const payload = Buffer.from(`222\0${new Date(0).toISOString()}\0`, 'utf8')
          const header = Buffer.alloc(4)
          header.writeUInt32BE(payload.length)
          socket.write(Buffer.concat([header, payload]))
          return
        }
        if (stage === 'start-api') {
          stage = 'done'
          socket.write(makeMsg(9, true, makeField(1) + makeField(700)))
          socket.write(makeMsg(15, true, makeField(1) + makeField('DU1234567')))
        }
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })

    const bridge = new RequestBridge()
    const client = new EClient(bridge)
    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('test server has no TCP port')
      await expect(bridge.waitForConnect(client, '127.0.0.1', address.port, 19, 1_000))
        .resolves.toBeUndefined()
      expect(client.isConnected()).toBe(true)
      expect(bridge.getNextOrderId()).toBe(700)
      expect(bridge.getAccountId()).toBe('DU1234567')
    } finally {
      client.disconnect()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('contains a server-side handshake close as a normal rejected connect', async () => {
    const originalSendMsg = Connection.prototype.sendMsg
    let handshakeListenersReady = false
    const sendMsg = vi.spyOn(Connection.prototype, 'sendMsg').mockImplementation(function (this: Connection, msg) {
      handshakeListenersReady = this.listenerCount('data') > 0
        && (this.socket?.listenerCount('close') ?? 0) > 1
      return originalSendMsg.call(this, msg)
    })
    const server = createServer((socket) => {
      socket.once('data', () => socket.destroy())
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })

    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('test server has no TCP port')
      const bridge = new RequestBridge()
      const client = new EClient(bridge)

      const startedAt = Date.now()
      await expect(bridge.waitForConnect(client, '127.0.0.1', address.port, 19, 1_000))
        .rejects.toThrow('Connection to TWS/Gateway closed during handshake')
      expect(handshakeListenersReady).toBe(true)
      expect(Date.now() - startedAt).toBeLessThan(1_000)
    } finally {
      sendMsg.mockRestore()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }, 3_000)

  it('tears down a silent handshake when the bridge timeout expires', async () => {
    const sockets = new Set<Socket>()
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
      socket.resume()
      // Accept and consume the greeting, but deliberately never answer.
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })

    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('test server has no TCP port')
      const bridge = new RequestBridge()
      const client = new EClient(bridge)

      const startedAt = Date.now()
      await expect(bridge.waitForConnect(client, '127.0.0.1', address.port, 19, 50))
        .rejects.toThrow('timed out after 50ms')
      expect(Date.now() - startedAt).toBeLessThan(500)
      expect(client.isConnected()).toBe(false)
    } finally {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('RequestBridge — error routing', () => {
  it('routes 10xxx errors into the pending request (no silent timeout)', async () => {
    // Regression: `errorCode >= 2000` swallowed 10089 (market data needs
    // subscription) — the snapshot promise timed out with zero context
    // instead of carrying the venue's actionable message.
    const b = new RequestBridge()
    const promise = b.requestSnapshot(9001, 5000)
    b.error(9001, 0, 10089, 'Requested market data requires additional subscription for API.')
    await expect(promise).rejects.toThrow(/subscription/)
  })

  it('still ignores 21xx farm-status noise', () => {
    const b = new RequestBridge()
    // no pending request — must simply not throw
    expect(() => b.error(-1, 0, 2104, 'Market data farm connection is OK')).not.toThrow()
  })

  it('marks 1100 dead immediately and treats 1102 as a recovery nudge, not proof of life', () => {
    const b = new RequestBridge()
    const events: Array<{ state: string; error?: string }> = []
    b.setConnectionStateListener((event) => events.push(event))

    b.error(NO_VALID_ID, 0, 1100, 'Connectivity between IBKR and TWS has been lost')
    expect(b.connectionDead).toBe(true)
    expect(events.at(-1)).toMatchObject({ state: 'dead' })

    b.error(NO_VALID_ID, 0, 1102, 'Connectivity restored - data maintained')
    expect(b.connectionDead).toBe(true)
    expect(events.at(-1)).toEqual({ state: 'restored' })

    b.markAlive()
    expect(b.connectionDead).toBe(false)
    expect(events.at(-1)).toEqual({ state: 'alive' })
  })
})

describe('RequestBridge — socket probes and snapshots', () => {
  it('gives every current-time probe its own deadline instead of a shared promise', async () => {
    vi.useFakeTimers()
    try {
      const b = new RequestBridge()
      const reqCurrentTime = vi.fn()
      b.setClient({ reqCurrentTime } as never)

      const slow = b.requestCurrentTime(5_000)
      const slowSettled = vi.fn()
      slow.then(slowSettled, slowSettled)
      vi.advanceTimersByTime(4_900)

      // A short write probe started late must NOT inherit the heartbeat's
      // nearly-expired deadline.
      const fast = b.requestCurrentTime(3_000)
      expect(reqCurrentTime).toHaveBeenCalledTimes(2)

      vi.advanceTimersByTime(200)
      await Promise.resolve()
      await expect(slow).rejects.toThrow(/timed out after 5000ms/)

      // The reply owed to the expired heartbeat must not settle the fresh probe.
      b.currentTime(1_784_289_600)
      b.currentTime(1_784_289_601)
      await expect(fast).resolves.toBe(1_784_289_601)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores a late reply when no probe is waiting for it', async () => {
    vi.useFakeTimers()
    try {
      const b = new RequestBridge()
      b.setClient({ reqCurrentTime: vi.fn() } as never)

      const probe = b.requestCurrentTime(3_000)
      const settled = vi.fn()
      probe.then(settled, settled)
      vi.advanceTimersByTime(3_000)
      await expect(probe).rejects.toThrow(/timed out after 3000ms/)

      b.currentTime(1_784_289_600) // late reply for the dead probe

      const next = b.requestCurrentTime(3_000)
      const nextSettled = vi.fn()
      next.then(nextSettled, nextSettled)
      await Promise.resolve()
      expect(nextSettled).not.toHaveBeenCalled()

      b.currentTime(1_784_289_777)
      await expect(next).resolves.toBe(1_784_289_777)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears a failed current-time probe so the next write can retry', async () => {
    const b = new RequestBridge()
    const reqCurrentTime = vi.fn()
      .mockImplementationOnce(() => { throw new Error('socket write failed') })
      .mockImplementationOnce(() => {})
    b.setClient({ reqCurrentTime } as never)

    await expect(b.requestCurrentTime()).rejects.toThrow(/socket write failed/)
    const retry = b.requestCurrentTime()
    b.currentTime(1_784_289_601)

    await expect(retry).resolves.toBe(1_784_289_601)
    expect(reqCurrentTime).toHaveBeenCalledTimes(2)
  })

  it('can resolve option-mark snapshots as soon as both bid and ask arrive', async () => {
    const b = new RequestBridge()
    const snapshot = b.requestSnapshot(71, 5_000, { resolveOnBidAsk: true })

    b.tickPrice(71, TickTypeEnum.BID, 2, {} as never)
    b.tickPrice(71, TickTypeEnum.ASK, 4, {} as never)

    await expect(snapshot).resolves.toMatchObject({ bid: 2, ask: 4 })
  })

  it('keeps ordinary quote snapshots open until tickSnapshotEnd', async () => {
    const b = new RequestBridge()
    let settled = false
    const snapshot = b.requestSnapshot(72, 5_000).then((value) => {
      settled = true
      return value
    })

    b.tickPrice(72, TickTypeEnum.BID, 2, {} as never)
    b.tickPrice(72, TickTypeEnum.ASK, 4, {} as never)
    await Promise.resolve()
    expect(settled).toBe(false)

    b.tickSnapshotEnd(72)
    await expect(snapshot).resolves.toMatchObject({ bid: 2, ask: 4 })
  })
})

/**
 * TWS account-subscription semantics: full download bursts end with
 * accountDownloadEnd; between bursts TWS pushes DELTAS with no end marker
 * (a fill updates one position immediately; the next full download can be
 * ~3 minutes away). The cache used to apply deltas only at the next swap —
 * the ledger said filled while the portfolio surface showed the old
 * quantity for minutes (found live, IBKR round, S8).
 */
describe('RequestBridge — account cache delta semantics', () => {
  function readyBridge(): RequestBridge {
    const b = new RequestBridge()
    ;(b as unknown as { accountCachePending_: unknown }).accountCachePending_ = { positions: [], values: new Map() }
    pushUpdate(b, stk(1, 'AAPL'), 10)
    pushUpdate(b, stk(2, 'TSLA'), 5)
    b.updateAccountValue('TotalCashValue', '1000', 'USD', 'DU1')
    b.accountDownloadEnd('DU1')
    return b
  }

  it('applies a delta update to the live cache immediately (no downloadEnd needed)', () => {
    const b = readyBridge()
    pushUpdate(b, stk(1, 'AAPL'), 9)

    const cache = b.getAccountCache()!
    const aapl = cache.positions.find((p) => p.contract.conId === 1)!
    expect(aapl.quantity.toNumber()).toBe(9)
    expect(cache.positions).toHaveLength(2)
  })

  it('removes a fully-closed position (zero quantity) immediately', () => {
    const b = readyBridge()
    pushUpdate(b, stk(2, 'TSLA'), 0)

    const cache = b.getAccountCache()!
    expect(cache.positions.map((p) => p.contract.conId)).toEqual([1])
  })

  it('applies account-value deltas to the live cache immediately', () => {
    const b = readyBridge()
    b.updateAccountValue('TotalCashValue', '900', 'USD', 'DU1')
    expect(b.getAccountCache()!.values.get('TotalCashValue')).toBe('900')
  })

  it('repeated updates within one batch window do not duplicate rows', () => {
    const b = readyBridge()
    // price-tick churn: same position updated 3x before the next downloadEnd
    pushUpdate(b, stk(1, 'AAPL'), 9)
    pushUpdate(b, stk(1, 'AAPL'), 9)
    pushUpdate(b, stk(2, 'TSLA'), 5)
    b.accountDownloadEnd('DU1')

    const cache = b.getAccountCache()!
    expect(cache.positions).toHaveLength(2)
    expect(cache.positions.find((p) => p.contract.conId === 1)!.quantity.toNumber()).toBe(9)
  })

  it('full-download swap does not resurrect a position closed mid-window', () => {
    const b = readyBridge()
    pushUpdate(b, stk(2, 'TSLA'), 0)        // closed via delta
    pushUpdate(b, stk(1, 'AAPL'), 10)       // next full burst: only AAPL remains
    b.accountDownloadEnd('DU1')

    expect(b.getAccountCache()!.positions.map((p) => p.contract.conId)).toEqual([1])
  })
})

describe('RequestBridge — currency-aware account values (issue #295)', () => {
  function readyBridge(): RequestBridge {
    const b = new RequestBridge()
    ;(b as unknown as { accountCachePending_: unknown }).accountCachePending_ = { positions: [], values: new Map() }
    b.accountDownloadEnd('DU1')
    return b
  }

  it('BASE wins the plain key regardless of arrival order', () => {
    const b = readyBridge()
    b.updateAccountValue('CashBalance', '1036370', 'BASE', 'DU1')
    b.updateAccountValue('CashBalance', '-51005', 'HKD', 'DU1')   // arrives after BASE
    const v = b.getAccountCache()!.values
    expect(v.get('CashBalance')).toBe('1036370')                   // not clobbered
    expect(v.get('CashBalance:HKD')).toBe('-51005')
    expect(v.get('CashBalance:BASE')).toBe('1036370')
  })

  it('BASE arriving late still reclaims the plain key', () => {
    const b = readyBridge()
    b.updateAccountValue('CashBalance', '-51005', 'HKD', 'DU1')    // HKD first
    const v = b.getAccountCache()!.values
    expect(v.get('CashBalance')).toBe('-51005')                    // provisional
    b.updateAccountValue('CashBalance', '1036370', 'BASE', 'DU1')
    expect(v.get('CashBalance')).toBe('1036370')                   // corrected
  })

  it('single-send tags (one currency line, no BASE) keep the plain key', () => {
    const b = readyBridge()
    b.updateAccountValue('NetLiquidation', '1046101.70', 'USD', 'DU1')
    expect(b.getAccountCache()!.values.get('NetLiquidation')).toBe('1046101.70')
    expect(b.getAccountCache()!.values.get('ExchangeRate:USD')).toBeUndefined()
  })
})

describe('RequestBridge — placeOrder Inactive hold', () => {
  function state(status: string): OrderState {
    const os = new OrderState()
    os.status = status
    return os
  }

  it('does not resolve requestOrder on Inactive; error() then carries the venue message', async () => {
    const bridge = new RequestBridge()
    const pending = bridge.requestOrder(19, 1_000)
    bridge.openOrder(19, new Contract(), new Order(), state('Inactive'))

    let settled = false
    void pending.then(() => { settled = true }, () => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    bridge.error(19, 0, 202, 'Order Canceled - reason:')
    await expect(pending).rejects.toThrow(/IBKR error 202.*Order Canceled/)
  })

  it('resolves after a later live openOrder', async () => {
    const bridge = new RequestBridge()
    const pending = bridge.requestOrder(10, 1_000)
    const contract = new Contract()
    const order = new Order()
    bridge.openOrder(10, contract, order, state('Inactive'))
    bridge.openOrder(10, contract, order, state('PreSubmitted'))
    await expect(pending).resolves.toMatchObject({ orderState: { status: 'PreSubmitted' } })
  })

  it('resolves a live orderStatus after skipping Inactive', async () => {
    const bridge = new RequestBridge()
    const pending = bridge.requestOrder(10, 1_000)
    bridge.openOrder(10, new Contract(), new Order(), state('Inactive'))
    bridge.orderStatus(
      10, 'Submitted', new Decimal(0), new Decimal(1),
      0, 0, 0, 0, 0, '', 0,
    )
    await expect(pending).resolves.toMatchObject({ orderState: { status: 'Submitted' } })
  })
})

describe('RequestBridge — order request status gating', () => {
  function state(status: string): OrderState {
    const os = new OrderState()
    os.status = status
    return os
  }

  it('does not complete a cancel request on a live status', async () => {
    const bridge = new RequestBridge()
    const pending = bridge.requestOrder(31, 1_000, acceptsCancelStatus)

    bridge.orderStatus(31, 'Filled', new Decimal(5), new Decimal(0), 101, 0, 0, 0, 0, '', 0)
    let settled = false
    void pending.then(() => { settled = true }, () => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    bridge.orderStatus(31, 'Cancelled', new Decimal(0), new Decimal(5), 0, 0, 0, 0, 0, '', 0)
    await expect(pending).resolves.toMatchObject({ orderState: { status: 'Cancelled' } })
  })

  it('answers with the Inactive hold when no error or live status follows', async () => {
    // TWS marks exchange-closed and precautionary holds Inactive with no
    // error() callback.
    vi.useFakeTimers()
    try {
      const bridge = new RequestBridge()
      const pending = bridge.requestOrder(32, 30_000)
      bridge.openOrder(32, new Contract(), new Order(), state('Inactive'))
      await vi.advanceTimersByTimeAsync(2_000)
      await expect(pending).resolves.toMatchObject({ orderState: { status: 'Inactive' } })
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets a later live status beat the parked Inactive hold', async () => {
    vi.useFakeTimers()
    try {
      const bridge = new RequestBridge()
      const pending = bridge.requestOrder(33, 30_000)
      bridge.openOrder(33, new Contract(), new Order(), state('Inactive'))
      bridge.openOrder(33, new Contract(), new Order(), state('PreSubmitted'))
      await vi.advanceTimersByTimeAsync(2_000)
      await expect(pending).resolves.toMatchObject({ orderState: { status: 'PreSubmitted' } })
    } finally {
      vi.useRealTimers()
    }
  })
})
describe('RequestBridge — order sweep concurrency', () => {
  function collectedOrder(orderId: number): { contract: Contract; order: { orderId: number }; orderState: { status: string } } {
    const contract = new Contract()
    contract.conId = orderId
    return { contract, order: { orderId }, orderState: { status: 'Submitted' } }
  }

  it('joins concurrent open-order sweeps onto one request and gives each caller the full batch', async () => {
    const b = new RequestBridge()
    const reqOpenOrders = vi.fn()
    b.setClient({ reqOpenOrders } as never)

    const first = b.requestOpenOrders(5_000)
    const second = b.requestOpenOrders(5_000)
    expect(reqOpenOrders).toHaveBeenCalledOnce()

    const a = collectedOrder(1)
    const c = collectedOrder(2)
    b.openOrder(1, a.contract, a.order as never, a.orderState as never)
    b.openOrder(2, c.contract, c.order as never, c.orderState as never)
    b.openOrderEnd()

    const [one, two] = await Promise.all([first, second])
    expect(one).toHaveLength(2)
    expect(two).toEqual(one)
  })

  it('joins concurrent completed-order sweeps the same way', async () => {
    const b = new RequestBridge()
    const reqCompletedOrders = vi.fn()
    b.setClient({ reqCompletedOrders } as never)

    const first = b.requestCompletedOrders(5_000)
    const second = b.requestCompletedOrders(5_000)
    expect(reqCompletedOrders).toHaveBeenCalledOnce()

    const done = collectedOrder(3)
    b.completedOrder(done.contract, done.order as never, done.orderState as never)
    b.completedOrdersEnd()

    await expect(Promise.all([first, second])).resolves.toEqual([
      [expect.objectContaining({ orderState: { status: 'Submitted' } })],
      [expect.objectContaining({ orderState: { status: 'Submitted' } })],
    ])
  })

  it('lets one caller time out without clobbering the sweep the others still await', async () => {
    vi.useFakeTimers()
    try {
      const b = new RequestBridge()
      const reqOpenOrders = vi.fn()
      b.setClient({ reqOpenOrders } as never)

      const impatient = b.requestOpenOrders(1_000)
      const impatientSettled = vi.fn()
      impatient.then(impatientSettled, impatientSettled)
      const patient = b.requestOpenOrders(10_000)

      vi.advanceTimersByTime(1_000)
      await expect(impatient).rejects.toThrow(/Open orders request timed out after 1000ms/)

      const a = collectedOrder(1)
      b.openOrder(1, a.contract, a.order as never, a.orderState as never)
      b.openOrderEnd()

      await expect(patient).resolves.toHaveLength(1)
      expect(reqOpenOrders).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('RequestBridge — connect readiness', () => {
  it('waits for managedAccounts as well as nextValidId', async () => {
    const client = { connect: vi.fn(async () => {}), disconnect: vi.fn() }
    const b = new RequestBridge()

    const connected = b.waitForConnect(client as never, '127.0.0.1', 7497, 0, 5_000)
    const settled = vi.fn()
    connected.then(settled, settled)

    b.nextValidId(700)
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    b.managedAccounts('DU1234567')
    await expect(connected).resolves.toBeUndefined()
    expect(b.getAccountId()).toBe('DU1234567')
  })
})

describe('RequestBridge — current-time credit decay', () => {
  it('drops the owed-reply credit when the gateway never answers, so later probes still work', async () => {
    vi.useFakeTimers()
    try {
      const b = new RequestBridge()
      b.setClient({ reqCurrentTime: vi.fn() } as never)

      const dead = b.requestCurrentTime(3_000)
      dead.catch(() => {})
      vi.advanceTimersByTime(3_000)
      await expect(dead).rejects.toThrow(/timed out after 3000ms/)

      // The reply for `dead` never arrives. Past the grace window its credit
      // must be released, or every probe after it starves forever.
      vi.advanceTimersByTime(30_000)

      const next = b.requestCurrentTime(3_000)
      b.currentTime(1_784_289_777)
      await expect(next).resolves.toBe(1_784_289_777)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears owed-reply credits when the connection comes back up', async () => {
    vi.useFakeTimers()
    try {
      const b = new RequestBridge()
      b.setClient({ reqCurrentTime: vi.fn() } as never)

      const dead = b.requestCurrentTime(3_000)
      dead.catch(() => {})
      vi.advanceTimersByTime(3_000)
      await expect(dead).rejects.toThrow(/timed out/)

      b.markAlive()

      const next = b.requestCurrentTime(3_000)
      b.currentTime(1_784_289_888)
      await expect(next).resolves.toBe(1_784_289_888)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('RequestBridge — managedAccounts re-push', () => {
  it('keeps the established account id when TWS re-pushes an empty list', () => {
    const b = new RequestBridge()

    b.managedAccounts('DU1')
    b.managedAccounts('')

    expect(b.getAccountId()).toBe('DU1')
  })
})

describe('RequestBridge — connect readiness (empty account list)', () => {
  it('does not treat an empty managedAccounts list as a usable session', async () => {
    vi.useFakeTimers()
    try {
      const client = { connect: vi.fn(async () => {}), disconnect: vi.fn() }
      const b = new RequestBridge()

      const connected = b.waitForConnect(client as never, '127.0.0.1', 7497, 0, 5_000)
      const settled = vi.fn()
      connected.then(settled, settled)

      b.nextValidId(700)
      b.managedAccounts('')
      await Promise.resolve()
      expect(settled).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(5_000)
      // A retryable NETWORK timeout naming the missing reply, not a
      // non-retryable CONFIG "No account detected" later in init().
      await expect(connected).rejects.toThrow(/no managedAccounts/)
    } finally {
      vi.useRealTimers()
    }
  })
})
