/**
 * CtraderTransport — one JSON-over-WebSocket connection to the cTrader
 * Open API proxy.
 *
 * Responsibilities stop at the wire: request/response correlation by
 * clientMsgId, request timeouts, heartbeats, and fan-out of unsolicited
 * events. Authentication and reconnection belong to the session layer,
 * which creates a fresh transport for every connection attempt because a
 * new socket must be re-authenticated from scratch.
 *
 * Payloads are never logged here: auth requests carry client secrets and
 * access tokens.
 */

import {
  BROADCAST_REPLY_PAYLOAD_TYPES,
  ERROR_PAYLOAD_TYPES,
  EVENT_PAYLOAD_TYPES,
  HISTORICAL_PAYLOAD_TYPES,
  PayloadType,
  RATE_LIMITS,
  TRANSIENT_ERROR_CODES,
  type CtraderEnvelope,
  type CtraderErrorPayload,
} from './ctrader-protocol.js'
import { RateLimiter } from './rate-limiter.js'

/** The subset of the WHATWG WebSocket API the transport relies on. */
export interface WebSocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code?: number; reason?: string }) => void) | null
  onerror: ((ev: unknown) => void) | null
}

export type WebSocketFactory = (url: string) => WebSocketLike

const WS_OPEN = 1

export const defaultWebSocketFactory: WebSocketFactory = (url) => {
  const Ctor = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket
  if (!Ctor) throw new Error('This runtime has no global WebSocket (Node 22+ or Bun required)')
  return new Ctor(url)
}

/** A request the server answered with ProtoErrorRes / ProtoOAErrorRes. */
export class CtraderApiError extends Error {
  readonly errorCode: string
  readonly transient: boolean
  readonly payloadType: number
  readonly retryAfterSec: number | undefined

  constructor(payloadType: number, payload: CtraderErrorPayload) {
    const errorCode = payload.errorCode ?? 'UNKNOWN_ERROR'
    super(payload.description ? `${errorCode}: ${payload.description}` : errorCode)
    this.name = 'CtraderApiError'
    this.errorCode = errorCode
    this.payloadType = payloadType
    this.transient = TRANSIENT_ERROR_CODES.has(errorCode)
    this.retryAfterSec = typeof payload.retryAfter === 'number' ? payload.retryAfter : undefined
  }
}

/** The socket closed, failed, or a request outlived its deadline. */
export class CtraderTransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CtraderTransportError'
  }
}

export interface CtraderTransportOptions {
  url: string
  socketFactory?: WebSocketFactory
  connectTimeoutMs?: number
  requestTimeoutMs?: number
  /** The proxy drops connections that are silent for 30s; stay well below. */
  heartbeatIntervalMs?: number
  /** Override the documented per-connection limits (tests). */
  rateLimits?: { general: { limit: number; windowMs: number }; historical: { limit: number; windowMs: number } }
}

export interface RequestOptions {
  /** Expected response payloadType; any other non-error reply rejects. */
  expect?: number | readonly number[]
  timeoutMs?: number
}

export type EventListener = (message: CtraderEnvelope) => void
export type CloseListener = (reason: string) => void

interface Pending {
  expect: readonly number[] | null
  resolve: (message: CtraderEnvelope) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class CtraderTransport {
  private readonly url: string
  private readonly socketFactory: WebSocketFactory
  private readonly connectTimeoutMs: number
  private readonly requestTimeoutMs: number
  private readonly heartbeatIntervalMs: number

  private socket: WebSocketLike | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private readonly pending = new Map<string, Pending>()
  private readonly eventListeners = new Set<EventListener>()
  private readonly closeListeners = new Set<CloseListener>()
  private readonly generalLimiter: RateLimiter
  private readonly historicalLimiter: RateLimiter
  private nextId = 1
  private closed = false
  private closeReason: string | null = null

  constructor(options: CtraderTransportOptions) {
    this.url = options.url
    this.socketFactory = options.socketFactory ?? defaultWebSocketFactory
    this.connectTimeoutMs = options.connectTimeoutMs ?? 15_000
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 10_000
    const limits = options.rateLimits ?? RATE_LIMITS
    this.generalLimiter = new RateLimiter(limits.general.limit, limits.general.windowMs)
    this.historicalLimiter = new RateLimiter(limits.historical.limit, limits.historical.windowMs)
  }

  get isOpen(): boolean {
    return !this.closed && this.socket?.readyState === WS_OPEN
  }

  /** Open the socket. A transport connects at most once. */
  connect(): Promise<void> {
    if (this.socket || this.closed) {
      return Promise.reject(new CtraderTransportError('Transport already used; create a new one to reconnect'))
    }
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (err?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (err) reject(err)
        else resolve()
      }
      const timer = setTimeout(() => {
        settle(new CtraderTransportError(`Connect timed out after ${this.connectTimeoutMs}ms`))
        this.shutdown('connect timeout')
      }, this.connectTimeoutMs)

      let socket: WebSocketLike
      try {
        socket = this.socketFactory(this.url)
      } catch (err) {
        this.closed = true
        settle(err instanceof Error ? err : new Error(String(err)))
        return
      }
      this.socket = socket

      socket.onopen = () => {
        this.startHeartbeat()
        settle()
      }
      socket.onmessage = (ev) => this.handleMessage(ev.data)
      socket.onerror = () => {
        // The close event follows with the useful detail; only fail a
        // connect that never opened.
        if (!settled) settle(new CtraderTransportError('WebSocket error before open'))
      }
      socket.onclose = (ev) => {
        const reason = `socket closed${ev.code !== undefined ? ` (${ev.code}${ev.reason ? ` ${ev.reason}` : ''})` : ''}`
        settle(new CtraderTransportError(reason))
        this.shutdown(reason)
      }
    })
  }

  /**
   * Send a request and resolve with the first reply carrying the same
   * clientMsgId. Error envelopes reject with CtraderApiError. Requests over
   * the per-connection rate limit wait for a slot (FIFO); the reply timeout
   * starts when the request is actually sent.
   */
  request(payloadType: number, payload: Record<string, unknown> = {}, options: RequestOptions = {}): Promise<CtraderEnvelope> {
    if (!this.isOpen) return Promise.reject(this.notConnected())
    const limiter = HISTORICAL_PAYLOAD_TYPES.has(payloadType) ? this.historicalLimiter : this.generalLimiter
    if (limiter.tryAcquire()) return this.dispatch(payloadType, payload, options)
    return limiter.waitTurn().then(() => this.dispatch(payloadType, payload, options))
  }

  private dispatch(payloadType: number, payload: Record<string, unknown>, options: RequestOptions): Promise<CtraderEnvelope> {
    if (!this.isOpen) return Promise.reject(this.notConnected())
    const clientMsgId = `oa-${this.nextId++}`
    const expect = options.expect === undefined ? null : ([] as number[]).concat(options.expect)
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs

    return new Promise<CtraderEnvelope>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(clientMsgId)
        reject(new CtraderTransportError(`Request ${payloadType} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(clientMsgId, { expect, resolve, reject, timer })
      try {
        this.send({ clientMsgId, payloadType, payload })
      } catch (err) {
        clearTimeout(timer)
        this.pending.delete(clientMsgId)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  /** Subscribe to unsolicited server messages. Returns an unsubscribe fn. */
  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener)
    return () => { this.eventListeners.delete(listener) }
  }

  /** Called once when the connection ends for any reason. */
  onClose(listener: CloseListener): () => void {
    if (this.closed && this.closeReason !== null) {
      listener(this.closeReason)
      return () => {}
    }
    this.closeListeners.add(listener)
    return () => { this.closeListeners.delete(listener) }
  }

  close(): void {
    this.shutdown('closed by client')
  }

  // ==================== internals ====================

  private notConnected(): CtraderTransportError {
    return new CtraderTransportError(this.closeReason ? `Not connected: ${this.closeReason}` : 'Not connected')
  }

  private send(message: CtraderEnvelope): void {
    if (!this.socket || this.socket.readyState !== WS_OPEN) {
      throw new CtraderTransportError('Not connected')
    }
    this.socket.send(JSON.stringify(message))
  }

  private startHeartbeat(): void {
    if (this.heartbeatIntervalMs <= 0) return
    this.heartbeat = setInterval(() => {
      try {
        this.send({ payloadType: PayloadType.HEARTBEAT_EVENT })
      } catch {
        // A dead socket surfaces through onclose.
      }
    }, this.heartbeatIntervalMs)
  }

  private handleMessage(raw: unknown): void {
    const message = parseEnvelope(raw)
    if (!message) return

    const pending = message.clientMsgId !== undefined && !EVENT_PAYLOAD_TYPES.has(message.payloadType)
      ? this.pending.get(message.clientMsgId)
      : undefined

    if (pending) {
      this.pending.delete(message.clientMsgId!)
      clearTimeout(pending.timer)
      if (ERROR_PAYLOAD_TYPES.has(message.payloadType)) {
        pending.reject(new CtraderApiError(message.payloadType, (message.payload ?? {}) as CtraderErrorPayload))
      } else if (pending.expect && !pending.expect.includes(message.payloadType)) {
        pending.reject(new CtraderTransportError(
          `Unexpected reply ${message.payloadType}; expected ${pending.expect.join(' or ')}`,
        ))
      } else {
        pending.resolve(message)
      }
      if (!BROADCAST_REPLY_PAYLOAD_TYPES.has(message.payloadType)) return
    }

    if (message.payloadType === PayloadType.HEARTBEAT_EVENT) return
    this.emit(message)
  }

  private emit(message: CtraderEnvelope): void {
    for (const listener of this.eventListeners) {
      try {
        listener(message)
      } catch {
        // One faulty listener must not starve the others.
      }
    }
  }

  private shutdown(reason: string): void {
    if (this.closed) return
    this.closed = true
    this.closeReason = reason
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    this.generalLimiter.dispose()
    this.historicalLimiter.dispose()

    const socket = this.socket
    if (socket) {
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      try { socket.close() } catch { /* already closing */ }
    }

    const error = new CtraderTransportError(`Connection closed: ${reason}`)
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
      this.pending.delete(id)
    }
    for (const listener of this.closeListeners) {
      try { listener(reason) } catch { /* ignore */ }
    }
    this.closeListeners.clear()
    this.eventListeners.clear()
  }
}

function parseEnvelope(raw: unknown): CtraderEnvelope | null {
  if (typeof raw !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const { payloadType, payload, clientMsgId } = parsed as Record<string, unknown>
  if (typeof payloadType !== 'number') return null
  return {
    payloadType,
    ...(payload && typeof payload === 'object' ? { payload: payload as Record<string, unknown> } : {}),
    ...(typeof clientMsgId === 'string' ? { clientMsgId } : {}),
  }
}
