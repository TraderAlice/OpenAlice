/**
 * Market Quote Tools — public, key-less APIs for advisor-mode price/market-state context.
 *
 * Sources (all `Auth: No` from public-apis):
 *   - Binance Public Spot (api.binance.com) — crypto spot ticker + klines
 *   - Stooq (stooq.com)                    — US equity quote CSV (~15min delay)
 *   - Yahoo Finance unofficial             — equity quote/chart JSON (UA gated)
 *
 * Use these for price/state queries that don't need a registered broker
 * account. For real positions/orders use the broker-gated tools in trading.ts.
 */

import { tool } from 'ai'
import { z } from 'zod'

const BINANCE_SPOT = 'https://api.binance.com'
const STOOQ = 'https://stooq.com'
const YAHOO = 'https://query1.finance.yahoo.com'

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const CRYPTO_INTERVAL = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w'] as const
const EQUITY_INTERVAL = ['1m', '5m', '15m', '30m', '1h', '1d', '1wk', '1mo'] as const
const EQUITY_RANGE = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', 'max'] as const

async function fetchJson<T = unknown>(url: string, opts: { timeoutMs?: number; ua?: string } = {}): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000)
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': opts.ua ?? 'OpenAlice/1.0', Accept: 'application/json,text/plain,*/*' },
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`)
    return (await resp.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

async function fetchText(url: string, opts: { timeoutMs?: number; ua?: string } = {}): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000)
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': opts.ua ?? 'OpenAlice/1.0' },
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`)
    return await resp.text()
  } finally {
    clearTimeout(timer)
  }
}

// -------- US market clock --------
// 2026 NYSE full-day closures + early-close (13:00 ET). Source: NYSE published calendar.
const NYSE_2026_CLOSED = new Set<string>([
  '2026-01-01', // New Year's Day
  '2026-01-19', // MLK Day
  '2026-02-16', // Presidents Day
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth
  '2026-07-03', // Independence Day observed (7/4 Sat)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving
  '2026-12-25', // Christmas
])
const NYSE_2026_EARLY_CLOSE = new Set<string>([
  '2026-11-27', // Black Friday
  '2026-12-24', // Christmas Eve
])

function nyseStatus(now = new Date()): {
  status: 'open' | 'pre' | 'after' | 'closed-weekend' | 'closed-holiday'
  et_now: string
  et_date: string
  early_close_today: boolean
} {
  // Convert to America/New_York via locale parts.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, weekday: 'short',
  })
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]))
  const date = `${parts.year}-${parts.month}-${parts.day}`
  const hh = parseInt(parts.hour === '24' ? '00' : parts.hour, 10)
  const mm = parseInt(parts.minute, 10)
  const minutesET = hh * 60 + mm
  const weekday = parts.weekday // Mon..Sun
  const et_now = `${date} ${parts.hour}:${parts.minute}:${parts.second} ET`

  if (weekday === 'Sat' || weekday === 'Sun') {
    return { status: 'closed-weekend', et_now, et_date: date, early_close_today: false }
  }
  if (NYSE_2026_CLOSED.has(date)) {
    return { status: 'closed-holiday', et_now, et_date: date, early_close_today: false }
  }
  const earlyClose = NYSE_2026_EARLY_CLOSE.has(date)
  const open = 9 * 60 + 30
  const close = earlyClose ? 13 * 60 : 16 * 60
  if (minutesET < open) return { status: 'pre', et_now, et_date: date, early_close_today: earlyClose }
  if (minutesET >= close) return { status: 'after', et_now, et_date: date, early_close_today: earlyClose }
  return { status: 'open', et_now, et_date: date, early_close_today: earlyClose }
}

// -------- Stooq CSV parse --------
// Header: Symbol,Date,Time,Open,High,Low,Close,Volume
function parseStooqCsv(csv: string): Array<{
  symbol: string; date: string; time: string;
  open: number; high: number; low: number; close: number; volume: number;
}> {
  const lines = csv.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const out: ReturnType<typeof parseStooqCsv> = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    if (cols.length < 8) continue
    const close = parseFloat(cols[6])
    if (!Number.isFinite(close)) continue
    out.push({
      symbol: cols[0],
      date: cols[1],
      time: cols[2],
      open: parseFloat(cols[3]),
      high: parseFloat(cols[4]),
      low: parseFloat(cols[5]),
      close,
      volume: parseFloat(cols[7]),
    })
  }
  return out
}

export function createMarketQuoteTools() {
  return {
    cryptoSpotQuote: tool({
      description: `Get 24h ticker for a crypto spot pair from Binance public API. No auth, no account needed. Use this for plain price queries (e.g. "ETH price now"). For position/order queries use getQuote/getPortfolio.`,
      inputSchema: z.object({
        symbol: z.string().describe('Binance spot symbol e.g. BTCUSDT, ETHUSDT, SOLUSDT'),
      }),
      execute: async ({ symbol }) => {
        const url = `${BINANCE_SPOT}/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol.toUpperCase())}`
        const d = await fetchJson<{
          symbol: string; lastPrice: string; priceChange: string; priceChangePercent: string;
          highPrice: string; lowPrice: string; openPrice: string; weightedAvgPrice: string;
          volume: string; quoteVolume: string; openTime: number; closeTime: number;
        }>(url)
        return {
          symbol: d.symbol,
          price: parseFloat(d.lastPrice),
          change_24h: parseFloat(d.priceChange),
          change_24h_pct: parseFloat(d.priceChangePercent),
          high_24h: parseFloat(d.highPrice),
          low_24h: parseFloat(d.lowPrice),
          open_24h: parseFloat(d.openPrice),
          vwap_24h: parseFloat(d.weightedAvgPrice),
          base_volume_24h: parseFloat(d.volume),
          quote_volume_24h: parseFloat(d.quoteVolume),
          window_close: new Date(d.closeTime).toISOString(),
        }
      },
    }),

    cryptoSpotKlines: tool({
      description: `Get OHLCV klines for a Binance spot pair. No auth. For technical analysis or recent price action review.`,
      inputSchema: z.object({
        symbol: z.string().describe('Binance spot symbol e.g. BTCUSDT'),
        interval: z.enum(CRYPTO_INTERVAL).optional().describe('Default 1h'),
        limit: z.number().int().positive().max(1000).optional().describe('Default 100'),
      }),
      execute: async ({ symbol, interval, limit }) => {
        const url = `${BINANCE_SPOT}/api/v3/klines?symbol=${encodeURIComponent(symbol.toUpperCase())}&interval=${interval ?? '1h'}&limit=${limit ?? 100}`
        const data = await fetchJson<Array<[number, string, string, string, string, string, number, string, number, string, string, string]>>(url)
        return {
          symbol: symbol.toUpperCase(),
          interval: interval ?? '1h',
          bars: data.map((r) => ({
            open_time: new Date(r[0]).toISOString(),
            open: parseFloat(r[1]),
            high: parseFloat(r[2]),
            low: parseFloat(r[3]),
            close: parseFloat(r[4]),
            volume: parseFloat(r[5]),
            close_time: new Date(r[6]).toISOString(),
          })),
        }
      },
    }),

    equityQuote: tool({
      description: `Get latest US equity quote (Stooq primary, Yahoo unofficial fallback). No auth. ~15 min delayed. Use this for plain price queries (e.g. "MU price now"). For position/order queries use getQuote/getPortfolio.`,
      inputSchema: z.object({
        symbols: z.array(z.string()).min(1).max(20).describe('Tickers e.g. ["MU","SNDK","NVDA"]'),
      }),
      execute: async ({ symbols }) => {
        const upper = symbols.map((s) => s.toUpperCase())
        // Stooq: comma-separated, .us suffix
        const stooqSyms = upper.map((s) => `${s.toLowerCase()}.us`).join(',')
        const stooqUrl = `${STOOQ}/q/l/?s=${stooqSyms}&f=sd2t2ohlcv&h&e=csv`
        try {
          const csv = await fetchText(stooqUrl)
          const rows = parseStooqCsv(csv)
          if (rows.length > 0) {
            return {
              source: 'stooq',
              note: 'Delayed ~15min; close = latest available print',
              quotes: rows.map((r) => ({
                symbol: r.symbol.replace(/\.US$/i, ''),
                price: r.close,
                open: r.open,
                high: r.high,
                low: r.low,
                volume: r.volume,
                as_of: `${r.date} ${r.time}`,
              })),
            }
          }
        } catch (err) {
          // fallthrough to Yahoo
        }
        // Yahoo fallback
        const yUrl = `${YAHOO}/v7/finance/quote?symbols=${encodeURIComponent(upper.join(','))}`
        const y = await fetchJson<{ quoteResponse: { result: Array<{
          symbol: string; regularMarketPrice: number; regularMarketChange: number;
          regularMarketChangePercent: number; regularMarketDayHigh: number;
          regularMarketDayLow: number; regularMarketOpen: number; regularMarketVolume: number;
          marketState: string; regularMarketTime: number;
        }> } }>(yUrl, { ua: BROWSER_UA })
        return {
          source: 'yahoo',
          note: 'Yahoo unofficial; near real-time but no SLA',
          quotes: y.quoteResponse.result.map((q) => ({
            symbol: q.symbol,
            price: q.regularMarketPrice,
            change: q.regularMarketChange,
            change_pct: q.regularMarketChangePercent,
            open: q.regularMarketOpen,
            high: q.regularMarketDayHigh,
            low: q.regularMarketDayLow,
            volume: q.regularMarketVolume,
            market_state: q.marketState,
            as_of: q.regularMarketTime ? new Date(q.regularMarketTime * 1000).toISOString() : null,
          })),
        }
      },
    }),

    equityChart: tool({
      description: `Get historical OHLCV chart for a US equity from Yahoo Finance unofficial endpoint. No auth (UA spoofed). For technical analysis.`,
      inputSchema: z.object({
        symbol: z.string().describe('Ticker e.g. MU, NVDA'),
        interval: z.enum(EQUITY_INTERVAL).optional().describe('Default 1d'),
        range: z.enum(EQUITY_RANGE).optional().describe('Default 3mo'),
      }),
      execute: async ({ symbol, interval, range }) => {
        const url = `${YAHOO}/v8/finance/chart/${encodeURIComponent(symbol.toUpperCase())}?interval=${interval ?? '1d'}&range=${range ?? '3mo'}`
        const d = await fetchJson<{ chart: { result: Array<{
          timestamp: number[];
          indicators: { quote: Array<{ open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] }> };
        }> } }>(url, { ua: BROWSER_UA })
        const r = d.chart.result?.[0]
        if (!r) return { symbol: symbol.toUpperCase(), bars: [] }
        const q = r.indicators.quote[0]
        const bars = r.timestamp.map((t, i) => ({
          time: new Date(t * 1000).toISOString(),
          open: q.open[i],
          high: q.high[i],
          low: q.low[i],
          close: q.close[i],
          volume: q.volume[i],
        })).filter((b) => Number.isFinite(b.close))
        return {
          symbol: symbol.toUpperCase(),
          interval: interval ?? '1d',
          range: range ?? '3mo',
          bars,
        }
      },
    }),

    usMarketStatus: tool({
      description: `Is the US stock market open right now? Computed from America/New_York clock + 2026 NYSE holiday/early-close calendar. No external call.`,
      inputSchema: z.object({}),
      execute: async () => nyseStatus(),
    }),

    cryptoMarketStatus: tool({
      description: `Crypto market is 24/7. Always returns open. Useful for symmetry with usMarketStatus when classifying assets.`,
      inputSchema: z.object({}),
      execute: async () => ({ status: 'open' as const, note: 'Crypto markets trade 24/7' }),
    }),
  }
}
