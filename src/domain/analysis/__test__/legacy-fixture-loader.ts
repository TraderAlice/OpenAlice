/**
 * Test-only loader for the analysis_core legacy calculation fixture.
 *
 * Reads docs/autonomous-refactor/fixtures/analysis-core/legacy-calculation-fixtures.json
 * and rebuilds the OHLCV datasets the fixture describes via generators. Used by the
 * TypeScript-only legacy parity harness while OPENALICE_RUST_ANALYSIS=0.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  HistoricalDataResult,
  IndicatorContext,
  OhlcvData,
} from '../indicator/types'

export interface FixtureFile {
  schemaVersion: number
  module: string
  sourceCommit: string
  contractPath: string
  sourcePathsRead: string[]
  publicSurfaces: Record<string, unknown>
  datasets: {
    linear50Ohlcv: { metaForSymbolAAPL: { symbol: string; from: string; to: string; bars: number } }
    short3Ohlcv: { bars: OhlcvData[] }
    emptyOhlcv: { bars: OhlcvData[] }
    toolShimUnsortedRawBars: {
      byAsset: Record<string, Array<{ date: string; open: number | null; high: number; low: number; close: number; volume: number | null }>>
    }
  }
  indicatorCalculatorCases: FixtureCase[]
  analysisToolShimCases: FixtureCase[]
  thinkingCalculateCases: FixtureCase[]
  thinkingToolShimCases: FixtureCase[]
}

export interface FixtureCase {
  id: string
  entryPoint: string
  dataset?: string
  input: Record<string, unknown>
  result:
    | { ok: true; output: unknown }
    | { ok: false; error: { name: string; message: string } }
}

export function loadLegacyFixture(): FixtureFile {
  const here = dirname(fileURLToPath(import.meta.url))
  const repoRoot = resolve(here, '..', '..', '..', '..')
  const path = resolve(
    repoRoot,
    'docs/autonomous-refactor/fixtures/analysis-core/legacy-calculation-fixtures.json',
  )
  const raw = readFileSync(path, 'utf8')
  return JSON.parse(raw) as FixtureFile
}

/** Generate the 50-bar linear OHLCV dataset described by the fixture's generator block. */
export function buildLinear50Ohlcv(): OhlcvData[] {
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

/** Build an IndicatorContext that returns the named dataset for any symbol, mirroring legacy specs. */
export function buildContextForDataset(
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
