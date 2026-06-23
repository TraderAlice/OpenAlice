/**
 * load-twstock-bars — pull historical minute K-line data from the Fugle MCP
 * server and persist it as JSONL Bar[] that the backtest engine can consume.
 *
 * Usage (from repo root):
 *
 *   pnpm tsx scripts/load-twstock-bars.ts \
 *     --symbol 2330 \
 *     --timeframe 5 \
 *     --from 2026-03-01 \
 *     --to   2026-04-09
 *
 * Output goes to:
 *   data/bars/{symbol}-{timeframe}m-{from}-{to}.jsonl
 *
 * One Bar per line, shape matches src/domain/backtest/types.ts:
 *   { ts, open, high, low, close, volume }
 *
 * Design notes:
 * - Uses the existing TwstockMcpClient instead of raw HTTP so we inherit the
 *   streamable-HTTP session handshake. The Fugle MCP server exposes the same
 *   `get_historical_candles` tool regardless of front-door branding.
 * - Parsing is defensive — the Fugle response shape varies across endpoints
 *   (sometimes `{data: [...]}`, sometimes a flat array, sometimes wrapped in
 *   `candles`). We probe for all three.
 * - Timestamps are normalised to epoch milliseconds. If the source emits a
 *   string date, we parse it as local Taipei time first.
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { TwstockMcpClient } from '../src/domain/twstock/client.js'
import { readFugleConfig } from '../src/domain/fugle/config.js'
import type { Bar } from '../src/domain/backtest/types.js'

// ==================== CLI parsing ====================

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      symbol: { type: 'string' },
      timeframe: { type: 'string', default: '5' },
      from: { type: 'string' },
      to: { type: 'string' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })

  if (values.help || !values.symbol || !values.from || !values.to) {
    console.log(`Usage:
  pnpm tsx scripts/load-twstock-bars.ts --symbol <code> --from <YYYY-MM-DD> --to <YYYY-MM-DD> [--timeframe 1|3|5|10|15|30|60|D] [--out path]

Examples:
  pnpm tsx scripts/load-twstock-bars.ts --symbol 2330 --from 2026-03-01 --to 2026-04-09
  pnpm tsx scripts/load-twstock-bars.ts --symbol 2330 --timeframe 1 --from 2026-04-08 --to 2026-04-09
`)
    process.exit(values.help ? 0 : 1)
  }

  return {
    symbol: values.symbol!,
    timeframe: values.timeframe ?? '5',
    from: values.from!,
    to: values.to!,
    out: values.out,
  }
}

// ==================== Response parsing ====================

/**
 * Raw candle row. Fugle's historical endpoint uses single-letter field names
 * (`d/o/h/l/c/v`); other remote MCPs sometimes ship the long form
 * (`date/open/high/low/close/volume`). We accept both.
 */
interface RawCandle {
  // short form (Fugle historical)
  d?: string
  o?: number | string
  h?: number | string
  l?: number | string
  c?: number | string
  v?: number | string
  // long form (fallback)
  date?: string
  time?: string
  timestamp?: number | string
  ts?: number | string
  open?: number | string
  high?: number | string
  low?: number | string
  close?: number | string
  volume?: number | string
}

/** Find the candle array inside an unknown response payload. */
function findCandleArray(payload: unknown): RawCandle[] {
  if (Array.isArray(payload)) return payload as RawCandle[]
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>
    // Common wrapper keys observed on Fugle-style responses
    for (const key of ['data', 'candles', 'bars', 'result', 'items']) {
      if (Array.isArray(obj[key])) return obj[key] as RawCandle[]
    }
    // Sometimes wrapped inside data.data or similar
    for (const key of ['data', 'result']) {
      const inner = obj[key]
      if (inner && typeof inner === 'object') {
        const nested = findCandleArray(inner)
        if (nested.length > 0) return nested
      }
    }
  }
  return []
}

/** Convert a raw candle row to our Bar type, returning null on unparseable input. */
function toBar(raw: RawCandle): Bar | null {
  const tsRaw = raw.ts ?? raw.timestamp ?? raw.date ?? raw.d ?? raw.time
  if (tsRaw == null) return null

  let ts: number
  if (typeof tsRaw === 'number') {
    // Epoch seconds vs ms — anything below year 2100 in seconds
    ts = tsRaw < 2_000_000_000 ? tsRaw * 1000 : tsRaw
  } else {
    // ISO string or "YYYY-MM-DD HH:mm:ss" (with or without timezone offset)
    const parsed = Date.parse(String(tsRaw))
    if (Number.isNaN(parsed)) return null
    ts = parsed
  }

  const open = Number(raw.open ?? raw.o)
  const high = Number(raw.high ?? raw.h)
  const low = Number(raw.low ?? raw.l)
  const close = Number(raw.close ?? raw.c)
  const volume = Number(raw.volume ?? raw.v ?? 0)

  if (![open, high, low, close].every(Number.isFinite)) return null

  return { ts, open, high, low, close, volume }
}

// ==================== Main ====================

async function main() {
  const args = parseCliArgs()
  const { symbol, timeframe, from, to } = args

  const fugleConfig = await readFugleConfig()
  if (!fugleConfig.enabled || !fugleConfig.mcpUrl) {
    console.error('Fugle MCP is disabled or no mcpUrl configured in data/config/fugle.json')
    process.exit(1)
  }

  console.log(`Fugle MCP: ${fugleConfig.mcpUrl}`)
  console.log(`Request:   symbol=${symbol} timeframe=${timeframe} from=${from} to=${to}`)
  console.log('')

  const client = new TwstockMcpClient(fugleConfig.mcpUrl)

  try {
    const start = Date.now()
    const raw = await client.callTool('get_historical_candles', {
      symbol,
      timeframe,
      from_date: from,
      to_date: to,
    })
    const elapsed = Date.now() - start

    const rawCandles = findCandleArray(raw)
    if (rawCandles.length === 0) {
      console.error('Fugle returned no candle data. Raw response preview:')
      console.error(JSON.stringify(raw).slice(0, 400))
      process.exit(2)
    }

    const bars: Bar[] = []
    let skipped = 0
    for (const rc of rawCandles) {
      const bar = toBar(rc)
      if (bar) bars.push(bar)
      else skipped += 1
    }

    // Fugle sometimes returns newest-first; enforce ascending order
    bars.sort((a, b) => a.ts - b.ts)

    if (bars.length === 0) {
      console.error(`All ${rawCandles.length} candles failed to parse. Sample row:`)
      console.error(JSON.stringify(rawCandles[0]))
      process.exit(3)
    }

    // ---------- Report ----------
    const first = bars[0]
    const last = bars[bars.length - 1]
    console.log(`Received  ${rawCandles.length} raw rows, parsed ${bars.length} bars (skipped ${skipped}) in ${elapsed}ms`)
    console.log(`Range:    ${new Date(first.ts).toISOString()} → ${new Date(last.ts).toISOString()}`)
    console.log(`Price:    first close ${first.close}, last close ${last.close}`)
    console.log('')

    // ---------- Write JSONL ----------
    const outPath = args.out
      ? resolve(args.out)
      : resolve(`data/bars/${symbol}-${timeframe}m-${from}-${to}.jsonl`)
    await mkdir(dirname(outPath), { recursive: true })
    const jsonl = bars.map((b) => JSON.stringify(b)).join('\n') + '\n'
    await writeFile(outPath, jsonl)
    console.log(`Wrote ${bars.length} bars to ${outPath}`)
  } finally {
    await client.close()
  }
}

main().catch((err) => {
  console.error('load-twstock-bars failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
