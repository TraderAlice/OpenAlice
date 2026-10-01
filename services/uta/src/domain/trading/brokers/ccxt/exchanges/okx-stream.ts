import type { OrderBook, OrderBookLevel } from '../ccxt-types.js'

export const OKX_PUBLIC_WS_URL = 'wss://ws.okx.com:8443/ws/v5/public'
const OKX_PUBLIC_BOOK_CHANNEL = 'books'
const OKX_PUBLIC_TRADES_CHANNEL = 'trades'

type SocketEvent = { data: unknown }

export interface OkxPublicSocket {
  send(data: string): void
  close(): void
  onopen: (() => void) | null
  onmessage: ((event: SocketEvent) => void) | null
  onerror: ((event: unknown) => void) | null
  onclose: (() => void) | null
}

export type OkxPublicSocketFactory = (url: string) => OkxPublicSocket

export interface OkxPublicTrade {
  id: string
  price: number
  amount: number
  side: 'buy' | 'sell'
  timestamp: Date
}

export interface OkxPublicMarketStreamOptions {
  instId: string
  /** REST/CCXT snapshot; the stream never polls this path after a healthy delta. */
  loadSnapshot: () => Promise<OrderBook>
  socketFactory?: OkxPublicSocketFactory
  onBook?: (book: OrderBook) => void
  onTrade?: (trade: OkxPublicTrade) => void
  onError?: (error: Error) => void
}

interface MutableOrderBook {
  contract: OrderBook['contract']
  timestamp: Date
  bids: Map<string, number>
  asks: Map<string, number>
}

interface WireMessage {
  event?: unknown
  code?: unknown
  msg?: unknown
  arg?: { channel?: unknown; instId?: unknown }
  action?: unknown
  data?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asWireMessage(value: unknown): WireMessage | undefined {
  if (!isRecord(value)) return undefined
  return value as WireMessage
}

function parseMessage(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function asSequence(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  return undefined
}

function asLevel(value: unknown): [string, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined
  const price = typeof value[0] === 'string' ? value[0] : String(value[0])
  const amount = Number(value[1])
  if (!price || !Number.isFinite(amount)) return undefined
  return [price, amount]
}

function applyWireLevels(target: Map<string, number>, levels: unknown): void {
  if (!Array.isArray(levels)) return
  for (const rawLevel of levels) {
    const level = asLevel(rawLevel)
    if (!level) continue
    if (level[1] === 0) target.delete(level[0])
    else target.set(level[0], level[1])
  }
}

function applySnapshotLevels(target: Map<string, number>, levels: OrderBookLevel[]): void {
  for (const [price, amount] of levels) {
    if (Number.isFinite(price) && Number.isFinite(amount) && amount > 0) {
      target.set(String(price), amount)
    }
  }
}

function toError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(typeof value === 'string' ? value : fallback)
}

function defaultSocketFactory(url: string): OkxPublicSocket {
  const WebSocketConstructor = (globalThis as unknown as {
    WebSocket?: new (url: string) => OkxPublicSocket
  }).WebSocket
  if (!WebSocketConstructor) throw new Error('OKX public streaming requires a WebSocket runtime')
  return new WebSocketConstructor(url)
}

/**
 * Small public OKX market-data seam.
 *
 * It deliberately uses the public "books" channel: REST/CCXT supplies the
 * first snapshot, OKX sequence IDs guard every incremental update, and a gap
 * reloads that snapshot.
 */
export class OkxPublicMarketStream {
  private readonly options: OkxPublicMarketStreamOptions
  private socket: OkxPublicSocket | undefined
  private book: MutableOrderBook | undefined
  private sequenceId: string | undefined
  private resnapshotPromise: Promise<void> | undefined
  private started = false

  constructor(options: OkxPublicMarketStreamOptions) {
    if (!options.instId) throw new Error('OKX public stream requires instId')
    this.options = options
  }

  async start(): Promise<void> {
    if (this.started) throw new Error('OKX public stream is already started')
    this.started = true
    try {
      const snapshot = await this.options.loadSnapshot()
      this.installSnapshot(snapshot)
      this.emitBook()

      const socket = (this.options.socketFactory ?? defaultSocketFactory)(OKX_PUBLIC_WS_URL)
      this.socket = socket
      socket.onopen = () => this.subscribe()
      socket.onmessage = (event) => {
        void this.handleMessage(event.data).catch((error: unknown) => this.notifyError(error))
      }
      socket.onerror = (event) => this.notifyError(event)
    } catch (error) {
      this.started = false
      throw error
    }
  }

  stop(): void {
    const socket = this.socket
    this.socket = undefined
    this.started = false
    if (!socket) return
    socket.onopen = null
    socket.onmessage = null
    socket.onerror = null
    socket.onclose = null
    socket.close()
  }

  /** Processes one decoded OKX message; exposed for deterministic sequence tests. */
  async handleMessage(message: unknown): Promise<void> {
    const wire = asWireMessage(parseMessage(message))
    if (!wire) return

    if (wire.event === 'error') {
      this.notifyError(new Error(String(wire.msg ?? 'OKX public stream error')))
      return
    }

    const arg = wire.arg
    const channel = typeof arg?.channel === 'string' ? arg.channel : undefined
    const instId = typeof arg?.instId === 'string' ? arg.instId : undefined
    if (instId !== undefined && instId !== this.options.instId) return
    if (!Array.isArray(wire.data)) return

    if (channel === OKX_PUBLIC_TRADES_CHANNEL) {
      for (const rawTrade of wire.data) this.emitTrade(rawTrade)
      return
    }
    if (channel !== OKX_PUBLIC_BOOK_CHANNEL) return

    const action = wire.action === 'snapshot' || wire.action === 'update' ? wire.action : undefined
    if (action === 'snapshot') {
      this.installWireSnapshot(wire.data)
      this.sequenceId = asSequence((wire.data[0] as Record<string, unknown> | undefined)?.seqId)
      this.emitBook()
      return
    }
    if (action !== 'update' || !this.book) return

    const raw = wire.data[0]
    if (!isRecord(raw)) return
    const nextSequenceId = asSequence(raw.seqId)
    const previousSequenceId = asSequence(raw.prevSeqId)
    if (
      nextSequenceId === undefined ||
      previousSequenceId === undefined ||
      this.sequenceId === undefined ||
      previousSequenceId !== this.sequenceId
    ) {
      await this.resnapshot()
      return
    }
    if (nextSequenceId === this.sequenceId) return

    applyWireLevels(this.book.bids, raw.bids)
    applyWireLevels(this.book.asks, raw.asks)
    this.book.timestamp = this.wireTimestamp(raw.ts, this.book.timestamp)
    this.sequenceId = nextSequenceId
    this.emitBook()
  }

  currentOrderBook(): OrderBook | undefined {
    return this.book ? this.toOrderBook() : undefined
  }

  private subscribe(): void {
    this.socket?.send(JSON.stringify({
      op: 'subscribe',
      args: [
        { channel: OKX_PUBLIC_TRADES_CHANNEL, instId: this.options.instId },
        { channel: OKX_PUBLIC_BOOK_CHANNEL, instId: this.options.instId },
      ],
    }))
  }

  private resubscribeBooks(): void {
    const socket = this.socket
    if (!socket) return
    const args = [{ channel: OKX_PUBLIC_BOOK_CHANNEL, instId: this.options.instId }]
    socket.send(JSON.stringify({ op: 'unsubscribe', args }))
    socket.send(JSON.stringify({ op: 'subscribe', args }))
  }

  private installSnapshot(snapshot: OrderBook): void {
    this.book = {
      contract: snapshot.contract,
      timestamp: snapshot.timestamp,
      bids: new Map(),
      asks: new Map(),
    }
    applySnapshotLevels(this.book.bids, snapshot.bids)
    applySnapshotLevels(this.book.asks, snapshot.asks)
    this.sequenceId = undefined
  }

  private installWireSnapshot(data: unknown[]): void {
    if (!this.book) return
    const first = isRecord(data[0]) ? data[0] : undefined
    const next = {
      contract: this.book.contract,
      timestamp: this.wireTimestamp(first?.ts, this.book.timestamp),
      bids: new Map<string, number>(),
      asks: new Map<string, number>(),
    }
    applyWireLevels(next.bids, first?.bids)
    applyWireLevels(next.asks, first?.asks)
    this.book = next
  }

  private async resnapshot(): Promise<void> {
    if (this.resnapshotPromise) return this.resnapshotPromise
    const promise = (async () => {
      const snapshot = await this.options.loadSnapshot()
      this.installSnapshot(snapshot)
      this.emitBook()
      this.resubscribeBooks()
    })()
    this.resnapshotPromise = promise
    try {
      await promise
    } catch (error) {
      this.notifyError(error)
      throw error
    } finally {
      if (this.resnapshotPromise === promise) this.resnapshotPromise = undefined
    }
  }

  private wireTimestamp(value: unknown, fallback: Date): Date {
    const timestamp = Number(value)
    return Number.isFinite(timestamp) ? new Date(timestamp) : fallback
  }

  private toOrderBook(): OrderBook {
    if (!this.book) throw new Error('OKX public stream has no order-book snapshot')
    const bids = Array.from(this.book.bids, ([price, amount]) => [Number(price), amount] as OrderBookLevel)
      .sort((left, right) => right[0] - left[0])
    const asks = Array.from(this.book.asks, ([price, amount]) => [Number(price), amount] as OrderBookLevel)
      .sort((left, right) => left[0] - right[0])
    return { contract: this.book.contract, bids, asks, timestamp: this.book.timestamp }
  }

  private emitBook(): void {
    const book = this.currentOrderBook()
    if (book) this.options.onBook?.(book)
  }

  private emitTrade(value: unknown): void {
    if (!isRecord(value)) return
    const id = String(value.tradeId ?? value.id ?? '')
    const price = Number(value.px)
    const amount = Number(value.sz)
    const side = value.side === 'buy' || value.side === 'sell' ? value.side : undefined
    const timestamp = Number(value.ts)
    if (!id || !Number.isFinite(price) || !Number.isFinite(amount) || !side || !Number.isFinite(timestamp)) return
    this.options.onTrade?.({ id, price, amount, side, timestamp: new Date(timestamp) })
  }

  private notifyError(value: unknown): void {
    this.options.onError?.(toError(value, 'OKX public stream error'))
  }
}
