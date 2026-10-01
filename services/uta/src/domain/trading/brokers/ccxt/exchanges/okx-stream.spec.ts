import { describe, expect, it, vi } from 'vitest'
import { Contract } from '@traderalice/ibkr'
import type { OrderBook } from '../ccxt-types.js'
import {
  OKX_PUBLIC_WS_URL,
  OkxPublicMarketStream,
  type OkxPublicSocket,
} from './okx-stream.js'

class FakeSocket implements OkxPublicSocket {
  readonly sent: string[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onclose: (() => void) | null = null

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
  }
}

function makeBook(bids: [number, number][], asks: [number, number][]): OrderBook {
  const contract = new Contract()
  contract.symbol = 'BTC'
  contract.currency = 'USDT'
  return { contract, bids, asks, timestamp: new Date('2026-01-01T00:00:00.000Z') }
}

describe('OkxPublicMarketStream', () => {
  it('takes a snapshot first, subscribes to trades and books, and resnapshots on a sequence gap', async () => {
    const instId = 'BTC-USDT-SWAP'
    const socket = new FakeSocket()
    const snapshots = [
      makeBook([[100, 1]], [[101, 2]]),
      makeBook([[98, 4]], [[99, 5]]),
    ]
    const loadSnapshot = vi.fn(async (): Promise<OrderBook> => {
      const snapshot = snapshots.shift()
      if (!snapshot) throw new Error('unexpected snapshot')
      return snapshot
    })
    const books: OrderBook[] = []
    const trades: unknown[] = []
    const stream = new OkxPublicMarketStream({
      instId,
      loadSnapshot,
      socketFactory: vi.fn((url: string) => {
        expect(url).toBe(OKX_PUBLIC_WS_URL)
        return socket
      }),
      onBook: (book) => books.push(book),
      onTrade: (trade) => trades.push(trade),
    })

    await stream.start()
    expect(loadSnapshot).toHaveBeenCalledTimes(1)
    expect(books[0].bids).toEqual([[100, 1]])

    socket.onopen?.()
    expect(JSON.parse(socket.sent[0])).toEqual({
      op: 'subscribe',
      args: [
        { channel: 'trades', instId },
        { channel: 'books', instId },
      ],
    })

    await stream.handleMessage({
      arg: { channel: 'books', instId },
      action: 'snapshot',
      data: [{ seqId: '100', bids: [['100', '1']], asks: [['101', '2']], ts: '1700000000000' }],
    })
    await stream.handleMessage({
      arg: { channel: 'trades', instId },
      data: [{ tradeId: 'trade-1', px: '100.5', sz: '0.25', side: 'buy', ts: '1700000000123' }],
    })
    expect(trades).toEqual([{ id: 'trade-1', price: 100.5, amount: 0.25, side: 'buy', timestamp: new Date('2023-11-14T22:13:20.123Z') }])

    await stream.handleMessage({
      arg: { channel: 'books', instId },
      action: 'update',
      data: [{ seqId: '101', prevSeqId: '100', bids: [['100', '0'], ['99', '3']], asks: [['101', '4']] }],
    })
    expect(books.at(-1)?.bids).toEqual([[99, 3]])
    expect(books.at(-1)?.asks).toEqual([[101, 4]])

    await stream.handleMessage({
      arg: { channel: 'books', instId },
      action: 'update',
      data: [{ seqId: '103', prevSeqId: '102', bids: [['98', '7']], asks: [] }],
    })
    expect(loadSnapshot).toHaveBeenCalledTimes(2)
    expect(books.at(-1)?.bids).toEqual([[98, 4]])
    expect(books.at(-1)?.asks).toEqual([[99, 5]])
    expect(socket.sent.slice(-2).map((message) => JSON.parse(message))).toEqual([
      { op: 'unsubscribe', args: [{ channel: 'books', instId }] },
      { op: 'subscribe', args: [{ channel: 'books', instId }] },
    ])

    await stream.handleMessage({
      arg: { channel: 'books', instId },
      action: 'snapshot',
      data: [{ seqId: '200', bids: [['97', '2']], asks: [['98', '3']], ts: '1700000001000' }],
    })
    await stream.handleMessage({
      arg: { channel: 'books', instId },
      action: 'update',
      data: [{ seqId: '201', prevSeqId: '200', bids: [['97', '0'], ['96', '8']], asks: [] }],
    })
    expect(books.at(-1)?.bids).toEqual([[96, 8]])
    expect(books.at(-1)?.asks).toEqual([[98, 3]])

    stream.stop()
    expect(socket.closed).toBe(true)
  })
})
