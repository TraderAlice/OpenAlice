import { createServer, type Socket } from 'node:net'

import { describe, it, expect, vi } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, EClient, makeField, makeMsg, NO_VALID_ID, TickTypeEnum } from '@traderalice/ibkr'
import { RequestBridge } from './request-bridge.js'

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
      expect(Date.now() - startedAt).toBeLessThan(1_000)
    } finally {
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
