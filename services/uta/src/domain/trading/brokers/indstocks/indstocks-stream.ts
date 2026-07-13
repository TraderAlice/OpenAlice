/**
 * INDstocks order-update WebSocket.
 *
 *   wss://ws-order-updates.indstocks.com/api/v1/ws/trades
 *   - auth: `Authorization: <accessToken>` header at handshake
 *   - subscribe: {"action":"subscribe","mode":"order_updates"} (no instruments)
 *   - server pushes {type:"order", order_id, order_status, filled_quantity, ...}
 *   - periodic heartbeats arrive without order fields → ignored
 *
 * This is NOT part of the IBroker contract (which is poll-based: the UTA
 * order-sync poller calls getOrder/getOpenOrders on a timer). It's opt-in
 * push infrastructure: a consumer can construct this to get fills the instant
 * they happen instead of waiting for the next poll.
 *
 * TODO (integration): have the UTA order-sync poller subscribe to this and
 * collapse its pending-lane polling to a fallback. Until then it stands alone.
 *
 * NOTE on the daily token: a 403 at handshake (expired token) surfaces as an
 * error/close; `onAuthError` fires so the caller can stop reconnecting and
 * prompt the user to regenerate — same daily-token wall as the REST side.
 */

import WebSocket from 'ws'
import type { IndstocksOrderUpdate } from './indstocks-types.js'

const ORDER_WS_URL = 'wss://ws-order-updates.indstocks.com/api/v1/ws/trades'

export interface IndstocksOrderStreamHandlers {
  onUpdate: (u: IndstocksOrderUpdate) => void
  onAuthError?: () => void
  onError?: (err: Error) => void
}

export class IndstocksOrderStream {
  private ws: WebSocket | null = null
  private stopped = false
  private retry = 0
  private static readonly MAX_BACKOFF_MS = 30_000

  constructor(
    private accessToken: string,
    private readonly handlers: IndstocksOrderStreamHandlers,
  ) {}

  /** Swap in a fresh daily token; takes effect on the next (re)connect. */
  setToken(token: string): void {
    this.accessToken = token
  }

  start(): void {
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    this.ws?.close()
    this.ws = null
  }

  private connect(): void {
    if (this.stopped) return
    const ws = new WebSocket(ORDER_WS_URL, { headers: { Authorization: this.accessToken } })
    this.ws = ws

    ws.on('open', () => {
      this.retry = 0
      ws.send(JSON.stringify({ action: 'subscribe', mode: 'order_updates' }))
    })

    ws.on('message', (raw: WebSocket.RawData) => {
      let msg: unknown
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return   // non-JSON heartbeat / keepalive
      }
      const m = msg as Partial<IndstocksOrderUpdate>
      // Order updates carry order_id; heartbeats don't. Filter on that.
      if (m && typeof m.order_id === 'string' && m.order_status != null) {
        this.handlers.onUpdate(m as IndstocksOrderUpdate)
      }
    })

    ws.on('unexpected-response', (_req, res) => {
      // 401/403 at handshake = bad/expired daily token. Don't hammer-reconnect.
      if (res.statusCode === 401 || res.statusCode === 403) {
        this.stopped = true
        this.handlers.onAuthError?.()
      }
    })

    ws.on('error', (err: Error) => {
      this.handlers.onError?.(err)
    })

    ws.on('close', () => {
      this.ws = null
      if (this.stopped) return
      const delay = Math.min(IndstocksOrderStream.MAX_BACKOFF_MS, 1000 * 2 ** this.retry)
      this.retry++
      setTimeout(() => this.connect(), delay)
    })
  }
}
