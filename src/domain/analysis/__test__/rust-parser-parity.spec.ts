/**
 * analysis_core Rust parser parity harness (OPE-16).
 *
 * Pins OPENALICE_RUST_ANALYSIS=1 and re-runs the legacy fixture cases
 * for `IndicatorCalculator.calculate` so the Rust parser path
 * (Rust tokenizer/parser + TypeScript evaluator) is held to the same
 * outputs and error messages as the legacy TypeScript parser path on
 * parser-relevant fixtures.
 *
 * The tool-shim cases live in `legacy-parity.spec.ts` because their
 * normalization happens in `src/tool/analysis.ts` and are unaffected by
 * the parser swap; this spec deliberately exercises only the
 * IndicatorCalculator surface to keep the parser-only contract
 * explicit.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { IndicatorCalculator } from '../indicator/calculator'
import type {
  HistoricalDataResult,
  IndicatorContext,
  OhlcvData,
} from '../indicator/types'

interface FixtureCase {
  id: string
  entryPoint: string
  dataset?: string
  input: Record<string, unknown>
  result:
    | { ok: true; output: unknown }
    | { ok: false; error: { name: string; message: string } }
}

interface FixtureFile {
  datasets: {
    linear50Ohlcv: { metaForSymbolAAPL: { symbol: string; from: string; to: string; bars: number } }
    short3Ohlcv: { bars: OhlcvData[] }
    emptyOhlcv: { bars: OhlcvData[] }
  }
  indicatorCalculatorCases: FixtureCase[]
}

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..')

function loadLegacyFixture(): FixtureFile {
  const path = resolve(
    REPO_ROOT,
    'docs/autonomous-refactor/fixtures/analysis-core/legacy-calculation-fixtures.json',
  )
  return JSON.parse(readFileSync(path, 'utf8')) as FixtureFile
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

function buildContextForDataset(
  dataset: 'linear50Ohlcv' | 'short3Ohlcv' | 'emptyOhlcv',
  fixture: FixtureFile,
): IndicatorContext {
  switch (dataset) {
    case 'linear50Ohlcv': {
      const data = buildLinear50Ohlcv()
      const meta = fixture.datasets.linear50Ohlcv.metaForSymbolAAPL
      return {
        getHistoricalData: async (symbol: string): Promise<HistoricalDataResult> => ({
          data,
          meta: { ...meta, symbol },
        }),
      }
    }
    case 'short3Ohlcv': {
      const data = fixture.datasets.short3Ohlcv.bars
      return {
        getHistoricalData: async (symbol: string): Promise<HistoricalDataResult> => ({
          data,
          meta: {
            symbol,
            from: data[0].date,
            to: data[data.length - 1].date,
            bars: data.length,
          },
        }),
      }
    }
    case 'emptyOhlcv': {
      const data = fixture.datasets.emptyOhlcv.bars
      return {
        getHistoricalData: async (symbol: string): Promise<HistoricalDataResult> => ({
          data,
          meta: { symbol, from: '', to: '', bars: 0 },
        }),
      }
    }
  }
}

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

// Build both the napi-rs `.node` artifact (the OPE-17 normal path) and
// the OPE-16 CLI binary (still exercised by the binding-overhead
// benchmark and the explicit CLI-fallback regression test). Both come
// out of the same crate, so a single `cargo build` covers both.
function ensureRustArtifactsBuilt(): void {
  if (existsSync(NATIVE_BINDING_PATH)) return
  const cargoBin = resolveCargoBin()
  execFileSync(
    cargoBin,
    ['build', '-p', 'analysis-core-node-binding'],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  )
  execFileSync(
    process.execPath,
    [resolve(REPO_ROOT, 'packages/node-bindings/analysis-core/scripts/build-native.mjs')],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  )
}

const fixture: FixtureFile = loadLegacyFixture()

let originalFlag: string | undefined

beforeAll(() => {
  ensureRustArtifactsBuilt()
  originalFlag = process.env.OPENALICE_RUST_ANALYSIS
  process.env.OPENALICE_RUST_ANALYSIS = '1'
}, 180_000)

afterAll(() => {
  if (originalFlag === undefined) {
    delete process.env.OPENALICE_RUST_ANALYSIS
  } else {
    process.env.OPENALICE_RUST_ANALYSIS = originalFlag
  }
})

describe('analysis_core: Rust parser flag pinning', () => {
  it('keeps OPENALICE_RUST_ANALYSIS=1 for the Rust parser path', () => {
    expect(process.env.OPENALICE_RUST_ANALYSIS).toBe('1')
  })
})

describe('analysis_core: IndicatorCalculator parity (Rust parser path, flag=1)', () => {
  for (const testCase of fixture.indicatorCalculatorCases) {
    runIndicatorCalculatorCase(testCase)
  }
})

function runIndicatorCalculatorCase(testCase: FixtureCase): void {
  it(testCase.id, async () => {
    expect(process.env.OPENALICE_RUST_ANALYSIS).toBe('1')
    const dataset = testCase.dataset as
      | 'linear50Ohlcv'
      | 'short3Ohlcv'
      | 'emptyOhlcv'
    const context = buildContextForDataset(dataset, fixture)
    const calculator = new IndicatorCalculator(context)
    const formula = testCase.input.formula as string
    const precision = testCase.input.precision as number | undefined

    if (testCase.result.ok) {
      const out = await calculator.calculate(formula, precision)
      expect(out).toEqual(testCase.result.output)
    } else {
      await expect(
        calculator.calculate(formula, precision),
      ).rejects.toThrow(testCase.result.error.message)
    }
  })
}
