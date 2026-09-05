import { describe, it, expect, vi } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, BarData, UNSET_DECIMAL } from '@traderalice/ibkr'
import { IbkrBroker } from './IbkrBroker.js'
import {
  IBKR_BAR_SIZE,
  buildHistoricalRequest,
  classifyHistoricalError,
  decodeBars,
  formatDuration,
  formatEndDateTime,
  parseBarDate,
} from './ibkr-historical.js'
import type { BarParams } from '../types.js'

const NOW = new Date('2026-09-03T16:00:00.000Z')

function bar(dateSeconds: number, o: number, h: number, l: number, c: number, v: string | null): BarData {
  const b = new BarData()
  b.date = String(dateSeconds)
  b.open = o
  b.high = h
  b.low = l
  b.close = c
  b.volume = v == null ? UNSET_DECIMAL : new Decimal(v)
  return b
}

// ==================== Request mapping ====================

describe('IBKR historical — request mapping', () => {
  it('maps every OpenAlice interval to a native TWS bar size', () => {
    expect(IBKR_BAR_SIZE).toEqual({
      '1m': '1 min',
      '5m': '5 mins',
      '15m': '15 mins',
      '30m': '30 mins',
      '1h': '1 hour',
      '4h': '4 hours',
      '1d': '1 day',
      '1w': '1 week',
    })
  })

  it('derives a duration from limit when no window is given, and leaves endDateTime empty for "now"', () => {
    const req = buildHistoricalRequest({ interval: '1m', limit: 60 }, NOW)
    expect(req).toEqual({
      endDateTime: '',
      // Widened into calendar time and floored at 4 days so a Saturday request
      // still reaches Friday, then clamped to the 1 D ceiling for `1 min` bars.
      durationStr: '1 D',
      barSizeSetting: '1 min',
      whatToShow: 'TRADES',
      useRTH: 0,
      formatDate: 2,
    })
  })

  it('derives the duration from an explicit start/end window', () => {
    const req = buildHistoricalRequest({
      interval: '1h',
      start: new Date('2026-08-27T16:00:00.000Z'),
      end: new Date('2026-09-03T16:00:00.000Z'),
    }, NOW)
    expect(req.durationStr).toBe('7 D')
    expect(req.endDateTime).toBe('20260903-16:00:00')
    expect(req.barSizeSetting).toBe('1 hour')
  })

  it('honors whatToShow from params, defaulting to TRADES', () => {
    expect(buildHistoricalRequest({ interval: '1d', limit: 5 }, NOW))
      .toMatchObject({ whatToShow: 'TRADES' })
    expect(buildHistoricalRequest({ interval: '1d', limit: 5, whatToShow: 'MIDPOINT' }, NOW))
      .toMatchObject({ whatToShow: 'MIDPOINT' })
  })

  // The session arrives already resolved; the adapter only translates it to
  // TWS's flag.
  it('maps a regular session to useRTH 1 and an extended one to 0', () => {
    expect(buildHistoricalRequest({ interval: '1d', limit: 5, session: 'regular' }, NOW).useRTH).toBe(1)
    expect(buildHistoricalRequest({ interval: '1d', limit: 5, session: 'extended' }, NOW).useRTH).toBe(0)
  })

  it('treats an unresolved session as the continuous tape', () => {
    expect(buildHistoricalRequest({ interval: '1d', limit: 5 }, NOW).useRTH).toBe(0)
  })

  it('keeps the MIDPOINT default for CASH and CFD regardless of session', () => {
    expect(buildHistoricalRequest({ interval: '1d', limit: 5, session: 'extended' }, NOW, 'CASH').whatToShow).toBe('MIDPOINT')
    expect(buildHistoricalRequest({ interval: '1d', limit: 5, session: 'extended' }, NOW, 'CFD').whatToShow).toBe('MIDPOINT')
  })

  // TWS rejects an over-long duration outright (162) rather than truncating.
  it('clamps a duration beyond the per-bar-size ceiling', () => {
    const req = buildHistoricalRequest({
      interval: '1m',
      start: new Date('2025-09-03T16:00:00.000Z'),
      end: new Date('2026-09-03T16:00:00.000Z'),
    }, NOW)
    expect(req.durationStr).toBe('1 D')
  })

  // The ceilings come from TWS's duration↔bar-size table, and exceeding one is
  // a hard 162 for the whole request rather than a truncated answer.
  it('clamps each bar size to the duration TWS actually accepts for it', () => {
    const year = 400 * 86_400_000
    expect(formatDuration(year, '1m')).toBe('1 D')
    expect(formatDuration(year, '5m')).toBe('7 D')
    expect(formatDuration(year, '15m')).toBe('7 D')
    expect(formatDuration(year, '30m')).toBe('30 D')
    expect(formatDuration(year, '1h')).toBe('30 D')
    expect(formatDuration(year, '4h')).toBe('30 D')
    expect(formatDuration(year, '1d')).toBe('365 D')
    // Past a year TWS expects the `Y` unit rather than an oversized `D`.
    expect(formatDuration(year, '1w')).toBe('2 Y')
  })

  // The documented `S` buckets stop at 28800 S (8 hours), and a longer seconds
  // request is an unlisted pairing rather than a wider window.
  it('switches from seconds to days past the 8-hour S bucket', () => {
    expect(formatDuration(8 * 3_600_000, '5m')).toBe('28800 S')
    expect(formatDuration(8 * 3_600_000 + 1_000, '5m')).toBe('1 D')
  })

  it('never emits a zero-length duration', () => {
    expect(formatDuration(0, '1m')).toBe('60 S')
    // `S` is only valid with an intraday bar size, so a daily request that
    // rounds to under a day is still expressed in days.
    expect(formatDuration(-5, '1d')).toBe('1 D')
  })

  // TWS rejects an `S` duration paired with a daily/weekly bar size outright,
  // so a one-day daily window must not render as "86400 S".
  it('never expresses a daily or weekly duration in seconds', () => {
    expect(buildHistoricalRequest({
      interval: '1d',
      start: new Date('2026-09-02T16:00:00.000Z'),
      end: new Date('2026-09-03T16:00:00.000Z'),
    }, NOW).durationStr).toBe('1 D')
    expect(formatDuration(1_000, '1w')).toBe('7 D')
    expect(formatDuration(20 * 3_600_000, '1d')).toBe('1 D')
  })

  // Spot FX has no TRADES stream; TWS answers 162 instead of substituting one.
  it('defaults CASH contracts to MIDPOINT and everything else to TRADES', () => {
    expect(buildHistoricalRequest({ interval: '1h', limit: 5 }, NOW, 'CASH').whatToShow).toBe('MIDPOINT')
    expect(buildHistoricalRequest({ interval: '1h', limit: 5 }, NOW, 'STK').whatToShow).toBe('TRADES')
    expect(buildHistoricalRequest({ interval: '1h', limit: 5, whatToShow: 'BID' }, NOW, 'CASH').whatToShow).toBe('BID')
  })

  // A wall-clock window of exactly N intervals returns nothing at all when the
  // request lands on a weekend.
  it('widens an intraday limit window into calendar time so a closed session still returns bars', () => {
    expect(buildHistoricalRequest({ interval: '5m', limit: 100 }, NOW).durationStr).toBe('4 D')
    expect(buildHistoricalRequest({ interval: '1d', limit: 100 }, NOW).durationStr).toBe('153 D')
  })

  it('formats endDateTime as the UTC yyyyMMdd-HH:mm:ss form TWS expects', () => {
    expect(formatEndDateTime(new Date('2026-01-09T05:06:07.899Z'))).toBe('20260109-05:06:07')
  })
})

// ==================== Bar decoding ====================

describe('IBKR historical — bar decoding', () => {
  it('decodes epoch-second bars into the protocol shape', () => {
    const params: BarParams = { interval: '1h' }
    const bars = decodeBars([bar(1_772_553_600, 1.5, 2, 1.25, 1.75, '1234')], params)
    expect(bars).toEqual([{
      timestamp: new Date('2026-03-03T16:00:00.000Z'),
      open: '1.5',
      high: '2',
      low: '1.25',
      close: '1.75',
      volume: '1234',
    }])
  })

  it('accepts the YYYYMMDD form some gateways return for daily bars', () => {
    expect(parseBarDate('20260903')).toEqual(new Date('2026-09-03T00:00:00.000Z'))
  })

  // MIDPOINT/BID/ASK bars carry no size, and the sentinel must never reach the
  // agent boundary as a volume.
  it('renders an UNSET volume as 0 rather than the IBKR sentinel', () => {
    const [decoded] = decodeBars([bar(1_772_553_600, 1, 1, 1, 1, null)], { interval: '1h' })
    expect(decoded!.volume).toBe('0')
  })

  it('re-bounds the response to the requested window and tail-slices to limit', () => {
    const hour = 3_600
    const base = 1_772_553_600
    const raw = [0, 1, 2, 3, 4].map(i => bar(base + i * hour, i, i, i, i, '1'))
    const bars = decodeBars(raw, {
      interval: '1h',
      start: new Date((base + hour) * 1000),
      end: new Date((base + 3 * hour) * 1000),
      limit: 2,
    })
    expect(bars.map(b => b.close)).toEqual(['2', '3'])
  })

  it('returns bars in ascending time order', () => {
    const hour = 3_600
    const base = 1_772_553_600
    const raw = [bar(base + hour, 2, 2, 2, 2, '1'), bar(base, 1, 1, 1, 1, '1')]
    expect(decodeBars(raw, { interval: '1h' }).map(b => b.close)).toEqual(['1', '2'])
  })
})

// ==================== Error 162 triage ====================

describe('IBKR historical — error 162 triage', () => {
  it('separates an empty window, a pacing violation, and a real failure', () => {
    expect(classifyHistoricalError(new Error('IBKR error 162: HMDS query returned no data'))).toBe('empty')
    expect(classifyHistoricalError(
      new Error('IBKR error 162: Historical Market Data Service error message:Historical data request pacing violation'),
    )).toBe('pacing')
    expect(classifyHistoricalError(
      new Error('IBKR error 162: Historical Market Data Service error message:invalid step'),
    )).toBe('error')
    expect(classifyHistoricalError(new Error('IBKR error 200: No security definition found'))).toBe('error')
  })
})

// ==================== Broker wiring ====================

function historicalBroker(bars: BarData[] | Error): {
  broker: IbkrBroker
  client: { reqHistoricalData: ReturnType<typeof vi.fn>; cancelHistoricalData: ReturnType<typeof vi.fn> }
} {
  const broker = new IbkrBroker({ id: 'ibkr-test', host: '127.0.0.1', port: 7497, clientId: 91 })
  const bridge = {
    connectionDead: false,
    allocReqId: vi.fn(() => 10_001),
    requestHistoricalBars: vi.fn(async () => {
      if (bars instanceof Error) throw bars
      return bars
    }),
  }
  const client = {
    reqHistoricalData: vi.fn(),
    cancelHistoricalData: vi.fn(),
  }
  ;(broker as unknown as { bridge: unknown }).bridge = bridge
  ;(broker as unknown as { client: unknown }).client = client
  return { broker, client }
}

function aapl(): Contract {
  const c = new Contract()
  c.symbol = 'AAPL'
  c.secType = 'STK'
  return c
}

describe('IbkrBroker — getHistorical', () => {
  it('issues one reqHistoricalData with the mapped arguments and decodes the bars', async () => {
    const { broker, client } = historicalBroker([bar(1_772_553_600, 1, 2, 0.5, 1.5, '10')])

    const bars = await broker.getHistorical(aapl(), { interval: '15m', limit: 4 })

    expect(client.reqHistoricalData).toHaveBeenCalledOnce()
    const [reqId, contract, endDateTime, durationStr, barSize, whatToShow, useRTH, formatDate, keepUpToDate]
      = client.reqHistoricalData.mock.calls[0] as unknown[]
    expect(reqId).toBe(10_001)
    expect((contract as Contract).symbol).toBe('AAPL')
    // Routing defaults are applied at the write boundary, same as quotes.
    expect((contract as Contract).exchange).toBe('SMART')
    expect(endDateTime).toBe('')
    expect(durationStr).toBe('4 D')
    expect(barSize).toBe('15 mins')
    expect(whatToShow).toBe('TRADES')
    expect(useRTH).toBe(0)
    expect(formatDate).toBe(2)
    expect(keepUpToDate).toBe(false)
    expect(bars).toHaveLength(1)
    expect(bars[0]!.close).toBe('1.5')
  })

  it('returns an empty series (not a failure) when TWS reports no data', async () => {
    const { broker } = historicalBroker(new Error('IBKR error 162: HMDS query returned no data'))
    await expect(broker.getHistorical(aapl(), { interval: '1d', limit: 5 })).resolves.toEqual([])
  })

  it('reports a pacing violation as a transient NETWORK error', async () => {
    const { broker, client } = historicalBroker(
      new Error('IBKR error 162: Historical data request pacing violation'),
    )
    await expect(broker.getHistorical(aapl(), { interval: '1m', limit: 5 }))
      .rejects.toMatchObject({ code: 'NETWORK' })
    expect(client.cancelHistoricalData).toHaveBeenCalledWith(10_001)
  })

  it('serializes concurrent requests so TWS sees one query at a time', async () => {
    const { broker, client } = historicalBroker([])
    let inFlight = 0
    let maxInFlight = 0
    ;(broker as unknown as { bridge: { requestHistoricalBars: unknown } }).bridge.requestHistoricalBars =
      vi.fn(async () => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise(resolve => setTimeout(resolve, 5))
        inFlight -= 1
        return []
      })

    await Promise.all([
      broker.getHistorical(aapl(), { interval: '1h', limit: 2 }),
      broker.getHistorical(aapl(), { interval: '1h', limit: 2 }),
      broker.getHistorical(aapl(), { interval: '1h', limit: 2 }),
    ])

    expect(maxInFlight).toBe(1)
    expect(client.reqHistoricalData).toHaveBeenCalledTimes(3)
  })

  // The serializing queue chains every request onto the previous promise, so a
  // rejection left to propagate would wedge every later query.
  it('keeps serving requests after one rejects', async () => {
    const { broker } = historicalBroker([])
    const bridge = (broker as unknown as { bridge: { requestHistoricalBars: unknown } }).bridge
    bridge.requestHistoricalBars = vi.fn()
      .mockRejectedValueOnce(new Error('IBKR error 162: Historical Market Data Service error message:invalid step'))
      .mockResolvedValue([bar(1_772_553_600, 1, 1, 1, 1, '1')])

    await expect(broker.getHistorical(aapl(), { interval: '1h', limit: 2 })).rejects.toThrow(/invalid step/)
    await expect(broker.getHistorical(aapl(), { interval: '1h', limit: 2 })).resolves.toHaveLength(1)
  })

  it('declares the historicalBars capability with its real bar sizes', () => {
    const { broker } = historicalBroker([])
    const caps = broker.getCapabilities().historicalBars
    expect(caps).toEqual({
      supported: true,
      quality: 'subscription',
      supportedBarSizes: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'],
      sessions: ['regular', 'extended'],
    })
  })
})
