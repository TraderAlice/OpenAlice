/**
 * CtraderSession — an authenticated cTrader Open API session for exactly one
 * trading account.
 *
 * Handshake per connection: application auth → account discovery by access
 * token → account auth. If the access token is rejected and a refresh token
 * is configured, the session refreshes once (refresh tokens rotate: the old
 * one is invalid as soon as the server answers), hands the new pair to
 * `onTokensRefreshed`, and re-handshakes on a fresh connection.
 *
 * Reconnection is owned by UTA, not by this class. When the connection is
 * lost the session emits `dead` and stays down; UTA's recovery loop calls
 * `ensureConnected()` again. Concurrent calls share one in-flight attempt, so
 * a recovery nudge during an attempt never starts a parallel handshake.
 */

import { BrokerError, type BrokerConnectionStateEvent } from '../types.js'
import {
  PayloadType,
  ctraderJsonUrl,
  type CtraderEnvelope,
  type CtraderEnvironment,
} from './ctrader-protocol.js'
import {
  CtraderApiError,
  CtraderTransport,
  CtraderTransportError,
  type CtraderTransportOptions,
  type RequestOptions,
} from './ctrader-transport.js'

export interface CtraderCredentials {
  clientId: string
  clientSecret: string
  accessToken: string
  refreshToken?: string
}

/** Identify the account by the login shown in cTrader apps, or by its Open API id. */
export interface CtraderAccountSelector {
  traderLogin?: number
  ctidTraderAccountId?: number
}

export interface CtraderTokenRefresh {
  accessToken: string
  refreshToken: string
  expiresInSec: number
}

/** The authorized account this session is bound to. */
export interface CtraderAccountRef {
  ctidTraderAccountId: number
  traderLogin: number | undefined
  brokerName: string | undefined
  isLive: boolean
  /** False when the token was granted with the view-only scope. */
  canTrade: boolean
}

export interface CtraderSessionOptions {
  environment: CtraderEnvironment
  account: CtraderAccountSelector
  credentials: CtraderCredentials
  /** Persist a rotated token pair. Failure keeps the session usable in memory. */
  onTokensRefreshed?: (tokens: CtraderTokenRefresh) => Promise<void> | void
  /** Transport overrides (socket factory, timeouts) — tests and diagnostics. */
  transport?: Omit<CtraderTransportOptions, 'url'>
}

/** Credentials or account are wrong; retrying cannot help. */
const PERMANENT_AUTH_CODES: ReadonlySet<string> = new Set([
  'CH_CLIENT_AUTH_FAILURE',
  'CH_OA_CLIENT_NOT_FOUND',
  'CH_CTID_TRADER_ACCOUNT_NOT_FOUND',
  'RET_NO_SUCH_LOGIN',
  'RET_ACCOUNT_DISABLED',
  'CHANNEL_IS_BLOCKED',
])

/** The access token is no longer accepted; a refresh may fix it. */
const TOKEN_CODES: ReadonlySet<string> = new Set([
  'CH_ACCESS_TOKEN_INVALID',
  'OA_AUTH_TOKEN_EXPIRED',
])

/** The server no longer considers this connection authenticated. */
const SESSION_LOST_CODES: ReadonlySet<string> = new Set([
  'ACCOUNT_NOT_AUTHORIZED',
  'CH_CLIENT_NOT_AUTHENTICATED',
])

const MARKET_CLOSED_CODES: ReadonlySet<string> = new Set(['MARKET_CLOSED', 'SYMBOL_HAS_HOLIDAY'])

/** Map any session/transport failure onto UTA's BrokerError taxonomy. */
export function toBrokerError(err: unknown, context: string): BrokerError {
  if (err instanceof BrokerError) return err
  if (err instanceof CtraderApiError) {
    const message = `cTrader ${context} failed: ${err.message}`
    if (PERMANENT_AUTH_CODES.has(err.errorCode) || TOKEN_CODES.has(err.errorCode)) return new BrokerError('AUTH', message)
    if (MARKET_CLOSED_CODES.has(err.errorCode)) return new BrokerError('MARKET_CLOSED', message)
    if (err.transient || SESSION_LOST_CODES.has(err.errorCode)) return new BrokerError('NETWORK', message)
    return new BrokerError('EXCHANGE', message)
  }
  if (err instanceof CtraderTransportError) return new BrokerError('NETWORK', `cTrader ${context} failed: ${err.message}`)
  return BrokerError.from(err)
}

function isTokenError(err: unknown): boolean {
  return err instanceof CtraderApiError && TOKEN_CODES.has(err.errorCode)
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

export class CtraderSession {
  private readonly environment: CtraderEnvironment
  private readonly selector: CtraderAccountSelector
  private credentials: CtraderCredentials
  private readonly onTokensRefreshed: CtraderSessionOptions['onTokensRefreshed']
  private readonly transportOptions: Omit<CtraderTransportOptions, 'url'>

  private transport: CtraderTransport | null = null
  private inFlight: Promise<void> | null = null
  private account: CtraderAccountRef | null = null
  private ready = false
  private wasDead = false
  private closed = false
  private tokenPersistError: string | null = null

  private stateListener: ((event: BrokerConnectionStateEvent) => void) | null = null
  private readonly eventListeners = new Set<(message: CtraderEnvelope) => void>()
  private readonly readyListeners = new Set<() => void>()

  constructor(options: CtraderSessionOptions) {
    if (options.account.traderLogin === undefined && options.account.ctidTraderAccountId === undefined) {
      throw new BrokerError('CONFIG', 'cTrader account requires traderLogin or ctidTraderAccountId')
    }
    this.environment = options.environment
    this.selector = { ...options.account }
    this.credentials = { ...options.credentials }
    this.onTokensRefreshed = options.onTokensRefreshed
    this.transportOptions = options.transport ?? {}
  }

  get isReady(): boolean {
    return this.ready && this.transport?.isOpen === true
  }

  /** The bound account. Available after the first successful connect. */
  get accountRef(): CtraderAccountRef {
    if (!this.account) throw new BrokerError('CONNECTING', 'cTrader session has not connected yet')
    return this.account
  }

  /** Set when a rotated token pair could not be persisted (restart will fail auth). */
  get lastTokenPersistError(): string | null {
    return this.tokenPersistError
  }

  setConnectionStateListener(listener: ((event: BrokerConnectionStateEvent) => void) | null): void {
    this.stateListener = listener
  }

  /** Unsolicited account events (executions, spots, trader updates). Survives reconnects. */
  onEvent(listener: (message: CtraderEnvelope) => void): () => void {
    this.eventListeners.add(listener)
    return () => { this.eventListeners.delete(listener) }
  }

  /** Called after every successful (re)authentication, e.g. to re-subscribe spots. */
  onReady(listener: () => void): () => void {
    this.readyListeners.add(listener)
    return () => { this.readyListeners.delete(listener) }
  }

  /** Connect and authenticate unless already ready. Concurrent callers share one attempt. */
  ensureConnected(): Promise<void> {
    if (this.closed) return Promise.reject(new BrokerError('CONFIG', 'cTrader session is closed'))
    if (this.isReady) return Promise.resolve()
    if (!this.inFlight) {
      this.inFlight = this.connect().finally(() => { this.inFlight = null })
    }
    return this.inFlight
  }

  /** Send a request on the authenticated connection. Rejects with the raw cTrader error. */
  async request(payloadType: number, payload: Record<string, unknown> = {}, options: RequestOptions = {}): Promise<CtraderEnvelope> {
    const transport = this.readyTransport()
    try {
      return await transport.request(payloadType, payload, options)
    } catch (err) {
      if (err instanceof CtraderApiError && (TOKEN_CODES.has(err.errorCode) || SESSION_LOST_CODES.has(err.errorCode))) {
        this.markDead(`session rejected: ${err.errorCode}`)
      }
      throw err
    }
  }

  /** `request` with this session's ctidTraderAccountId filled in. */
  accountRequest(payloadType: number, payload: Record<string, unknown> = {}, options: RequestOptions = {}): Promise<CtraderEnvelope> {
    return this.request(payloadType, { ctidTraderAccountId: this.accountRef.ctidTraderAccountId, ...payload }, options)
  }

  async close(): Promise<void> {
    this.closed = true
    this.ready = false
    const transport = this.transport
    this.transport = null
    transport?.close()
    this.readyListeners.clear()
    this.eventListeners.clear()
    this.stateListener = null
  }

  // ==================== connection ====================

  private readyTransport(): CtraderTransport {
    if (this.isReady) return this.transport!
    if (this.inFlight) throw new BrokerError('CONNECTING', 'cTrader session is connecting')
    throw new BrokerError('NETWORK', 'cTrader session is not connected')
  }

  private async connect(): Promise<void> {
    this.discardTransport()
    let refreshed = false
    for (;;) {
      const transport = new CtraderTransport({ ...this.transportOptions, url: ctraderJsonUrl(this.environment) })
      try {
        await transport.connect()
        await transport.request(
          PayloadType.APPLICATION_AUTH_REQ,
          { clientId: this.credentials.clientId, clientSecret: this.credentials.clientSecret },
          { expect: PayloadType.APPLICATION_AUTH_RES },
        )
        const account = await this.resolveAccount(transport)
        await transport.request(
          PayloadType.ACCOUNT_AUTH_REQ,
          { ctidTraderAccountId: account.ctidTraderAccountId, accessToken: this.credentials.accessToken },
          { expect: PayloadType.ACCOUNT_AUTH_RES },
        )
        if (this.closed) {
          transport.close()
          throw new BrokerError('CONFIG', 'cTrader session is closed')
        }
        this.account = account
        this.attach(transport)
        return
      } catch (err) {
        if (!refreshed && isTokenError(err) && this.credentials.refreshToken && transport.isOpen) {
          refreshed = true
          try {
            await this.refreshTokens(transport)
          } catch (refreshErr) {
            transport.close()
            throw toBrokerError(refreshErr, 'token refresh')
          }
          // Spotware: start a new session after refreshing, otherwise the
          // server invalidates the account with a token event.
          transport.close()
          continue
        }
        transport.close()
        throw toBrokerError(err, 'connect')
      }
    }
  }

  private async resolveAccount(transport: CtraderTransport): Promise<CtraderAccountRef> {
    const res = await transport.request(
      PayloadType.GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ,
      { accessToken: this.credentials.accessToken },
      { expect: PayloadType.GET_ACCOUNTS_BY_ACCESS_TOKEN_RES },
    )
    const payload = res.payload ?? {}
    const scope = payload['permissionScope']
    const canTrade = scope === 1 || scope === 'SCOPE_TRADE'
    const rows = Array.isArray(payload['ctidTraderAccount']) ? payload['ctidTraderAccount'] as Record<string, unknown>[] : []
    const accounts = rows.map((row) => ({
      ctidTraderAccountId: asNumber(row['ctidTraderAccountId']),
      traderLogin: asNumber(row['traderLogin']),
      brokerName: typeof row['brokerTitleShort'] === 'string' ? row['brokerTitleShort'] : undefined,
      isLive: row['isLive'] === true,
    }))

    const match = accounts.find((a) =>
      this.selector.ctidTraderAccountId !== undefined
        ? a.ctidTraderAccountId === this.selector.ctidTraderAccountId
        : a.traderLogin === this.selector.traderLogin,
    )
    const wanted = this.selector.ctidTraderAccountId !== undefined
      ? `ctidTraderAccountId ${this.selector.ctidTraderAccountId}`
      : `login ${this.selector.traderLogin}`
    if (!match || match.ctidTraderAccountId === undefined) {
      const known = accounts.map((a) => `${a.traderLogin ?? '?'}${a.isLive ? ' (live)' : ' (demo)'}`).join(', ') || 'none'
      throw new BrokerError('CONFIG', `cTrader account ${wanted} is not authorized for this access token (authorized: ${known})`)
    }
    if (match.isLive !== (this.environment === 'live')) {
      throw new BrokerError('CONFIG', `cTrader account ${wanted} is a ${match.isLive ? 'live' : 'demo'} account but the connection is set to ${this.environment}`)
    }
    return {
      ctidTraderAccountId: match.ctidTraderAccountId,
      traderLogin: match.traderLogin,
      brokerName: match.brokerName,
      isLive: match.isLive,
      canTrade,
    }
  }

  private async refreshTokens(transport: CtraderTransport): Promise<void> {
    const res = await transport.request(
      PayloadType.REFRESH_TOKEN_REQ,
      { refreshToken: this.credentials.refreshToken },
      { expect: PayloadType.REFRESH_TOKEN_RES },
    )
    const payload = res.payload ?? {}
    const accessToken = payload['accessToken']
    const refreshToken = payload['refreshToken']
    if (typeof accessToken !== 'string' || typeof refreshToken !== 'string' || !accessToken || !refreshToken) {
      throw new BrokerError('AUTH', 'cTrader token refresh returned no tokens')
    }
    // The previous refresh token is already void: keep the new pair before anything else.
    this.credentials = { ...this.credentials, accessToken, refreshToken }
    const tokens: CtraderTokenRefresh = { accessToken, refreshToken, expiresInSec: asNumber(payload['expiresIn']) ?? 0 }
    if (!this.onTokensRefreshed) {
      this.tokenPersistError = 'Rotated cTrader tokens were not persisted (no store configured)'
      return
    }
    try {
      await this.onTokensRefreshed(tokens)
      this.tokenPersistError = null
    } catch (err) {
      this.tokenPersistError = `Rotated cTrader tokens could not be persisted: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  private attach(transport: CtraderTransport): void {
    this.transport = transport
    this.ready = true
    transport.onEvent((message) => this.handleEvent(message))
    transport.onClose((reason) => {
      if (this.transport === transport) this.markDead(`connection lost: ${reason}`)
    })
    if (this.wasDead) {
      this.wasDead = false
      this.stateListener?.({ state: 'alive' })
    }
    for (const listener of this.readyListeners) {
      try { listener() } catch { /* a resubscribe failure must not fail the connect */ }
    }
  }

  /** Close a stale transport without reporting it as a new loss. */
  private discardTransport(): void {
    const transport = this.transport
    this.transport = null
    this.ready = false
    transport?.close()
  }

  private markDead(reason: string): void {
    if (!this.ready) return
    this.discardTransport()
    if (this.closed) return
    this.wasDead = true
    this.stateListener?.({ state: 'dead', error: `cTrader ${reason}` })
  }

  private handleEvent(message: CtraderEnvelope): void {
    const payload = message.payload ?? {}
    const ownId = this.account?.ctidTraderAccountId
    const eventAccount = asNumber(payload['ctidTraderAccountId'])
    if (eventAccount !== undefined && ownId !== undefined && eventAccount !== ownId) return

    switch (message.payloadType) {
      case PayloadType.ACCOUNTS_TOKEN_INVALIDATED_EVENT: {
        const ids = Array.isArray(payload['ctidTraderAccountIds']) ? payload['ctidTraderAccountIds'].map(asNumber) : []
        if (ids.length === 0 || ids.includes(ownId)) {
          const reason = typeof payload['reason'] === 'string' ? `: ${payload['reason']}` : ''
          this.markDead(`access token invalidated${reason}`)
        }
        break
      }
      case PayloadType.CLIENT_DISCONNECT_EVENT: {
        const reason = typeof payload['reason'] === 'string' ? `: ${payload['reason']}` : ''
        this.markDead(`disconnected by server${reason}`)
        break
      }
      case PayloadType.ACCOUNT_DISCONNECT_EVENT:
        this.markDead('account session ended by server')
        break
    }

    for (const listener of this.eventListeners) {
      try { listener(message) } catch { /* isolate listeners */ }
    }
  }
}
