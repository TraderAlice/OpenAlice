/**
 * analysis_core finite-`number[]` Rust rolling-window moving-average
 * parity spec (OPE-20).
 *
 * Locks four parity contracts:
 *
 * 1. Moving-average parity. With `OPENALICE_RUST_ANALYSIS=1`, formulas
 *    that bottom out in `SMA(CLOSE(...), period)` and
 *    `EMA(CLOSE(...), period)` (and the issue-listed `SMA + EMA`
 *    additive shape) produce the same `IndicatorCalculator.calculate`
 *    output (value + dataRange) as the legacy TypeScript path with the
 *    flag at `0`.
 *
 * 2. Too-short-input parity. `SMA(values, period)` and
 *    `EMA(values, period)` with `values.length < period` continue
 *    throwing
 *    `<KIND> requires at least <period> data points, got <len>`
 *    under both flag values; the message is parity-locked with the
 *    legacy TS implementation.
 *
 * 3. Non-finite fallback parity. Arrays containing `NaN` /
 *    `+/-Infinity` bypass the Rust kernel and stay on the legacy
 *    TypeScript moving-average even with the flag at `1`. Output under
 *    flag=1 must match flag=0 for these inputs.
 *
 * 4. Unsupported-period fallback parity. A `period` that is not a
 *    positive safe integer (`0`, negative, `1.5`, `NaN`, `Infinity`)
 *    bypasses the Rust kernel and stays on the legacy TS path. We do
 *    not introduce new validation behavior in this slice — the legacy
 *    behavior for those periods is preserved verbatim under flag=1.
 *
 * dataRange is owned by TypeScript regardless of flag, so the
 * IndicatorCalculator parity assertions also lock dataRange invariance.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  EMA as legacyEma,
  SMA as legacySma,
} from '../indicator/functions/statistics'
import { IndicatorCalculator } from '../indicator/calculator'
import type {
  HistoricalDataResult,
  IndicatorContext,
  OhlcvData,
} from '../indicator/types'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..')
const NATIVE_BINDING_PATH = resolve(
  REPO_ROOT,
  'packages',
  'node-bindings',
  'analysis-core',
  'analysis-core.node',
)

function resolveCargoBin(): string {
  if (process.env.CARGO) return process.env.CARGO
  const sep = process.platform === 'win32' ? ';' : ':'
  const onPath = (process.env.PATH || '').split(sep)
  const exe = process.platform === 'win32' ? 'cargo.exe' : 'cargo'
  for (const dir of onPath) {
    if (!dir) continue
    const candidate = resolve(dir, exe)
    if (existsSync(candidate)) return candidate
  }
  const home = os.homedir()
  if (home) {
    const fallback = resolve(home, '.cargo', 'bin', exe)
    if (existsSync(fallback)) return fallback
  }
  return 'cargo'
}

function ensureNativeArtifact(): void {
  if (existsSync(NATIVE_BINDING_PATH)) return
  execFileSync(
    resolveCargoBin(),
    ['build', '-p', 'analysis-core-node-binding'],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  )
  execFileSync(
    process.execPath,
    [resolve(REPO_ROOT, 'packages/node-bindings/analysis-core/scripts/build-native.mjs')],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  )
}

function buildLinear50Ohlcv(): OhlcvData[] {
  return Array.from({ length: 50 }, (_, i) => ({
    date: `2025-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
    open: 100 + i,
    high: 102 + i,
    low: 99 + i,
    close: 100 + i,
    volume: i === 48 ? null : 1000 + i * 10,
    vwap: null,
  }))
}

function buildLinearContext(): IndicatorContext {
  const data = buildLinear50Ohlcv()
  return {
    getHistoricalData: async (symbol: string): Promise<HistoricalDataResult> => ({
      data,
      meta: { symbol, from: '2025-01-01', to: '2025-02-22', bars: 50 },
    }),
  }
}

let originalFlag: string | undefined

beforeAll(() => {
  ensureNativeArtifact()
  originalFlag = process.env.OPENALICE_RUST_ANALYSIS
}, 180_000)

afterAll(() => {
  if (originalFlag === undefined) {
    delete process.env.OPENALICE_RUST_ANALYSIS
  } else {
    process.env.OPENALICE_RUST_ANALYSIS = originalFlag
  }
})

async function calculate(
  formula: string,
  flagValue: '0' | '1',
  precision?: number,
): Promise<{ value: unknown; dataRange: unknown }> {
  process.env.OPENALICE_RUST_ANALYSIS = flagValue
  const calculator = new IndicatorCalculator(buildLinearContext())
  return calculator.calculate(formula, precision)
}

describe('analysis_core: finite-`number[]` Rust rolling-window parity (OPE-20)', () => {
  // The issue acceptance criteria call out SMA / EMA on `CLOSE('AAPL',
  // '1d')` plus the `SMA + EMA` additive shape, so the parity matrix
  // below covers exactly those formulas. The linear OHLCV fixture above
  // gives `CLOSE` values 100..149 (length 50). Parity is asserted by
  // running both flags back-to-back and comparing — not by hard-coded
  // numeric expectations — so a regression in either path also fails.
  const rollingFormulas: string[] = [
    "SMA(CLOSE('AAPL', '1d'), 5)",
    "EMA(CLOSE('AAPL', '1d'), 5)",
    "SMA(CLOSE('AAPL', '1d'), 10) + EMA(CLOSE('AAPL', '1d'), 10)",
  ]

  for (const formula of rollingFormulas) {
    it(`rolling parity: ${formula}`, async () => {
      const legacy = await calculate(formula, '0')
      const rust = await calculate(formula, '1')
      expect(rust).toEqual(legacy)
      expect(rust.dataRange).toEqual({
        AAPL: { symbol: 'AAPL', from: '2025-01-01', to: '2025-02-22', bars: 50 },
      })
    })
  }

  it('SMA over the trailing 5 closes returns the expected analytic mean under flag=1 (defensive)', async () => {
    // CLOSE values 100..149: trailing 5 values are 145..149, mean = 147.
    const rust = await calculate("SMA(CLOSE('AAPL', '1d'), 5)", '1')
    expect(rust.value).toBe(147)
  })
})

// The remaining tests exercise the statistics module directly so we
// can pin per-kernel routing behavior independent of the calculator
// and data-access layers.
async function withFlag<T>(flag: '0' | '1', f: () => T | Promise<T>): Promise<T> {
  const prior = process.env.OPENALICE_RUST_ANALYSIS
  process.env.OPENALICE_RUST_ANALYSIS = flag
  try {
    return await f()
  } finally {
    if (prior === undefined) delete process.env.OPENALICE_RUST_ANALYSIS
    else process.env.OPENALICE_RUST_ANALYSIS = prior
  }
}

describe('analysis_core: SMA/EMA value parity over finite arrays at multiple periods (OPE-20)', () => {
  // Periods 1, 3, 5, 20 are the matrix the issue acceptance criteria
  // requires. We use a non-trivial shape (offset + linear ramp + sine
  // perturbation) so neither the SMA average nor the EMA recurrence is
  // collapsible by hand.
  function buildSeries(length: number): number[] {
    return Array.from({ length }, (_, i) => 100 + i * 0.5 + Math.sin(i / 3) * 2.5)
  }

  const periods: number[] = [1, 3, 5, 20]
  const lengths: number[] = [16, 64, 256, 1024]

  for (const period of periods) {
    for (const length of lengths) {
      if (length < period) continue
      it(`SMA period=${period} length=${length} matches legacy under flag=1`, async () => {
        const series = buildSeries(length)
        const legacyValue = await withFlag('0', () => legacySma(series, period))
        const rustValue = await withFlag('1', () => legacySma(series, period))
        expect(rustValue).toBe(legacyValue)
      })
      it(`EMA period=${period} length=${length} matches legacy under flag=1`, async () => {
        const series = buildSeries(length)
        const legacyValue = await withFlag('0', () => legacyEma(series, period))
        const rustValue = await withFlag('1', () => legacyEma(series, period))
        expect(rustValue).toBe(legacyValue)
      })
    }
  }
})

describe('analysis_core: too-short-input parity (OPE-20)', () => {
  type RollingFn = (values: number[], period: number) => number
  const tooShortCases: Array<[string, RollingFn, number[], number, string]> = [
    ['SMA', legacySma, [1, 2, 3], 5, 'SMA requires at least 5 data points, got 3'],
    ['EMA', legacyEma, [1, 2], 4, 'EMA requires at least 4 data points, got 2'],
    ['SMA', legacySma, [], 1, 'SMA requires at least 1 data points, got 0'],
    ['EMA', legacyEma, [], 3, 'EMA requires at least 3 data points, got 0'],
  ]
  it.each(tooShortCases)(
    '%s on %j with period %d throws the legacy message under both flags',
    async (_label, fn, values, period, message) => {
      await expect(withFlag('0', () => fn(values, period))).rejects.toThrow(message)
      await expect(withFlag('1', () => fn(values, period))).rejects.toThrow(message)
    },
  )
})

describe('analysis_core: non-finite arrays stay on the legacy TS path under flag=1 (OPE-20)', () => {
  // Per the OPE-20 contract, arrays containing NaN / +/-Infinity bypass
  // the Rust kernel and stay on the legacy TypeScript implementation.
  // We assert observable parity between flag=0 and flag=1 on those
  // inputs so SMA/EMA's `NaN` / `Infinity` propagation matches the
  // legacy module's behavior exactly.
  const nonFiniteSeries: Array<{ label: string; values: number[]; period: number }> = [
    { label: 'NaN at index 2', values: [1, 2, Number.NaN, 4, 5, 6], period: 3 },
    { label: '+Infinity at index 0', values: [Number.POSITIVE_INFINITY, 1, 2, 3, 4], period: 3 },
    { label: '-Infinity at index 4', values: [1, 2, 3, 4, Number.NEGATIVE_INFINITY], period: 3 },
  ]

  for (const { label, values, period } of nonFiniteSeries) {
    it(`SMA(${label}) matches under both flags`, async () => {
      const legacy = await withFlag('0', () => legacySma(values, period))
      const rust = await withFlag('1', () => legacySma(values, period))
      // Use Object.is so NaN equates to NaN.
      expect(Object.is(rust, legacy)).toBe(true)
    })
    it(`EMA(${label}) matches under both flags`, async () => {
      const legacy = await withFlag('0', () => legacyEma(values, period))
      const rust = await withFlag('1', () => legacyEma(values, period))
      expect(Object.is(rust, legacy)).toBe(true)
    })
  }
})

describe('analysis_core: unsupported-period fallback parity (OPE-20)', () => {
  // The Rust shim returns `unsupported` for any period that is not a
  // positive safe integer. The legacy TS path keeps its existing
  // behavior verbatim — we don't add new validation in this slice. We
  // assert that the observable output under flag=1 matches flag=0 for
  // these periods, including periods that legacy TS accepts (e.g.
  // fractional ones that Math interprets numerically).
  const series = Array.from({ length: 16 }, (_, i) => i + 1)

  // Period 0: legacy SMA throws the "requires at least 0" message and
  // returns NaN for the AVERAGE-style branch; we just lock parity.
  // Negative period: legacy passes through; lock parity.
  // Fractional period: legacy slices with v.slice(-1.5) which rounds
  // toward zero (so v.slice(-1)) → trailing-1 slice; lock parity. The
  // recipe here is "match what legacy did, whatever it was".
  const periodCases: number[] = [0, -1, 1.5, 2.5, Number.NaN]

  for (const p of periodCases) {
    it(`SMA period=${String(p)} matches legacy under flag=1`, async () => {
      let legacyResult: { kind: 'value'; value: number } | { kind: 'throw'; message: string }
      let rustResult: { kind: 'value'; value: number } | { kind: 'throw'; message: string }
      try {
        legacyResult = { kind: 'value', value: await withFlag('0', () => legacySma(series, p)) }
      } catch (err) {
        legacyResult = { kind: 'throw', message: (err as Error).message }
      }
      try {
        rustResult = { kind: 'value', value: await withFlag('1', () => legacySma(series, p)) }
      } catch (err) {
        rustResult = { kind: 'throw', message: (err as Error).message }
      }
      expect(rustResult.kind).toBe(legacyResult.kind)
      if (legacyResult.kind === 'throw' && rustResult.kind === 'throw') {
        expect(rustResult.message).toBe(legacyResult.message)
      } else if (legacyResult.kind === 'value' && rustResult.kind === 'value') {
        expect(Object.is(rustResult.value, legacyResult.value)).toBe(true)
      }
    })

    it(`EMA period=${String(p)} matches legacy under flag=1`, async () => {
      let legacyResult: { kind: 'value'; value: number } | { kind: 'throw'; message: string }
      let rustResult: { kind: 'value'; value: number } | { kind: 'throw'; message: string }
      try {
        legacyResult = { kind: 'value', value: await withFlag('0', () => legacyEma(series, p)) }
      } catch (err) {
        legacyResult = { kind: 'throw', message: (err as Error).message }
      }
      try {
        rustResult = { kind: 'value', value: await withFlag('1', () => legacyEma(series, p)) }
      } catch (err) {
        rustResult = { kind: 'throw', message: (err as Error).message }
      }
      expect(rustResult.kind).toBe(legacyResult.kind)
      if (legacyResult.kind === 'throw' && rustResult.kind === 'throw') {
        expect(rustResult.message).toBe(legacyResult.message)
      } else if (legacyResult.kind === 'value' && rustResult.kind === 'value') {
        expect(Object.is(rustResult.value, legacyResult.value)).toBe(true)
      }
    })
  }
})

describe('analysis_core: legacy default semantics under flag=0 / unset (OPE-20)', () => {
  it('legacy SMA/EMA behave identically when the flag is unset', async () => {
    const prior = process.env.OPENALICE_RUST_ANALYSIS
    delete process.env.OPENALICE_RUST_ANALYSIS
    try {
      // SMA([1..5], 3) = (3+4+5)/3 = 4.
      expect(legacySma([1, 2, 3, 4, 5], 3)).toBe(4)
      // EMA([1..5], 3) recurrence: seed=2, mult=0.5; i=3 → 3; i=4 → 4.
      expect(legacyEma([1, 2, 3, 4, 5], 3)).toBe(4)
      expect(() => legacySma([1, 2], 5)).toThrow(
        'SMA requires at least 5 data points, got 2',
      )
      expect(() => legacyEma([1, 2], 5)).toThrow(
        'EMA requires at least 5 data points, got 2',
      )
    } finally {
      if (prior === undefined) delete process.env.OPENALICE_RUST_ANALYSIS
      else process.env.OPENALICE_RUST_ANALYSIS = prior
    }
  })

  it('"true" / "yes" / "0" do not enable the Rust rolling route', async () => {
    for (const flag of ['true', 'yes', '0', '', 'TRUE']) {
      const prior = process.env.OPENALICE_RUST_ANALYSIS
      process.env.OPENALICE_RUST_ANALYSIS = flag
      try {
        expect(legacySma([1, 2, 3, 4, 5], 3)).toBe(4)
        expect(legacyEma([1, 2, 3, 4, 5], 3)).toBe(4)
      } finally {
        if (prior === undefined) delete process.env.OPENALICE_RUST_ANALYSIS
        else process.env.OPENALICE_RUST_ANALYSIS = prior
      }
    }
  })
})
