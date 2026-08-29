import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLeanRoutes } from '../lean.js'
import {
  LeanService,
  AlgorithmManager,
  ExperimentStore,
  TradeJournalStore,
  DEFAULT_LEAN_CONFIG,
  type BacktestResult
} from '../../../domain/lean/index.js'

describe('LEAN WebUI Routes (/api/lean)', () => {
  let tempDir: string
  let algoManager: AlgorithmManager
  let expStore: ExperimentStore
  let jnlStore: TradeJournalStore
  let mockLeanService: LeanService
  let mockBacktestResult: BacktestResult

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lean-routes-test-'))
    const algosDir = join(tempDir, 'algorithms')
    const expsDir = join(tempDir, 'experiments')
    const jnlDir = join(tempDir, 'journal')
    const configDir = join(tempDir, 'data/config')

    await mkdir(algosDir, { recursive: true })
    await mkdir(expsDir, { recursive: true })
    await mkdir(jnlDir, { recursive: true })
    await mkdir(configDir, { recursive: true })

    await writeFile(
      join(configDir, 'lean.json'),
      JSON.stringify({ ...DEFAULT_LEAN_CONFIG, enabled: true }, null, 2),
      'utf8'
    )

    algoManager = new AlgorithmManager(algosDir)
    expStore = new ExperimentStore(expsDir)
    jnlStore = new TradeJournalStore(jnlDir)

    mockBacktestResult = {
      id: 'bt_test_123',
      request: {
        strategyName: 'MockStrategy',
        symbol: 'EURUSD',
        startDate: '2024-01-01',
        endDate: '2024-06-01'
      },
      status: 'completed',
      startedAt: '2024-06-01T10:00:00.000Z',
      completedAt: '2024-06-01T10:01:00.000Z',
      durationMs: 60000,
      statistics: {
        totalTrades: 25,
        winningTrades: 16,
        losingTrades: 9,
        winRate: 0.64,
        lossRate: 0.36,
        averageWin: 250,
        averageLoss: -150,
        profitLossRatio: 1.67,
        compoundingAnnualReturn: 0.22,
        drawdown: 0.05,
        netProfit: 3500,
        sharpeRatio: 1.85,
        sortinoRatio: 2.1,
        probabilisticSharpeRatio: 0.92,
        expectancy: 140,
        totalFees: 50,
        alpha: 0.12,
        beta: 0.05,
        annualStandardDeviation: 0.11,
        annualVariance: 0.0121,
        informationRatio: 1.4,
        trackingError: 0.08,
        raw: {}
      },
      charts: {
        StrategyEquity: {
          name: 'StrategyEquity',
          unit: '$',
          values: [
            { x: 1704067200, y: 100000 },
            { x: 1717200000, y: 103500 }
          ]
        }
      },
      orders: [],
      closedTrades: []
    }

    mockLeanService = {
      enabled: true,
      checkDocker: vi.fn().mockResolvedValue({ available: true, version: 'Docker 27.0.0' }),
      runBacktest: vi.fn().mockResolvedValue(mockBacktestResult),
      getBacktest: vi.fn().mockImplementation(async (id: string) => {
        if (id === 'bt_test_123') return mockBacktestResult
        return null
      }),
      listBacktests: vi.fn().mockResolvedValue([
        {
          id: 'bt_test_123',
          strategyName: 'MockStrategy',
          symbol: 'EURUSD',
          startDate: '2024-01-01',
          endDate: '2024-06-01',
          status: 'completed',
          startedAt: '2024-06-01T10:00:00.000Z',
          netProfit: 3500,
          sharpeRatio: 1.85,
          drawdown: 0.05,
          totalTrades: 25
        }
      ]),
      ingestForexQuotes: vi.fn().mockResolvedValue({
        symbol: 'EURUSD',
        market: 'oanda',
        resolution: 'minute',
        totalQuotes: 100,
        daysProcessed: 1,
        filesWritten: ['20240101_quote.zip']
      })
    } as unknown as LeanService
  })

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  function createTestApp() {
    return createLeanRoutes(undefined, {
      leanService: mockLeanService,
      algorithmManager: algoManager,
      experimentStore: expStore,
      journalStore: jnlStore,
      projectRoot: tempDir
    })
  }

  describe('Config & Status', () => {
    it('GET /config returns current config and docker status', async () => {
      const app = createTestApp()
      const res = await app.request('/config')
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.config).toBeDefined()
      expect(data.config.enabled).toBe(true)
      expect(data.docker.available).toBe(true)
      expect(data.docker.version).toBe('Docker 27.0.0')
    })

    it('POST /config updates configuration', async () => {
      const app = createTestApp()
      const res = await app.request('/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultCash: 250000, maxConcurrentBacktests: 4 })
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.config.defaultCash).toBe(250000)
      expect(data.config.maxConcurrentBacktests).toBe(4)
      expect(data.success).toBe(true)
    })

    it('GET /status returns engine metrics and health', async () => {
      const app = createTestApp()
      const res = await app.request('/status')
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.enabled).toBe(true)
      expect(data.dockerAvailable).toBe(true)
      expect(data.templateCount).toBeGreaterThanOrEqual(3)
      expect(data.strategyCount).toBe(0)
      expect(data.backtestCount).toBe(1)
    })
  })

  describe('Templates', () => {
    it('GET /templates returns all built-in strategy templates', async () => {
      const app = createTestApp()
      const res = await app.request('/templates')
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.templates).toHaveLength(3)
      expect(data.templates.map((t: any) => t.id)).toContain('ema-cross')
      expect(data.templates.map((t: any) => t.id)).toContain('london-breakout')
      expect(data.templates.map((t: any) => t.id)).toContain('rsi-mean-reversion')
    })

    it('GET /templates/:id returns specific template or 404', async () => {
      const app = createTestApp()
      const res = await app.request('/templates/ema-cross')
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.template.id).toBe('ema-cross')
      expect(data.template.code).toContain('QCAlgorithm')

      const notFound = await app.request('/templates/nonexistent')
      expect(notFound.status).toBe(404)
    })
  })

  describe('Strategies CRUD', () => {
    it('POST /strategies creates strategy from template and GET /strategies lists it', async () => {
      const app = createTestApp()
      const createRes = await app.request('/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'EURUSD Trend Follower',
          templateId: 'ema-cross',
          parameters: { fast_period: 10, slow_period: 30 }
        })
      })

      expect(createRes.status).toBe(201)
      const created = await createRes.json()
      expect(created.strategy.id).toBe('eurusd-trend-follower')
      expect(created.strategy.parameters.fast_period).toBe(10)

      const listRes = await app.request('/strategies')
      expect(listRes.status).toBe(200)
      const listData = await listRes.json()
      expect(listData.strategies).toHaveLength(1)
      expect(listData.strategies[0].name).toBe('EURUSD Trend Follower')
    })

    it('GET /strategies/:id returns full strategy code and metadata', async () => {
      const app = createTestApp()
      await app.request('/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test-strat',
          name: 'Test Strategy',
          templateId: 'london-breakout'
        })
      })

      const res = await app.request('/strategies/test-strat')
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.strategy.id).toBe('test-strat')
      expect(data.strategy.code).toContain('class LondonBreakoutStrategy')

      const notFound = await app.request('/strategies/missing')
      expect(notFound.status).toBe(404)
    })

    it('PUT /strategies/:id updates strategy parameters and code', async () => {
      const app = createTestApp()
      await app.request('/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'updatable-strat',
          name: 'Updatable',
          templateId: 'rsi-mean-reversion'
        })
      })

      const updateRes = await app.request('/strategies/updatable-strat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Renamed Strategy',
          parameters: { rsi_period: 21 }
        })
      })

      expect(updateRes.status).toBe(200)
      const updated = await updateRes.json()
      expect(updated.strategy.name).toBe('Renamed Strategy')
      expect(updated.strategy.parameters.rsi_period).toBe(21)
    })

    it('DELETE /strategies/:id deletes strategy file and metadata', async () => {
      const app = createTestApp()
      await app.request('/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'deletable',
          name: 'Deletable',
          templateId: 'ema-cross'
        })
      })

      const delRes = await app.request('/strategies/deletable', { method: 'DELETE' })
      expect(delRes.status).toBe(200)
      expect((await delRes.json()).success).toBe(true)

      const getRes = await app.request('/strategies/deletable')
      expect(getRes.status).toBe(404)
    })
  })

  describe('Backtests Execution', () => {
    it('POST /backtests executes backtest via LeanService', async () => {
      const app = createTestApp()
      const res = await app.request('/backtests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyName: 'MockStrategy',
          symbol: 'EURUSD',
          startDate: '2024-01-01',
          endDate: '2024-06-01',
          initialCash: 100000
        })
      })

      expect(res.status).toBe(201)
      const data = await res.json()
      expect(data.backtest.id).toBe('bt_test_123')
      expect(data.backtest.statistics.sharpeRatio).toBe(1.85)
      expect(mockLeanService.runBacktest).toHaveBeenCalled()
    })

    it('POST /backtests rejects request missing required dates', async () => {
      const app = createTestApp()
      const res = await app.request('/backtests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyName: 'Invalid'
        })
      })
      expect(res.status).toBe(400)
    })

    it('GET /backtests and GET /backtests/:id returns historical runs', async () => {
      const app = createTestApp()
      const listRes = await app.request('/backtests')
      expect(listRes.status).toBe(200)
      const listData = await listRes.json()
      expect(listData.backtests).toHaveLength(1)
      expect(listData.backtests[0].id).toBe('bt_test_123')

      const detailRes = await app.request('/backtests/bt_test_123')
      expect(detailRes.status).toBe(200)
      const detailData = await detailRes.json()
      expect(detailData.backtest.statistics.netProfit).toBe(3500)

      const notFound = await app.request('/backtests/bt_unknown')
      expect(notFound.status).toBe(404)
    })
  })

  describe('Experiments & Optimization', () => {
    it('manages experiment lifecycle and lineage', async () => {
      const app = createTestApp()

      // 1. Create parent experiment
      const createRes = await app.request('/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'exp-parent',
          strategyId: 'eurusd-ema',
          hypothesis: 'Test trend following in London session',
          parameters: { fast: 10, slow: 30 },
          parameterRanges: {
            fast: { min: 8, max: 12, step: 2 }
          },
          inSamplePeriod: { start: '2023-01-01', end: '2023-12-31' },
          outOfSamplePeriod: { start: '2024-01-01', end: '2024-06-30' }
        })
      })

      expect(createRes.status).toBe(201)
      const exp1 = (await createRes.json()).experiment
      expect(exp1.id).toBe('exp-parent')

      // 2. Create child experiment
      const childRes = await app.request('/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'exp-child',
          strategyId: 'eurusd-ema',
          hypothesis: 'Refined parameters for child',
          parameters: { fast: 12, slow: 30 },
          parentExperimentId: 'exp-parent',
          inSamplePeriod: { start: '2023-01-01', end: '2023-12-31' }
        })
      })
      expect(childRes.status).toBe(201)

      // 3. Lineage tree
      const lineageRes = await app.request('/experiments/exp-parent/lineage')
      expect(lineageRes.status).toBe(200)
      const lineage = (await lineageRes.json()).lineage
      expect(lineage.experiment.id).toBe('exp-parent')
      expect(lineage.children).toHaveLength(1)
      expect(lineage.children[0].experiment.id).toBe('exp-child')

      // 4. Compare experiments
      const compRes = await app.request('/experiments/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          experimentIdA: 'exp-parent',
          experimentIdB: 'exp-child'
        })
      })
      expect(compRes.status).toBe(200)
      const comp = (await compRes.json()).comparison
      expect(comp.parameterDiffs.fast).toEqual({ a: 10, b: 12 })
    })

    it('POST /experiments/:id/run-backtest attaches in-sample and out-of-sample backtests', async () => {
      const app = createTestApp()
      await app.request('/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'exp-bt-test',
          strategyId: 'eurusd-ema',
          hypothesis: 'Testing IS run',
          parameters: { fast: 10 },
          inSamplePeriod: { start: '2023-01-01', end: '2023-12-31' },
          outOfSamplePeriod: { start: '2024-01-01', end: '2024-06-30' }
        })
      })

      const isRunRes = await app.request('/experiments/exp-bt-test/run-backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'inSample' })
      })

      expect(isRunRes.status).toBe(200)
      const isData = await isRunRes.json()
      expect(isData.backtest.id).toBe('bt_test_123')
      expect(isData.experiment.backtestIds).toContain('bt_test_123')
      expect(isData.experiment.results.inSample.sharpeRatio).toBe(1.85)
    })

    it('POST /experiments/:id/optimize runs grid optimization sweep', async () => {
      const app = createTestApp()
      await app.request('/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'exp-opt-test',
          strategyId: 'eurusd-ema',
          hypothesis: 'Grid optimization test',
          parameters: { fast: 10, slow: 20 },
          parameterRanges: {
            fast: { min: 8, max: 12, step: 2 }
          },
          inSamplePeriod: { start: '2023-01-01', end: '2023-12-31' }
        })
      })

      const optRes = await app.request('/experiments/exp-opt-test/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parameterRanges: {
            fast: { min: 8, max: 12, step: 2 }
          }
        })
      })

      expect(optRes.status).toBe(200)
      const optData = await optRes.json()
      expect(optData.optimizationRunId).toBeDefined()
      expect(optData.totalCombinations).toBe(3)
      expect(optData.evaluatedCombinations).toBe(3)
      expect(optData.bestCombination).toBeDefined()
    })
  })

  describe('Research Integrity', () => {
    it('POST /integrity/evaluate calculates evidence-first statistical checks', async () => {
      const app = createTestApp()
      const res = await app.request('/integrity/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oosOptions: {
            isStats: mockBacktestResult.statistics,
            oosStats: {
              ...mockBacktestResult.statistics,
              sharpeRatio: 1.4,
              netProfit: 2100,
              drawdown: 0.08
            },
            isPeriod: { start: '2023-01-01', end: '2023-12-31' },
            oosPeriod: { start: '2024-01-01', end: '2024-06-30' },
            parameterCount: 3
          },
          walkForwardOptions: {
            windows: [
              { windowIndex: 1, isSharpe: 2.1, oosSharpe: 1.8, isReturn: 0.15, oosReturn: 0.12 },
              { windowIndex: 2, isSharpe: 1.9, oosSharpe: 1.5, isReturn: 0.14, oosReturn: 0.1 }
            ]
          },
          monteCarloOptions: {
            tradeReturns: [0.02, -0.01, 0.03, -0.015, 0.04, -0.02, 0.01, 0.025],
            iterations: 100
          },
          sensitivityOptions: {
            baseParameters: { fast_period: 10 },
            baseSharpe: 1.85,
            baseNetProfit: 3500,
            baseMaxDrawdown: 0.05,
            perturbations: [
              {
                parameterName: 'fast_period',
                perturbedValue: 8,
                resultingSharpe: 1.8,
                resultingNetProfit: 3400,
                resultingMaxDrawdown: 0.052
              },
              {
                parameterName: 'fast_period',
                perturbedValue: 12,
                resultingSharpe: 1.82,
                resultingNetProfit: 3450,
                resultingMaxDrawdown: 0.051
              }
            ]
          },
          dataSnoopingOptions: {
            sharpeRatio: 1.8,
            totalHistoricalTrials: 20,
            sampleLengthT: 1260
          }
        })
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.report).toBeDefined()
      expect(data.report.outOfSample.sharpeDegradationPct).toBeGreaterThan(0)
      expect(data.report.walkForward.walkForwardEfficiency).toBeGreaterThan(0)
      expect(data.report.monteCarlo.iterations).toBe(100)
      expect(data.report.dataSnooping.haircutSharpeRatio).toBeLessThan(1.8)
      expect(data.report.summaryFindings.length).toBeGreaterThanOrEqual(4)
      expect(data.report.methodologyNotice).toContain('evidence-first')
    })
  })

  describe('Trade Journal & Formalization', () => {
    it('creates, lists, updates, deletes, and formalizes journal entries', async () => {
      const app = createTestApp()

      // 1. Create entry
      const createRes = await app.request('/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'jnl-1',
          title: 'EURUSD Asian Breakout Attempt',
          symbol: 'EURUSD',
          direction: 'long',
          entryTime: '2024-06-01T08:00:00.000Z',
          entryPrice: 1.085,
          hypothesis: 'London breakout on asian session high with momentum',
          tags: ['london', 'breakout']
        })
      })

      expect(createRes.status).toBe(201)
      const entry1 = (await createRes.json()).entry
      expect(entry1.title).toBe('EURUSD Asian Breakout Attempt')
      expect(entry1.formalizationStatus).toBe('draft')

      // 2. List with filter
      const listRes = await app.request('/journal?symbol=EURUSD&tag=london')
      expect(listRes.status).toBe(200)
      const listData = await listRes.json()
      expect(listData.entries).toHaveLength(1)

      // 3. Update entry
      const updateRes = await app.request('/journal/jnl-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exitPrice: 1.092,
          profitLoss: 700,
          review: { whatWorked: 'Clean extension after London open' }
        })
      })
      expect(updateRes.status).toBe(200)
      const updated = (await updateRes.json()).entry
      expect(updated.profitLoss).toBe(700)

      // 4. Formalize idea into systematic proposal
      const formRes = await app.request('/journal/jnl-1/formalize', { method: 'POST' })
      expect(formRes.status).toBe(200)
      const proposal = (await formRes.json()).proposal
      expect(proposal.suggestedTemplateId).toBe('london-breakout')
      expect(proposal.suggestedParameters.asian_start_hour).toBe(0)
      expect(proposal.entry.formalizationStatus).toBe('formalized')

      // 5. Delete entry
      const delRes = await app.request('/journal/jnl-1', { method: 'DELETE' })
      expect(delRes.status).toBe(200)
      expect((await delRes.json()).success).toBe(true)
    })
  })

  describe('Forex Data Ingestion', () => {
    it('POST /data/ingest ingests quotes via service', async () => {
      const app = createTestApp()
      const res = await app.request('/data/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: 'EURUSD',
          quotes: [
            {
              timestamp: '2024-01-01T00:00:00.000Z',
              bidOpen: 1.085,
              bidHigh: 1.086,
              bidLow: 1.084,
              bidClose: 1.0855,
              askOpen: 1.0852,
              askHigh: 1.0862,
              askLow: 1.0842,
              askClose: 1.0857
            }
          ]
        })
      })

      expect(res.status).toBe(201)
      const data = await res.json()
      expect(data.result.totalQuotes).toBe(100)
      expect(mockLeanService.ingestForexQuotes).toHaveBeenCalled()
    })
  })
})
