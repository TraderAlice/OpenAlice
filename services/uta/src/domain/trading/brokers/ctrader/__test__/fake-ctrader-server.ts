/**
 * In-memory stand-in for the cTrader Open API JSON proxy, for specs.
 *
 * Speaks the real envelope format over a fake WebSocket and implements the
 * authentication handshake (application auth, account list, account auth,
 * rotating refresh tokens). Specs add handlers for any other payload type.
 */

import { PayloadType, type CtraderEnvelope } from '../ctrader-protocol.js'
import type { WebSocketFactory, WebSocketLike } from '../ctrader-transport.js'

export type FakeReply =
  | { payloadType: number; payload?: Record<string, unknown> }
  | { error: string; description?: string; common?: boolean }

export type FakeHandler = (payload: Record<string, unknown>, server: FakeCtraderServer) => FakeReply | FakeReply[] | undefined

export interface FakeAccount {
  ctidTraderAccountId: number
  traderLogin: number
  isLive?: boolean
  brokerTitleShort?: string
}

export interface FakeCtraderOptions {
  clientId?: string
  clientSecret?: string
  accounts?: FakeAccount[]
  /** 0 = SCOPE_VIEW, 1 = SCOPE_TRADE */
  permissionScope?: number
  accessTokens?: string[]
  /** refreshToken → next token pair; consumed on use (rotation). */
  refreshTokens?: Record<string, { accessToken: string; refreshToken: string }>
  handlers?: Record<number, FakeHandler>
}

export class FakeSocket implements WebSocketLike {
  readyState = 0
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null

  constructor(readonly url: string, private readonly server: FakeCtraderServer) {}

  send(data: string): void {
    this.server.receive(this, JSON.parse(data) as CtraderEnvelope)
  }

  close(): void {
    this.readyState = 3
  }

  deliver(message: CtraderEnvelope): void {
    if (this.readyState !== 1) return
    this.onmessage?.({ data: JSON.stringify(message) })
  }

  drop(code = 1006, reason = ''): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.onclose?.({ code, reason })
  }
}

export class FakeCtraderServer {
  readonly sockets: FakeSocket[] = []
  /** Every request received, heartbeats excluded, in order. */
  readonly received: CtraderEnvelope[] = []
  readonly clientId: string
  readonly clientSecret: string
  accounts: FakeAccount[]
  permissionScope: number
  readonly accessTokens: Set<string>
  readonly refreshTokens: Map<string, { accessToken: string; refreshToken: string }>
  readonly handlers: Record<number, FakeHandler>
  /** When false, sockets stay connecting until `openPending()`. */
  autoOpen = true

  constructor(options: FakeCtraderOptions = {}) {
    this.clientId = options.clientId ?? 'client-id'
    this.clientSecret = options.clientSecret ?? 'client-secret'
    this.accounts = options.accounts ?? [{ ctidTraderAccountId: 4242, traderLogin: 1000001, isLive: false, brokerTitleShort: 'Spotware' }]
    this.permissionScope = options.permissionScope ?? 1
    this.accessTokens = new Set(options.accessTokens ?? ['access-1'])
    this.refreshTokens = new Map(Object.entries(options.refreshTokens ?? {}))
    this.handlers = { ...options.handlers }
  }

  readonly socketFactory: WebSocketFactory = (url) => {
    const socket = new FakeSocket(url, this)
    this.sockets.push(socket)
    if (this.autoOpen) queueMicrotask(() => this.open(socket))
    return socket
  }

  get current(): FakeSocket {
    const socket = this.sockets[this.sockets.length - 1]
    if (!socket) throw new Error('no socket yet')
    return socket
  }

  openPending(): void {
    for (const socket of this.sockets) if (socket.readyState === 0) this.open(socket)
  }

  /** Push an unsolicited event to the newest socket. */
  push(payloadType: number, payload: Record<string, unknown> = {}): void {
    this.current.deliver({ payloadType, payload })
  }

  requestsOf(payloadType: number): CtraderEnvelope[] {
    return this.received.filter((m) => m.payloadType === payloadType)
  }

  receive(socket: FakeSocket, message: CtraderEnvelope): void {
    if (message.payloadType === PayloadType.HEARTBEAT_EVENT) return
    this.received.push(message)
    const handler = this.handlers[message.payloadType] ?? this.defaultHandler(message.payloadType)
    if (!handler) return
    const replies = handler(message.payload ?? {}, this)
    if (!replies) return
    for (const reply of ([] as FakeReply[]).concat(replies)) {
      const envelope: CtraderEnvelope = 'error' in reply
        ? {
            payloadType: reply.common ? PayloadType.ERROR_RES : PayloadType.OA_ERROR_RES,
            payload: { errorCode: reply.error, ...(reply.description ? { description: reply.description } : {}) },
          }
        : { payloadType: reply.payloadType, ...(reply.payload ? { payload: reply.payload } : {}) }
      if (message.clientMsgId !== undefined) envelope.clientMsgId = message.clientMsgId
      queueMicrotask(() => socket.deliver(envelope))
    }
  }

  private open(socket: FakeSocket): void {
    if (socket.readyState !== 0) return
    socket.readyState = 1
    socket.onopen?.({})
  }

  private defaultHandler(payloadType: number): FakeHandler | undefined {
    switch (payloadType) {
      case PayloadType.APPLICATION_AUTH_REQ:
        return (p) => p['clientId'] === this.clientId && p['clientSecret'] === this.clientSecret
          ? { payloadType: PayloadType.APPLICATION_AUTH_RES }
          : { error: 'CH_CLIENT_AUTH_FAILURE', description: 'Wrong client credentials' }
      case PayloadType.GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ:
        return (p) => this.accessTokens.has(p['accessToken'] as string)
          ? {
              payloadType: PayloadType.GET_ACCOUNTS_BY_ACCESS_TOKEN_RES,
              payload: { accessToken: p['accessToken'], permissionScope: this.permissionScope, ctidTraderAccount: this.accounts },
            }
          : { error: 'CH_ACCESS_TOKEN_INVALID', description: 'Access token expired' }
      case PayloadType.ACCOUNT_AUTH_REQ:
        return (p) => {
          if (!this.accessTokens.has(p['accessToken'] as string)) return { error: 'CH_ACCESS_TOKEN_INVALID' }
          if (!this.accounts.some((a) => a.ctidTraderAccountId === p['ctidTraderAccountId'])) return { error: 'CH_CTID_TRADER_ACCOUNT_NOT_FOUND' }
          return { payloadType: PayloadType.ACCOUNT_AUTH_RES, payload: { ctidTraderAccountId: p['ctidTraderAccountId'] } }
        }
      case PayloadType.REFRESH_TOKEN_REQ:
        return (p) => {
          const next = this.refreshTokens.get(p['refreshToken'] as string)
          if (!next) return { error: 'CH_ACCESS_TOKEN_INVALID', description: 'Refresh token invalid' }
          this.refreshTokens.delete(p['refreshToken'] as string)
          this.accessTokens.add(next.accessToken)
          return {
            payloadType: PayloadType.REFRESH_TOKEN_RES,
            payload: { accessToken: next.accessToken, refreshToken: next.refreshToken, tokenType: 'bearer', expiresIn: 2628000 },
          }
        }
      default:
        return undefined
    }
  }
}
