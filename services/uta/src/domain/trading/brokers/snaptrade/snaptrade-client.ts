import { createHmac } from 'node:crypto'
import type { SnapTradeConnection, SnapTradePositionResponse } from './snaptrade-read-model.js'

export interface SnapTradePersonalCredentials {
  clientId: string
  consumerKey: string
}

export interface SnapTradeRequestOptions {
  method?: 'GET' | 'POST' | 'DELETE'
  /** Exact query sequence for a provider endpoint, excluding auth fields. */
  query?: readonly [string, string][]
  body?: unknown
}

export class SnapTradeApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly requestId?: string,
  ) {
    super(message)
    this.name = 'SnapTradeApiError'
  }
}

/**
 * Minimal signed-request client for SnapTrade Personal accounts.
 *
 * It deliberately does not expose an order-placement helper. Consumers must
 * use its read-only `get` method until a separately reviewed trading design
 * exists. Personal keys identify the account owner directly: no userId or
 * userSecret is ever accepted or sent.
 */
export class SnapTradeClient {
  static readonly apiOrigin = 'https://api.snaptrade.com'

  constructor(
    private readonly credentials: SnapTradePersonalCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async get<T>(path: string, query: readonly [string, string][] = []): Promise<T> {
    return this.request<T>(path, { method: 'GET', query })
  }

  /** List provider connections for this Personal key. Never registers a user. */
  async listConnections(): Promise<SnapTradeConnection[]> {
    return this.get<SnapTradeConnection[]>('/authorizations')
  }

  /** Read the unified v2 position endpoint for one immutable SnapTrade account. */
  async getAllAccountPositions(accountId: string): Promise<SnapTradePositionResponse> {
    if (!accountId) throw new Error('SnapTrade accountId is required')
    return this.get<SnapTradePositionResponse>(`/accounts/${encodeURIComponent(accountId)}/positions/all`)
  }

  async request<T>(path: string, options: SnapTradeRequestOptions = {}): Promise<T> {
    if (!path.startsWith('/')) throw new Error('SnapTrade request path must start with /')
    if (!this.credentials.clientId || !this.credentials.consumerKey) {
      throw new Error('SnapTrade clientId and consumerKey are required')
    }

    const method = options.method ?? 'GET'
    const timestamp = Math.floor(this.now() / 1000).toString()
    const query = [
      ...(options.query ?? []),
      ['clientId', this.credentials.clientId] as [string, string],
      ['timestamp', timestamp] as [string, string],
    ]
    const rawQuery = query.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')
    const content = options.body && isNonEmptyObject(options.body) ? options.body : null
    const signature = signSnapTradeRequest({ path, query: rawQuery, content }, this.credentials.consumerKey)
    const response = await this.fetchImpl(`${SnapTradeClient.apiOrigin}${path}?${rawQuery}`, {
      method,
      headers: {
        Accept: 'application/json',
        Signature: signature,
        ...(content ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(content ? { body: JSON.stringify(content) } : {}),
    })

    if (!response.ok) {
      const detail = await response.text()
      throw new SnapTradeApiError(
        response.status,
        `SnapTrade request failed (${response.status})${detail ? `: ${detail}` : ''}`,
        response.headers.get('x-request-id') ?? undefined,
      )
    }
    return await response.json() as T
  }
}

export function signSnapTradeRequest(
  payload: { path: string; query: string; content: unknown },
  consumerKey: string,
): string {
  const canonical = canonicalJson({
    content: payload.content && isNonEmptyObject(payload.content) ? payload.content : null,
    path: payload.path,
    query: payload.query,
  })
  return createHmac('sha256', consumerKey).update(canonical, 'utf8').digest('base64')
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, sortKeys(child)]))
}

function isNonEmptyObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
}
