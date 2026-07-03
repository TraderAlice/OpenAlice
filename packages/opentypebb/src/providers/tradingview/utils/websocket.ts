import { WebSocket } from 'undici'
import { OpenBBError } from '../../../core/provider/utils/errors.js'

export interface TradingViewBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

export interface FetchTradingViewBarsOptions {
  symbol: string
  interval: string
  range: number
  to?: number | null
  session?: 'regular' | 'extended'
  timeoutMs?: number
  maxRetries?: number
  retryDelayMs?: number
}

interface TradingViewPacket {
  m?: string
  p?: unknown[]
}

const WS_URL = 'wss://data.tradingview.com/socket.io/websocket?from=chart&type=chart'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
}

class RetryableTradingViewWebSocketError extends OpenBBError {
  constructor(message: string) {
    super(message)
    this.name = 'RetryableTradingViewWebSocketError'
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withAttemptContext(error: unknown, attempt: number, maxAttempts: number): OpenBBError {
  const message = error instanceof Error ? error.message : String(error)
  return new OpenBBError(`${message} (attempt ${attempt}/${maxAttempts})`, error)
}

function sessionId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 14)}`
}

function frame(payload: unknown): string {
  const msg = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return `~m~${msg.length}~m~${msg}`
}

function parseFrames(raw: string): Array<TradingViewPacket | number> {
  return raw
    .replace(/~h~/g, '')
    .split(/~m~[0-9]+~m~/g)
    .filter(Boolean)
    .map((part) => JSON.parse(part) as TradingViewPacket | number)
}

function send(ws: WebSocket, m: string, p: unknown[]): void {
  ws.send(frame({ m, p }))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function parsePriceUpdate(packet: TradingViewPacket): TradingViewBar[] {
  if (packet.m !== 'timescale_update' && packet.m !== 'du') return []
  const series = asRecord(packet.p?.[1])
  const prices = asRecord(series?.['$prices'])
  const rows = Array.isArray(prices?.['s']) ? prices['s'] as unknown[] : []
  const out: TradingViewBar[] = []

  for (const row of rows) {
    const r = asRecord(row)
    const values = Array.isArray(r?.['v']) ? r['v'] as unknown[] : []
    const [time, open, high, low, close, volume] = values
    if (
      typeof time !== 'number' ||
      typeof open !== 'number' ||
      typeof high !== 'number' ||
      typeof low !== 'number' ||
      typeof close !== 'number'
    ) continue
    out.push({
      time,
      open,
      high,
      low,
      close,
      volume: typeof volume === 'number' ? Math.round(volume * 100) / 100 : null,
    })
  }

  return out
}

async function fetchTradingViewBarsOnce(opts: FetchTradingViewBarsOptions): Promise<TradingViewBar[]> {
  const chartSession = sessionId('cs')
  const series = 'ser_1'
  const timeoutMs = opts.timeoutMs ?? 25_000
  const range = Math.max(1, Math.min(Math.floor(opts.range), 10_000))
  const bars = new Map<number, TradingViewBar>()
  let settled = false
  let timer: NodeJS.Timeout | undefined
  let idleTimer: NodeJS.Timeout | undefined
  let ws: WebSocket | undefined

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      if (idleTimer) clearTimeout(idleTimer)
      try { ws?.close() } catch {}
    }
    const sortedBars = () => [...bars.values()].sort((a, b) => a.time - b.time)
    const succeed = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(sortedBars())
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const doneSoon = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        succeed()
      }, 1_500)
    }

    timer = setTimeout(() => {
      fail(new RetryableTradingViewWebSocketError(`TradingView request timed out after ${timeoutMs}ms for ${opts.symbol}`))
    }, timeoutMs)

    ws = new WebSocket(WS_URL, {
      headers: { ...HEADERS, Origin: 'https://www.tradingview.com' },
    })

    ws.addEventListener('open', () => {
      const symbolInit: Record<string, unknown> = {
        symbol: opts.symbol,
        adjustment: 'splits',
      }
      if (opts.session) symbolInit.session = opts.session
      const seriesRange: unknown = opts.to ? ['bar_count', opts.to, range] : range

      send(ws!, 'set_auth_token', ['unauthorized_user_token'])
      send(ws!, 'chart_create_session', [chartSession])
      send(ws!, 'resolve_symbol', [chartSession, series, `=${JSON.stringify(symbolInit)}`])
      send(ws!, 'create_series', [chartSession, '$prices', 's1', series, opts.interval, seriesRange])
    })

    ws.addEventListener('message', (event) => {
      const raw = typeof event.data === 'string' ? event.data : Buffer.from(event.data as ArrayBuffer).toString('utf8')
      let packets: Array<TradingViewPacket | number>
      try {
        packets = parseFrames(raw)
      } catch (error) {
        fail(new OpenBBError(`Failed to parse TradingView websocket packet: ${error instanceof Error ? error.message : String(error)}`))
        return
      }

      for (const packet of packets) {
        if (typeof packet === 'number') {
          ws?.send(frame(`~h~${packet}`))
          continue
        }
        if (packet.m === 'symbol_error') {
          fail(new OpenBBError(`TradingView symbol error for ${opts.symbol}: ${String(packet.p?.[2] ?? 'unknown')}`))
          return
        }
        if (packet.m === 'series_error') {
          fail(new OpenBBError(`TradingView series error for ${opts.symbol}: ${String(packet.p?.[3] ?? 'unknown')}`))
          return
        }
        if (packet.m === 'critical_error' || packet.m === 'protocol_error') {
          fail(new OpenBBError(`TradingView protocol error for ${opts.symbol}: ${JSON.stringify(packet.p ?? [])}`))
          return
        }
        const updates = parsePriceUpdate(packet)
        for (const bar of updates) bars.set(bar.time, bar)
        if (bars.size >= range) {
          succeed()
          return
        }
        if (packet.m === 'series_completed' && bars.size > 0) {
          succeed()
          return
        }
        if (updates.length > 0) doneSoon()
      }
    })

    ws.addEventListener('error', () => {
      fail(new RetryableTradingViewWebSocketError(`TradingView websocket error for ${opts.symbol}`))
    })

    ws.addEventListener('close', () => {
      if (settled) return
      if (bars.size > 0) succeed()
      else fail(new RetryableTradingViewWebSocketError(`TradingView websocket closed before returning bars for ${opts.symbol}`))
    })
  })
}

export async function fetchTradingViewBars(opts: FetchTradingViewBarsOptions): Promise<TradingViewBar[]> {
  const maxRetries = Math.max(0, Math.floor(opts.maxRetries ?? 2))
  const maxAttempts = maxRetries + 1
  const retryDelayMs = Math.max(0, opts.retryDelayMs ?? 250)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetchTradingViewBarsOnce(opts)
    } catch (error) {
      if (!(error instanceof RetryableTradingViewWebSocketError)) throw error
      if (attempt === maxAttempts) throw withAttemptContext(error, attempt, maxAttempts)
      if (retryDelayMs > 0) await sleep(retryDelayMs * attempt)
    }
  }

  throw new OpenBBError(`TradingView websocket retry loop exited unexpectedly for ${opts.symbol}`)
}
