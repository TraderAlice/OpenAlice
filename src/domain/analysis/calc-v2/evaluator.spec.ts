import { describe, it, expect } from 'vitest'
import { runScript } from './index.js'
import type { BarService, BarsResult, GetBarsOpts } from '../../market-data/bars/index.js'

/** Mock bar service: close = the given series, OHLCV derived. */
function mockBars(closes: number[], barId = 'yfinance|AAPL'): BarService {
  const bars = closes.map((c, i) => ({
    date: `2024-01-${String(i + 1).padStart(2, '0')}`,
    open: c, high: c + 1, low: c - 1, close: c, volume: 100 + i,
  }))
  return {
    searchBarSources: async () => [],
    getBars: async (_ref: unknown, opts: GetBarsOpts): Promise<BarsResult> => ({
      bars: opts.count ? bars.slice(-opts.count) : bars,
      meta: { symbol: 'AAPL', from: bars[0].date, to: bars[bars.length - 1].date, bars: bars.length, source: 'vendor', sourceId: 'yfinance', barId, provider: 'yfinance', barCapability: 'delayed' },
    }),
  } as unknown as BarService
}

/** Mock bar service whose getBars always rejects — simulates a vendor failure. */
function failingBars(message: string): BarService {
  return {
    searchBarSources: async () => [],
    getBars: async () => { throw new Error(message) },
  } as unknown as BarService
}

const run = (script: string, svc: BarService) => runScript(script, { barService: svc })

describe('calc-v2 evaluator', () => {
  it('computes SMA over a bound series', async () => {
    const r = await run(`s = bars("yfinance|AAPL", "1d", asset="equity")\nsma(s.close, 3)`, mockBars([1, 2, 3, 4, 5]))
    expect(r.error).toBeUndefined()
    expect(r.value).toBe(4) // (3+4+5)/3
  })

  it('indexes the latest / n-back value', async () => {
    const svc = mockBars([1, 2, 3, 4, 5])
    expect((await run(`s = bars("x","1d",asset="equity")\ns.close[-1]`, svc)).value).toBe(5)
    expect((await run(`s = bars("x","1d",asset="equity")\ns.close[-2]`, svc)).value).toBe(4)
  })

  it('does arithmetic across reduced series', async () => {
    const r = await run(`s = bars("x","1d",asset="equity")\ns.close[-1] - sma(s.close, 3)`, mockBars([1, 2, 3, 4, 5]))
    expect(r.value).toBe(1) // 5 - 4
  })

  it('reports source(s) in dataRange keyed by barId', async () => {
    const r = await run(`s = bars("yfinance|AAPL","1d",asset="equity")\nsma(s.close, 2)`, mockBars([1, 2, 3]))
    expect(Object.keys(r.dataRange!)).toEqual(['yfinance|AAPL'])
    expect(r.dataRange!['yfinance|AAPL']).toMatchObject({ source: 'vendor', sourceId: 'yfinance', barCapability: 'delayed' })
  })

  it('insufficient-bars when the period exceeds available bars', async () => {
    const r = await run(`s = bars("x","1d",asset="equity")\nsma(s.close, 100)`, mockBars([1, 2, 3]))
    expect(r.value).toBeUndefined()
    expect(r.error?.kind).toBe('insufficient-bars')
    expect(r.error?.message).toMatch(/needs ≥100 bars/)
  })

  // issue #375: a failed K-line fetch is an upstream/data problem, not a script
  // bug. The quant calculator (an AI harness) must hand the agent a clean signal
  // (kind:"data-source" + an operational suggestion), not a misleading "type".
  describe('bars() fetch failures surface as kind:"data-source"', () => {
    it('passes the real rate-limit cause through and suggests retry/switch (not a script edit)', async () => {
      const rl = 'RATE_LIMITED: HTTP 429 Yahoo Finance refused to serve this client for "MU" (Edge: Too Many Requests). This is NOT a missing-data condition.'
      const r = await run(`s = bars("yfinance|MU","1d",asset="equity")\nsma(s.close, 50)`, failingBars(rl))
      expect(r.value).toBeUndefined()
      expect(r.error?.kind).toBe('data-source')
      expect(r.error?.message).toContain('bars("yfinance|MU") failed')
      expect(r.error?.message).toContain('RATE_LIMITED')        // real cause reaches the agent
      expect(r.error?.suggestion).toMatch(/retry|switch source/i)
      expect(r.error?.suggestion).toMatch(/not a script error/i)
    })

    it('flags a network failure as data-source with a do-not-retry-blindly hint', async () => {
      const r = await run(
        `s = bars("yfinance|AAPL","1d",asset="equity")\nsma(s.close, 50)`,
        failingBars('NETWORK_UNREACHABLE: cannot reach finance.yahoo.com from this machine (ENOTFOUND).'),
      )
      expect(r.error?.kind).toBe('data-source')
      expect(r.error?.suggestion).toMatch(/unreachable|different source|network/i)
    })

    it('falls back to a barId/availability hint for an unrecognized fetch error', async () => {
      const r = await run(
        `s = bars("bogus","1d",asset="equity")\nsma(s.close, 50)`,
        failingBars('Invalid barId "bogus" (expected "sourceId|nativeSymbol")'),
      )
      expect(r.error?.kind).toBe('data-source')
      expect(r.error?.suggestion).toMatch(/barId/)
    })
  })

  it('unknown-function with did-you-mean', async () => {
    const r = await run(`s = bars("x","1d",asset="equity")\nsmaa(s.close, 3)`, mockBars([1, 2, 3]))
    expect(r.error?.kind).toBe('unknown-function')
    expect(r.error?.suggestion).toMatch(/sma/)
  })

  it('undeclared name', async () => {
    const r = await run(`s = bars("x","1d",asset="equity")\nsma(t.close, 3)`, mockBars([1, 2, 3]))
    expect(r.error?.kind).toBe('undeclared-name')
  })

  it('arity error', async () => {
    const r = await run(`s = bars("x","1d",asset="equity")\nsma(s.close)`, mockBars([1, 2, 3]))
    expect(r.error?.kind).toBe('arity')
    expect(r.error?.message).toMatch(/expects 2/)
  })

  it('rejects a series as the final result', async () => {
    const r = await run(`s = bars("x","1d",asset="equity")\ns.close`, mockBars([1, 2, 3]))
    expect(r.error?.kind).toBe('type')
    expect(r.error?.message).toMatch(/series column/)
  })

  it('rounds to the requested precision', async () => {
    const r = await runScript(`s = bars("x","1d",asset="equity")\nsma(s.close, 3)`, { barService: mockBars([1, 2, 4]) }, 2)
    expect(r.value).toBe(2.33) // (1+2+4)/3 = 2.333… → 2.33
  })

  it('redirects the pandas reflex of indexing a scalar indicator', async () => {
    const r = await run(`s = bars("x","1d",asset="equity")\nsma(s.close, 2)[-1]`, mockBars([1, 2, 3]))
    expect(r.error?.kind).toBe('reflex')
    expect(r.error?.suggestion).toMatch(/drop the \[-1\]/)
  })

  it('returns an indicator object (bbands) as a record', async () => {
    const r = await run(`s = bars("x","1d",asset="equity")\nbbands(s.close, 3, 2)`, mockBars([1, 2, 3, 4, 5, 6]))
    expect(typeof r.value).toBe('object')
    expect(r.value).toHaveProperty('upper')
    expect(r.value).toHaveProperty('middle')
    expect(r.value).toHaveProperty('lower')
  })

  // ---- added quant primitives ----

  it('computes roc / median / slope / highest / lowest (exact on a ramp)', async () => {
    const svc = mockBars([1, 2, 3, 4, 5])
    expect((await run(`s = bars("x","1d",asset="equity")\nroc(s.close, 4)`, svc)).value).toBe(400) // (5-1)/1*100
    expect((await run(`s = bars("x","1d",asset="equity")\nmedian(s.close)`, svc)).value).toBe(3)
    expect((await run(`s = bars("x","1d",asset="equity")\nslope(s.close, 5)`, svc)).value).toBe(1) // perfect line
    expect((await run(`s = bars("x","1d",asset="equity")\nhighest(s.close, 3)`, svc)).value).toBe(5)
    expect((await run(`s = bars("x","1d",asset="equity")\nlowest(s.close, 3)`, svc)).value).toBe(3)
  })

  it('zscore of the latest value', async () => {
    const r = await run(`s = bars("x","1d",asset="equity")\nzscore(s.close)`, mockBars([1, 2, 3, 4, 5]))
    expect(r.value).toBeCloseTo(1.4142, 3) // (5-3)/sqrt(2)
  })

  it('correlation of two series (identical → 1)', async () => {
    const r = await run(`a = bars("x","1d",asset="equity")\nb = bars("y","1d",asset="equity")\ncorrelation(a.close, b.close)`, mockBars([1, 2, 3, 4, 5]))
    expect(r.value).toBeCloseTo(1, 6)
  })

  // ---- panels: batch many computations in one call ----

  it('returns a labeled panel (dict) — the multi-timeframe case', async () => {
    const r = await run(
      `h1 = bars("x","1h",asset="crypto")\nh4 = bars("x","4h",asset="crypto")\n{ "1h": sma(h1.close, 3), "4h": sma(h4.close, 3) }`,
      mockBars([1, 2, 3, 4, 5]),
    )
    expect(r.error).toBeUndefined()
    expect(r.value).toEqual({ '1h': 4, '4h': 4 })
  })

  it('returns a positional panel (list)', async () => {
    const r = await run(`s = bars("x","1d",asset="equity")\n[ s.close[-1], sma(s.close, 3) ]`, mockBars([1, 2, 3, 4, 5]))
    expect(r.value).toEqual([5, 4])
  })

  it('a panel entry must reduce to a single value (raw series rejected)', async () => {
    const r = await run(`s = bars("x","1d",asset="equity")\n{ "x": s.close }`, mockBars([1, 2, 3]))
    expect(r.error?.kind).toBe('type')
    expect(r.error?.message).toMatch(/single value/)
  })

  it('caps panel size', async () => {
    const entries = Array.from({ length: 201 }, (_, i) => `"k${i}": 1`).join(', ')
    const r = await run(`{ ${entries} }`, mockBars([1, 2, 3]))
    expect(r.error?.kind).toBe('type')
    expect(r.error?.message).toMatch(/at most 200/)
  })

  it('dates opt-in: attaches the per-source date axis', async () => {
    const svc = mockBars([1, 2, 3, 4, 5])
    const off = await runScript(`s = bars("x","1d",asset="equity")\ns.close[-1]`, { barService: svc })
    expect(off.dates).toBeUndefined() // off by default
    const on = await runScript(`s = bars("x","1d",asset="equity")\ns.close[-1]`, { barService: svc }, 4, { withDates: true })
    expect(on.dates?.['yfinance|AAPL']).toEqual(['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'])
  })

  it('a panel entry can be an indicator record (nested)', async () => {
    const r = await run(`s = bars("x","1d",asset="equity")\n{ "bb": bbands(s.close, 3, 2) }`, mockBars([1, 2, 3, 4, 5, 6]))
    expect((r.value as Record<string, unknown>).bb).toHaveProperty('upper')
  })
})
