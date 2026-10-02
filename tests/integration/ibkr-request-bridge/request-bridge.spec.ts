import { createServer, type Socket } from 'node:net'

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import Decimal from 'decimal.js'
import { Connection, Contract, EClient, makeField, makeMsg, NO_VALID_ID, TickTypeEnum } from '@traderalice/ibkr'
import { RequestBridge } from '../../../services/uta/src/domain/trading/brokers/ibkr/request-bridge.js'

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

  it('lets a superseding connect finish while the superseded attempt only closes its own socket', async () => {
    // Recovery can start a new connect on the shared EClient while the previous
    // attempt is still opening its socket (seen when IB Gateway restarts). The
    // stale attempt must neither tear down its successor nor leave a rejected
    // handshake unobserved, which Node treats as fatal and kills the UTA process.
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)

    const sockets = new Set<Socket>()
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
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

      const superseded = bridge.waitForConnect(client, '127.0.0.1', address.port, 19, 1_000)
      const current = bridge.waitForConnect(client, '127.0.0.1', address.port, 19, 1_000)

      await expect(superseded).rejects.toThrow('Previous TWS/Gateway connection attempt was superseded')
      // Node reports an unobserved rejection after the current turn.
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(unhandled).toEqual([])

      await expect(current).resolves.toBeUndefined()
      expect(client.isConnected()).toBe(true)
      expect(bridge.getNextOrderId()).toBe(700)

      // The superseded attempt closed its own socket; only the live one remains.
      await vi.waitFor(() => expect(sockets.size).toBe(1), { timeout: 1_000 })
      expect(client.isConnected()).toBe(true)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
      client.disconnect()
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }, 5_000)
})

describe('RequestBridge — superseded connect that settles late', () => {
  // Gateway recovery can start a new connect while the previous attempt is
  // still waiting in the protocol handshake. Whatever that stale attempt's
  // socket does afterwards (answer, close, or time out) must not reach the
  // connection that replaced it.

  interface HeldSocket {
    socket: Socket
    greeted: Promise<void>
    closed: Promise<void>
    answer(): void
  }

  const cleanups: Array<() => Promise<void> | void> = []
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }

  beforeEach(() => {
    unhandled.length = 0
    process.on('unhandledRejection', onUnhandled)
  })

  afterEach(async () => {
    vi.useRealTimers()
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
    process.off('unhandledRejection', onUnhandled)
  })

  /** A gateway that holds every handshake until the test answers it. */
  async function startGateway(): Promise<{ port: number; socket(index: number): Promise<HeldSocket> }> {
    const held: HeldSocket[] = []
    const server = createServer((socket) => {
      let markGreeted!: () => void
      const greeted = new Promise<void>((resolve) => { markGreeted = resolve })
      const closed = new Promise<void>((resolve) => { socket.once('close', () => resolve()) })
      let stage: 'greeting' | 'held' | 'start-api' | 'done' = 'greeting'
      socket.on('data', () => {
        if (stage === 'greeting') {
          stage = 'held'
          markGreeted()
          return
        }
        if (stage === 'start-api') {
          stage = 'done'
          socket.write(makeMsg(9, true, makeField(1) + makeField(700)))
        }
      })
      held.push({
        socket,
        greeted,
        closed,
        answer: () => {
          stage = 'start-api'
          const payload = Buffer.from(`222\0${new Date(0).toISOString()}\0`, 'utf8')
          const header = Buffer.alloc(4)
          header.writeUInt32BE(payload.length)
          socket.write(Buffer.concat([header, payload]))
        },
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    cleanups.push(async () => {
      for (const { socket } of held) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server has no TCP port')
    return {
      port: address.port,
      socket: (index) => vi.waitFor(() => {
        const entry = held[index]
        if (!entry) throw new Error(`socket ${index} not accepted yet`)
        return entry
      }, { timeout: 1_000 }),
    }
  }

  /** Leaves the stale attempt waiting in its handshake behind a connected successor. */
  async function supersedeDuringHandshake() {
    const gateway = await startGateway()
    const bridge = new RequestBridge()
    const client = new EClient(bridge)
    cleanups.push(() => client.disconnect())

    const stale = bridge.waitForConnect(client, '127.0.0.1', gateway.port, 19, 60_000)
    const staleOutcome = stale.then(() => 'resolved', (error: unknown) => error)
    const staleSocket = await gateway.socket(0)
    await staleSocket.greeted

    const current = bridge.waitForConnect(client, '127.0.0.1', gateway.port, 19, 60_000)
    const currentSocket = await gateway.socket(1)
    await currentSocket.greeted
    currentSocket.answer()
    await expect(current).resolves.toBeUndefined()

    const connectionClosed = vi.spyOn(bridge, 'connectionClosed')
    const error = vi.spyOn(bridge, 'error')
    return { bridge, client, staleSocket, staleOutcome, connectionClosed, error }
  }

  async function expectSuccessorUntouched(s: Awaited<ReturnType<typeof supersedeDuringHandshake>>): Promise<void> {
    await expect(s.staleOutcome).resolves.toMatchObject({
      message: 'Previous TWS/Gateway connection attempt was superseded',
    })
    await s.staleSocket.closed
    expect(s.client.isConnected()).toBe(true)
    expect(s.bridge.connectionDead).toBe(false)
    expect(s.bridge.getNextOrderId()).toBe(700)
    expect(s.connectionClosed).not.toHaveBeenCalled()
    expect(s.error).not.toHaveBeenCalled()
    expect(unhandled).toEqual([])
  }

  it('closes the stale socket quietly when its handshake succeeds late', async () => {
    const s = await supersedeDuringHandshake()
    s.staleSocket.answer()
    await expectSuccessorUntouched(s)
  }, 5_000)

  it('ignores the stale socket closing late from the gateway side', async () => {
    const s = await supersedeDuringHandshake()
    s.staleSocket.socket.destroy()
    await expectSuccessorUntouched(s)
  }, 5_000)

  it('closes the stale socket quietly when its handshake times out late', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const s = await supersedeDuringHandshake()
    // EClient's own protocol handshake timer (10s) fires for the stale attempt.
    vi.advanceTimersByTime(10_000)
    await expectSuccessorUntouched(s)
  }, 5_000)
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
  it('coalesces concurrent current-time probes onto one wire request', async () => {
    const b = new RequestBridge()
    const reqCurrentTime = vi.fn()
    b.setClient({ reqCurrentTime } as never)

    const first = b.requestCurrentTime()
    const second = b.requestCurrentTime()
    expect(reqCurrentTime).toHaveBeenCalledOnce()

    b.currentTime(1_784_289_600)
    await expect(Promise.all([first, second])).resolves.toEqual([
      1_784_289_600,
      1_784_289_600,
    ])
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
