import type {
  TushareApiName,
  TushareResponseEnvelope,
  TushareRow,
  TushareRuntimeConfig,
  TushareValue,
} from './types.js'
import { createHash } from 'node:crypto'

const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_CACHE_TTL_MS = 60_000

export interface TushareClientOptions {
  getConfig: () => TushareRuntimeConfig | Promise<TushareRuntimeConfig>
  fetch?: typeof globalThis.fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
  retries?: number
  maxConcurrency?: number
  minIntervalMs?: number
}

interface CacheEntry {
  expiresAt: number
  rows: TushareRow[]
}

export function validateTushareBaseUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error('Invalid Tushare endpoint URL')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Tushare endpoint must not contain credentials, a query string, or a fragment')
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
    throw new Error('Tushare endpoint must use HTTPS (HTTP is allowed only for loopback development)')
  }
  return url.toString()
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, stable(nested)]),
    )
  }
  return value
}

function rowsFromEnvelope(envelope: TushareResponseEnvelope): TushareRow[] {
  const fields = envelope.data?.fields
  const items = envelope.data?.items
  if (!Array.isArray(fields) || !fields.every((field) => typeof field === 'string')) {
    throw new Error('Tushare returned an invalid fields array')
  }
  if (!Array.isArray(items)) throw new Error('Tushare returned an invalid items array')
  return items.map((item) => {
    if (!Array.isArray(item)) throw new Error('Tushare returned an invalid data row')
    const row: TushareRow = {}
    fields.forEach((field, index) => {
      const value = item[index]
      if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
        row[field] = (value ?? null) as TushareValue
      }
    })
    return row
  })
}

export class TushareClient {
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inflight = new Map<string, Promise<TushareRow[]>>()
  private readonly waiters: Array<() => void> = []
  private active = 0
  private nextRequestAt = 0

  constructor(private readonly options: TushareClientOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  clearCache(): void {
    this.cache.clear()
  }

  async query(
    apiName: TushareApiName,
    params: Record<string, unknown> = {},
    fields?: readonly string[],
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  ): Promise<TushareRow[]> {
    const config = await this.options.getConfig()
    if (!config.enabled) throw new Error('Tushare provider is disabled')
    const token = config.token?.trim()
    if (!token) throw new Error('Tushare token is not configured')
    const baseUrl = validateTushareBaseUrl(config.baseUrl)
    // Rotation must take effect even while a previous credential's response is
    // cached. Use a non-reversible fingerprint; never retain the token in a
    // cache key or diagnostic string.
    const credential = createHash('sha256').update(token).digest('hex')
    const cacheKey = JSON.stringify(stable({ baseUrl, credential, apiName, params, fields }))
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > this.now()) return cached.rows.map((row) => ({ ...row }))
    const pending = this.inflight.get(cacheKey)
    if (pending) return (await pending).map((row) => ({ ...row }))

    const request = this.limited(() => this.request(baseUrl, token, apiName, params, fields))
      .then((rows) => {
        if (cacheTtlMs > 0) this.cache.set(cacheKey, { expiresAt: this.now() + cacheTtlMs, rows })
        return rows
      })
      .finally(() => this.inflight.delete(cacheKey))
    this.inflight.set(cacheKey, request)
    return (await request).map((row) => ({ ...row }))
  }

  private async limited<T>(operation: () => Promise<T>): Promise<T> {
    const max = Math.max(1, this.options.maxConcurrency ?? 2)
    if (this.active >= max) await new Promise<void>((resolve) => this.waiters.push(resolve))
    this.active += 1
    try {
      const delay = Math.max(0, this.nextRequestAt - this.now())
      if (delay > 0) await this.sleep(delay)
      this.nextRequestAt = this.now() + Math.max(0, this.options.minIntervalMs ?? 100)
      return await operation()
    } finally {
      this.active -= 1
      this.waiters.shift()?.()
    }
  }

  private async request(
    baseUrl: string,
    token: string,
    apiName: TushareApiName,
    params: Record<string, unknown>,
    fields?: readonly string[],
  ): Promise<TushareRow[]> {
    const attempts = Math.max(1, (this.options.retries ?? 2) + 1)
    let lastError: Error | undefined
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(baseUrl, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ api_name: apiName, token, params, fields: fields?.join(',') ?? '' }),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        })
        if (!response.ok) {
          const error = new Error(`Tushare HTTP ${response.status}`)
          if (response.status === 429 || response.status >= 500) throw error
          throw Object.assign(error, { retryable: false })
        }
        const envelope = await response.json() as TushareResponseEnvelope
        const code = typeof envelope.code === 'number' ? envelope.code : Number(envelope.code)
        if (!Number.isFinite(code)) throw new Error('Tushare returned an invalid response envelope')
        if (code !== 0) {
          const message = typeof envelope.msg === 'string' && envelope.msg.trim()
            ? envelope.msg.replaceAll(token, '[redacted]')
            : `API error ${code}`
          throw Object.assign(new Error(`Tushare ${message}`), { retryable: false })
        }
        return rowsFromEnvelope(envelope)
      } catch (error) {
        const raw = error instanceof Error ? error : new Error(String(error))
        lastError = new Error(raw.message.replaceAll(token, '[redacted]'))
        if ((error as { retryable?: boolean }).retryable === false || attempt === attempts - 1) break
        await this.sleep(250 * (2 ** attempt))
      }
    }
    throw lastError ?? new Error('Tushare request failed')
  }
}
