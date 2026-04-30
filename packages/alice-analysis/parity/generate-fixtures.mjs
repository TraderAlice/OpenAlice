// Deterministic OHLCV fixture generator.
//
// Why synthetic instead of cached real yfinance data: the e2e tests in
// `src/domain/market-data/__tests__/bbProviders/analysis.bbProvider.spec.ts`
// hit the network on every run, so their data drifts daily. The team-lead's
// alternative path ("write a focused harness that drives the
// IndicatorCalculator directly with both impls in the same process") works
// best with a frozen fixture so the parity report is reproducible across
// machines/runs.
//
// Each fixture is a deterministic seeded random walk shaped roughly like the
// asset it stands in for. The numbers are NOT real prices — they're realistic
// price *shapes* (bar count, volatility regime, occasional gaps) sufficient
// to exercise every indicator code path. Parity is the goal; absolute realism
// of the data is not.
//
// Run with:
//   /opt/homebrew/bin/node packages/alice-analysis/parity/generate-fixtures.mjs

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const fixturesDir = resolve(here, 'fixtures')

// Mulberry32 — small, deterministic PRNG. Seed-stable across Node versions.
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Box-Muller from a uniform PRNG.
function gaussFactory(rng) {
  let spare = null
  return () => {
    if (spare !== null) {
      const v = spare
      spare = null
      return v
    }
    let u, v, s
    do {
      u = rng() * 2 - 1
      v = rng() * 2 - 1
      s = u * u + v * v
    } while (s >= 1 || s === 0)
    const m = Math.sqrt((-2 * Math.log(s)) / s)
    spare = v * m
    return u * m
  }
}

function isoDate(daysFromStart, startISO) {
  const ms = Date.parse(startISO) + daysFromStart * 86400_000
  return new Date(ms).toISOString().slice(0, 10)
}

// Generate `bars` of plausible OHLCV. Highs/lows wrap around the close with
// per-bar spreads driven by sigma. Volume is a positive lognormal.
function generate({ symbol, seed, bars, startPrice, sigma, drift, startDate }) {
  const rng = mulberry32(seed)
  const gauss = gaussFactory(rng)
  const data = []
  let close = startPrice
  for (let i = 0; i < bars; i++) {
    const ret = drift + sigma * gauss()
    const open = close
    close = Math.max(0.01, open * Math.exp(ret))
    const intrabarVol = sigma * Math.abs(gauss())
    const high = Math.max(open, close) * (1 + intrabarVol)
    const low = Math.min(open, close) * (1 - intrabarVol)
    const volume = Math.round(Math.exp(8 + 2 * gauss()))
    data.push({
      date: isoDate(i, startDate),
      open: round6(open),
      high: round6(high),
      low: round6(low),
      close: round6(close),
      volume,
    })
  }
  return {
    symbol,
    interval: '1d',
    bars,
    from: data[0].date,
    to: data[data.length - 1].date,
    data,
  }
}

function round6(x) {
  return Math.round(x * 1e6) / 1e6
}

// Mock 50-bar fixture matching `calculator.spec.ts` exactly. This is the
// sanity row in the parity matrix.
function generateMock50() {
  const data = []
  for (let i = 0; i < 50; i++) {
    data.push({
      date: `2025-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      open: 100 + i,
      high: 102 + i,
      low: 99 + i,
      close: 100 + i,
      volume: i === 48 ? null : 1000 + i * 10,
    })
  }
  return {
    symbol: 'MOCK',
    interval: '1d',
    bars: 50,
    from: data[0].date,
    to: data[49].date,
    data,
  }
}

// Long-history fixture for MACD perf measurement and EMA-deep accumulation.
function generateLong() {
  return generate({
    symbol: 'LONG',
    seed: 0xc0ffee,
    bars: 2000,
    startPrice: 100.0,
    sigma: 0.018,
    drift: 0.0002,
    startDate: '2018-01-01',
  })
}

const fixtures = {
  mock_50bar: generateMock50(),
  // Stand-ins for the e2e cross-asset suite. ~730 bars matches the
  // tool/analysis.ts calendar-day window for `1d` intervals.
  AAPL_daily: generate({
    symbol: 'AAPL',
    seed: 0xa11e,
    bars: 730,
    startPrice: 150.0,
    sigma: 0.015,
    drift: 0.0003,
    startDate: '2024-01-01',
  }),
  BTCUSD_daily: generate({
    symbol: 'BTCUSD',
    seed: 0xb1c0,
    bars: 730,
    startPrice: 30000.0,
    sigma: 0.035,
    drift: 0.0005,
    startDate: '2024-01-01',
  }),
  gold_daily: generate({
    symbol: 'gold',
    seed: 0x6010,
    bars: 730,
    startPrice: 1900.0,
    sigma: 0.009,
    drift: 0.0002,
    startDate: '2024-01-01',
  }),
  crude_oil_daily: generate({
    symbol: 'crude_oil',
    seed: 0xc20de,
    bars: 730,
    startPrice: 75.0,
    sigma: 0.022,
    drift: -0.0001,
    startDate: '2024-01-01',
  }),
  long_2000bar: generateLong(),
}

for (const [name, fx] of Object.entries(fixtures)) {
  const path = resolve(fixturesDir, `${name}.json`)
  writeFileSync(path, JSON.stringify(fx, null, 2))
  console.log(`wrote ${name}: ${fx.bars} bars, ${fx.from}→${fx.to}`)
}
