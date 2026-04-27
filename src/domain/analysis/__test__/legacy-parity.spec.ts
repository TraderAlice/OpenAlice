/**
 * analysis_core legacy TypeScript parity harness.
 *
 * Locks the legacy public calculation entry points before the first Rust slice:
 *   - IndicatorCalculator.calculate (src/domain/analysis/indicator/calculator.ts)
 *   - createAnalysisTools().calculateIndicator.execute (src/tool/analysis.ts)
 *
 * Cases are driven by docs/autonomous-refactor/fixtures/analysis-core/legacy-calculation-fixtures.json.
 * Run as a TypeScript-only suite with OPENALICE_RUST_ANALYSIS pinned to "0", which forces
 * the legacy code path per docs/autonomous-refactor/module-contracts/analysis-core.md.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { IndicatorCalculator } from '../indicator/calculator'
import { createAnalysisTools } from '@/tool/analysis'
import type {
  CommodityClientLike,
  CryptoClientLike,
  CurrencyClientLike,
  EquityClientLike,
} from '@/domain/market-data/client/types'
import {
  buildContextForDataset,
  loadLegacyFixture,
  type FixtureCase,
  type FixtureFile,
} from './legacy-fixture-loader'

const fixture: FixtureFile = loadLegacyFixture()

let originalFlag: string | undefined

beforeAll(() => {
  originalFlag = process.env.OPENALICE_RUST_ANALYSIS
  process.env.OPENALICE_RUST_ANALYSIS = '0'
})

afterAll(() => {
  if (originalFlag === undefined) {
    delete process.env.OPENALICE_RUST_ANALYSIS
  } else {
    process.env.OPENALICE_RUST_ANALYSIS = originalFlag
  }
})

describe('analysis_core: legacy flag pinning', () => {
  it('keeps OPENALICE_RUST_ANALYSIS=0 for the legacy path', () => {
    expect(process.env.OPENALICE_RUST_ANALYSIS).toBe('0')
  })
})

describe('analysis_core: IndicatorCalculator parity (legacy path, flag=0)', () => {
  for (const testCase of fixture.indicatorCalculatorCases) {
    runIndicatorCalculatorCase(testCase)
  }
})

describe('analysis_core: createAnalysisTools().calculateIndicator parity (legacy path, flag=0)', () => {
  for (const testCase of fixture.analysisToolShimCases) {
    runToolShimCase(testCase)
  }
})

function runIndicatorCalculatorCase(testCase: FixtureCase): void {
  it(testCase.id, async () => {
    expect(process.env.OPENALICE_RUST_ANALYSIS).toBe('0')
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

function runToolShimCase(testCase: FixtureCase): void {
  it(testCase.id, async () => {
    expect(process.env.OPENALICE_RUST_ANALYSIS).toBe('0')
    const asset = testCase.input.asset as
      | 'equity'
      | 'crypto'
      | 'currency'
      | 'commodity'
    const formula = testCase.input.formula as string
    const precision = testCase.input.precision as number | undefined

    const { equityClient, cryptoClient, currencyClient, commodityClient } =
      buildShimClients(fixture)
    const tools = createAnalysisTools(
      equityClient,
      cryptoClient,
      currencyClient,
      commodityClient,
    )
    const tool = tools.calculateIndicator as unknown as {
      execute: (input: {
        asset: string
        formula: string
        precision?: number
      }) => Promise<unknown>
    }

    if (testCase.result.ok) {
      const out = await tool.execute({ asset, formula, precision })
      expect(out).toEqual(testCase.result.output)
    } else {
      await expect(
        tool.execute({ asset, formula, precision }),
      ).rejects.toThrow(testCase.result.error.message)
    }
  })
}

interface ShimClients {
  equityClient: EquityClientLike
  cryptoClient: CryptoClientLike
  currencyClient: CurrencyClientLike
  commodityClient: CommodityClientLike
}

function buildShimClients(file: FixtureFile): ShimClients {
  const byAsset = file.datasets.toolShimUnsortedRawBars.byAsset
  const histFor = (asset: string) => async () =>
    byAsset[asset] as unknown as Array<Record<string, unknown>>

  const stub = (): Promise<never> => {
    throw new Error('not used by parity harness')
  }

  // The tool only invokes getHistorical (or getSpotPrices for commodity) under these cases.
  // All other interface methods are stubbed; calling one indicates a regression in routing.
  const equityClient = new Proxy(
    { getHistorical: histFor('equity') },
    { get: (target, prop) => (target as Record<string, unknown>)[prop as string] ?? stub },
  ) as unknown as EquityClientLike

  const cryptoClient = new Proxy(
    { getHistorical: histFor('crypto') },
    { get: (target, prop) => (target as Record<string, unknown>)[prop as string] ?? stub },
  ) as unknown as CryptoClientLike

  const currencyClient = new Proxy(
    { getHistorical: histFor('currency') },
    { get: (target, prop) => (target as Record<string, unknown>)[prop as string] ?? stub },
  ) as unknown as CurrencyClientLike

  const commodityClient = new Proxy(
    { getSpotPrices: histFor('commodity') },
    { get: (target, prop) => (target as Record<string, unknown>)[prop as string] ?? stub },
  ) as unknown as CommodityClientLike

  return { equityClient, cryptoClient, currencyClient, commodityClient }
}
