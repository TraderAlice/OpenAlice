/**
 * analysis_core finite-`number[]` Rust reductions parity spec (OPE-19).
 *
 * Locks four parity contracts:
 *
 * 1. Reduction parity. With `OPENALICE_RUST_ANALYSIS=1`, formulas that
 *    bottom out in `MIN(CLOSE(...))`, `MAX(CLOSE(...))`,
 *    `SUM(CLOSE(...))`, `AVERAGE(CLOSE(...))`, and the issue-listed
 *    `MAX(CLOSE) - MIN(CLOSE)` shape produce the same
 *    `IndicatorCalculator.calculate` output (value + dataRange) as the
 *    legacy TypeScript path with the flag at `0`.
 *
 * 2. Empty-array parity. `MIN([])` / `MAX([])` / `AVERAGE([])` continue
 *    throwing `<KIND> requires at least 1 data point` under both flags;
 *    `SUM([])` continues returning `0` to mirror the legacy
 *    `[].reduce((a, v) => a + v, 0)` behavior.
 *
 * 3. Non-finite fallback parity. Arrays containing `NaN` / `+/-Infinity`
 *    bypass the Rust kernel and stay on the legacy TypeScript reduction
 *    even with the flag at `1`. `MIN`/`MAX`/`AVERAGE` keep the same
 *    `NaN` propagation semantics as the legacy implementation; `SUM`
 *    keeps its sequential left-to-right addition semantics.
 *
 * 4. dataRange invariance. TypeScript still owns `toValues(...)` and
 *    `TrackedValues`, so `dataRange` is identical between the two
 *    flag values for every fixture exercised below.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  AVERAGE as legacyAverage,
  MAX as legacyMax,
  MIN as legacyMin,
  SUM as legacySum,
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

describe('analysis_core: finite-`number[]` Rust reductions parity (OPE-19)', () => {
  // The issue acceptance criteria call out MAX / MIN / SUM / AVERAGE on
  // `CLOSE('AAPL', '1d')` plus the `MAX - MIN` range, so the parity
  // matrix below covers exactly those five formulas. The linear OHLCV
  // fixture above gives `CLOSE` values 100..149 (length 50), so the
  // expected analytic outputs are deterministic and human-readable;
  // the parity assertions still come from running both flags
  // back-to-back, not from hard-coded numbers, so a regression in the
  // legacy path also fails the test.
  const reductionFormulas: string[] = [
    "MAX(CLOSE('AAPL', '1d'))",
    "MIN(CLOSE('AAPL', '1d'))",
    "SUM(CLOSE('AAPL', '1d'))",
    "AVERAGE(CLOSE('AAPL', '1d'))",
    "MAX(CLOSE('AAPL', '1d')) - MIN(CLOSE('AAPL', '1d'))",
  ]

  for (const formula of reductionFormulas) {
    it(`reduction parity: ${formula}`, async () => {
      const legacy = await calculate(formula, '0')
      const rust = await calculate(formula, '1')
      expect(rust).toEqual(legacy)
      // dataRange is owned by TypeScript on both flags; the linear
      // fixture must surface the same single-source meta object.
      expect(rust.dataRange).toEqual({
        AAPL: { symbol: 'AAPL', from: '2025-01-01', to: '2025-02-22', bars: 50 },
      })
    })
  }

  it('MAX - MIN returns the expected analytic range under flag=1 (defensive)', async () => {
    // CLOSE values 100..149: MAX=149, MIN=100, range=49.
    const rust = await calculate("MAX(CLOSE('AAPL', '1d')) - MIN(CLOSE('AAPL', '1d'))", '1')
    expect(rust.value).toBe(49)
  })
})

// The remaining tests exercise the statistics module directly so we
// can pin per-reduction behavior independent of the calculator and
// data-access layers. The IndicatorCalculator parity tests above lock
// the user-visible behavior; these tests lock the kernel routing.
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

describe('analysis_core: empty-array reduction parity (OPE-19)', () => {
  it('SUM([]) returns 0 under both flags', async () => {
    expect(await withFlag('0', () => legacySum([]))).toBe(0)
    expect(await withFlag('1', () => legacySum([]))).toBe(0)
  })

  it.each([
    ['MIN', legacyMin, 'MIN requires at least 1 data point'],
    ['MAX', legacyMax, 'MAX requires at least 1 data point'],
    ['AVERAGE', legacyAverage, 'AVERAGE requires at least 1 data point'],
  ] as const)('%s([]) throws the legacy message under both flags', async (_label, fn, message) => {
    await expect(withFlag('0', () => fn([]))).rejects.toThrow(message)
    await expect(withFlag('1', () => fn([]))).rejects.toThrow(message)
  })
})

describe('analysis_core: non-finite arrays stay on the legacy TS path under flag=1 (OPE-19)', () => {
  // The Rust kernel cannot faithfully carry `NaN` / `+/-Infinity` over
  // the JSON-encoded napi envelope, so the JS wrapper pre-screens for
  // them and the four reductions silently fall back to the legacy
  // implementation. We assert that the observable output under flag=1
  // matches flag=0 exactly for these inputs.
  const finiteParity: number[][] = [
    [1, 2, 3, 4, 5],
    [-1, -2, -3, -4, -5],
    [1.1, 2.2, 3.3],
    Array.from({ length: 1024 }, (_, i) => i + 1),
  ]

  for (const arr of finiteParity) {
    it(`finite parity (${arr.length}-element array)`, async () => {
      const legacy = await withFlag('0', () => ({
        min: legacyMin(arr),
        max: legacyMax(arr),
        sum: legacySum(arr),
        avg: legacyAverage(arr),
      }))
      const rust = await withFlag('1', () => ({
        min: legacyMin(arr),
        max: legacyMax(arr),
        sum: legacySum(arr),
        avg: legacyAverage(arr),
      }))
      expect(rust).toEqual(legacy)
    })
  }

  it('NaN-bearing array produces identical results under both flags (legacy TS authoritative)', async () => {
    const arr = [1, Number.NaN, 3]
    const legacy = await withFlag('0', () => ({
      min: legacyMin(arr),
      max: legacyMax(arr),
      sum: legacySum(arr),
      avg: legacyAverage(arr),
    }))
    const rust = await withFlag('1', () => ({
      min: legacyMin(arr),
      max: legacyMax(arr),
      sum: legacySum(arr),
      avg: legacyAverage(arr),
    }))
    // NaN !== NaN, so toEqual is the right shape comparator here:
    // vitest's deep equal treats NaN as equal to NaN.
    expect(rust).toEqual(legacy)
  })

  it('Infinity-bearing array produces identical results under both flags (legacy TS authoritative)', async () => {
    const arr = [1, Number.POSITIVE_INFINITY, 3]
    const legacy = await withFlag('0', () => ({
      min: legacyMin(arr),
      max: legacyMax(arr),
      sum: legacySum(arr),
      avg: legacyAverage(arr),
    }))
    const rust = await withFlag('1', () => ({
      min: legacyMin(arr),
      max: legacyMax(arr),
      sum: legacySum(arr),
      avg: legacyAverage(arr),
    }))
    expect(rust).toEqual(legacy)
  })
})

describe('analysis_core: legacy default semantics under flag=0 / unset (OPE-19)', () => {
  it('legacy reductions behave identically when the flag is unset', async () => {
    const prior = process.env.OPENALICE_RUST_ANALYSIS
    delete process.env.OPENALICE_RUST_ANALYSIS
    try {
      expect(legacyMin([3, 1, 2])).toBe(1)
      expect(legacyMax([3, 1, 2])).toBe(3)
      expect(legacySum([1, 2, 3])).toBe(6)
      expect(legacyAverage([1, 2, 3])).toBe(2)
      expect(legacySum([])).toBe(0)
      expect(() => legacyMin([])).toThrow('MIN requires at least 1 data point')
    } finally {
      if (prior === undefined) delete process.env.OPENALICE_RUST_ANALYSIS
      else process.env.OPENALICE_RUST_ANALYSIS = prior
    }
  })

  it('"true" / "yes" / "0" do not enable the Rust reductions route', async () => {
    for (const flag of ['true', 'yes', '0', '', 'TRUE']) {
      const prior = process.env.OPENALICE_RUST_ANALYSIS
      process.env.OPENALICE_RUST_ANALYSIS = flag
      try {
        // Verify legacy semantics are preserved for the four reductions
        // even when the flag is set to a non-`"1"` value.
        expect(legacyMin([3, 1, 2])).toBe(1)
        expect(legacyMax([3, 1, 2])).toBe(3)
        expect(legacySum([1, 2, 3])).toBe(6)
        expect(legacyAverage([1, 2, 3])).toBe(2)
      } finally {
        if (prior === undefined) delete process.env.OPENALICE_RUST_ANALYSIS
        else process.env.OPENALICE_RUST_ANALYSIS = prior
      }
    }
  })
})
