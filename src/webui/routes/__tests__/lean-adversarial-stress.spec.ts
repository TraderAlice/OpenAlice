import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
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

describe('LEAN WebUI Routes — Adversarial & Empirical Stress Suite', () => {
  let tempDir: string
  let algoManager: AlgorithmManager
  let expStore: ExperimentStore
  let jnlStore: TradeJournalStore
  let mockLeanService: LeanService
  let mockBacktestResult: BacktestResult

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lean-routes-stress-'))
    const algosDir = join(tempDir, 'data/lean/algorithms')
    const expsDir = join(tempDir, 'data/lean/experiments')
    const jnlDir = join(tempDir, 'data/lean/journal')
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
      id: 'bt_stress_999',
      request: {
        strategyName: 'StressTestStrategy',
        symbol: 'EURUSD',
        startDate: '2024-01-01',
        endDate: '2024-06-01'
      },
      status: 'completed',
      startedAt: '2024-06-01T10:00:00.000Z',
      completedAt: '2024-06-01T10:01:00.000Z',
      durationMs: 60000,
      statistics: {
        totalTrades: 30,
        winningTrades: 20,
        losingTrades: 10,
        winRate: 0.667,
        lossRate: 0.333,
        averageWin: 300,
        averageLoss: -150,
        profitLossRatio: 2.0,
        compoundingAnnualReturn: 0.28,
        drawdown: 0.04,
        netProfit: 4500,
        sharpeRatio: 2.15,
        sortinoRatio: 2.5,
        probabilisticSharpeRatio: 0.95,
        expectancy: 150,
        totalFees: 60,
        alpha: 0.15,
        beta: 0.04,
        annualStandardDeviation: 0.10,
        annualVariance: 0.01,
        informationRatio: 1.6,
        trackingError: 0.07,
        raw: {}
      },
      charts: {
        StrategyEquity: {
          name: 'StrategyEquity',
          unit: '$',
          values: [
            { x: 1704067200, y: 100000 },
            { x: 1717200000, y: 104500 }
          ]
        }
      },
      orders: [],
      closedTrades: []
    }

    mockLeanService = {
      enabled: true,
      checkDocker: vi.fn().mockResolvedValue({ available: true, version: 'Docker 27.0.0' }),
      checkLeanCli: vi.fn().mockResolvedValue({ available: true, version: 'lean 1.0.229' }),
      runBacktest: vi.fn().mockImplementation(async (req) => {
        if (req.strategyName === 'THROW_ERROR') {
          throw new Error('Simulated LEAN engine crash')
        }
        return {
          ...mockBacktestResult,
          id: `bt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          request: req,
          statistics: {
            ...mockBacktestResult.statistics,
            sharpeRatio: (req.parameters?.fastEma || 10) > 15 ? 2.5 : 1.5,
            netProfit: (req.parameters?.slowEma || 30) * 100
          }
        }
      }),
      getBacktest: vi.fn().mockImplementation(async (id: string) => {
        if (id === 'bt_stress_999') return mockBacktestResult
        return null
      }),
      listBacktests: vi.fn().mockResolvedValue([
        {
          id: 'bt_stress_999',
          strategyName: 'StressTestStrategy',
          symbol: 'EURUSD',
          startDate: '2024-01-01',
          endDate: '2024-06-01',
          status: 'completed',
          startedAt: '2024-06-01T10:00:00.000Z',
          netProfit: 4500,
          sharpeRatio: 2.15,
          drawdown: 0.04,
          totalTrades: 30
        }
      ]),
      ingestForexQuotes: vi.fn().mockImplementation(async (symbol, quotes, market, resolution) => {
        if (symbol === 'INVALID_SYMBOL') {
          throw new Error('Symbol formatting failure')
        }
        return {
          symbol,
          market,
          resolution,
          totalQuotes: quotes.length,
          daysProcessed: 1,
          filesWritten: [`${symbol}_${resolution}.zip`]
        }
      })
    } as unknown as LeanService
  })

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  function createTestApp(overrideDeps: Partial<Parameters<typeof createLeanRoutes>[1]> = {}) {
    return createLeanRoutes(undefined, {
      leanService: mockLeanService,
      algorithmManager: algoManager,
      experimentStore: expStore,
      journalStore: jnlStore,
      projectRoot: tempDir,
      ...overrideDeps
    })
  }

  // ==================== 1. Configuration & Status Endpoints ====================
  describe('1. Config & Status Stress Testing', () => {
    it('handles disabled lean config without crashing', async () => {
      await writeFile(
        join(tempDir, 'data/config/lean.json'),
        JSON.stringify({ ...DEFAULT_LEAN_CONFIG, enabled: false }, null, 2),
        'utf8'
      )
      const app = createTestApp()
      const res = await app.request('/config')
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.config.enabled).toBe(false)
      expect(data.docker.available).toBe(true)
      expect(data.leanCli.available).toBe(true)

      const statusRes = await app.request('/status')
      expect(statusRes.status).toBe(200)
      const statusData = await statusRes.json()
      expect(statusData.enabled).toBe(false)
      expect(statusData.leanCliAvailable).toBe(true)
    })

    it('gracefully handles missing lean.json and creates default fallback config', async () => {
      await rm(join(tempDir, 'data/config/lean.json'))
      const app = createTestApp()
      const res = await app.request('/config')
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.config).toBeDefined()
      expect(data.config.dockerImage).toBe(DEFAULT_LEAN_CONFIG.dockerImage)
    })

    it('updates partial config via POST /config and persists to disk', async () => {
      const app = createTestApp()
      const updatePayload = { dockerImage: 'custom/lean:v2', containerMemory: '8g' }
      const res = await app.request('/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload)
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      expect(data.config.dockerImage).toBe('custom/lean:v2')
      expect(data.config.containerMemory).toBe('8g')

      // Verify file persistence on disk
      const raw = await readFile(join(tempDir, 'data/config/lean.json'), 'utf8')
      const parsed = JSON.parse(raw)
      expect(parsed.dockerImage).toBe('custom/lean:v2')
      expect(parsed.containerMemory).toBe('8g')
    })

    it('handles fallback when LeanService is null/undefined in deps', async () => {
      const app = createTestApp({ leanService: null })
      const res = await app.request('/status')
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveProperty('dockerAvailable')
      expect(data).toHaveProperty('templateCount')
      expect(data).toHaveProperty('dataDirectories')
    })
  })

  // ==================== 2. Strategy CRUD Endpoints ====================
  describe('2. Strategy CRUD Stress Testing', () => {
    it('rejects POST /strategies with empty or missing name', async () => {
      const app = createTestApp()
      const res = await app.request('/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'No name strategy' })
      })
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toContain('name is required')
    })

    it('creates strategy from built-in template and retrieves it', async () => {
      const app = createTestApp()
      const res = await app.request('/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'EMA Cross Test',
          templateId: 'ema-cross',
          parameters: { fastEma: 12, slowEma: 26 }
        })
      })
      expect(res.status).toBe(201)
      const data = await res.json()
      expect(data.strategy.id).toBeDefined()
      expect(data.strategy.templateId).toBe('ema-cross')
      expect(data.strategy.parameters.fastEma).toBe(12)

      // Fetch strategy by ID
      const getRes = await app.request(`/strategies/${data.strategy.id}`)
      expect(getRes.status).toBe(200)
      const getData = await getRes.json()
      expect(getData.strategy.name).toBe('EMA Cross Test')

      // Update strategy
      const updateRes = await app.request(`/strategies/${data.strategy.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Updated EMA Strategy',
          description: 'Updated description',
          parameters: { fastEma: 15, slowEma: 30 }
        })
      })
      expect(updateRes.status).toBe(200)
      const updateData = await updateRes.json()
      expect(updateData.strategy.name).toBe('Updated EMA Strategy')
      expect(updateData.strategy.parameters.fastEma).toBe(15)

      // Delete strategy
      const delRes = await app.request(`/strategies/${data.strategy.id}`, { method: 'DELETE' })
      expect(delRes.status).toBe(200)
      const delData = await delRes.json()
      expect(delData.success).toBe(true)

      // Confirm 404 after deletion
      const afterDel = await app.request(`/strategies/${data.strategy.id}`)
      expect(afterDel.status).toBe(404)
    })

    it('returns 404 when deleting or getting nonexistent strategy', async () => {
      const app = createTestApp()
      const getRes = await app.request('/strategies/nonexistent-strat-id')
      expect(getRes.status).toBe(404)
      const delRes = await app.request('/strategies/nonexistent-strat-id', { method: 'DELETE' })
      expect(delRes.status).toBe(404)
    })
  })

  // ==================== 3. Template Retrieval ====================
  describe('3. Template Retrieval', () => {
    it('lists all built-in templates', async () => {
      const app = createTestApp()
      const res = await app.request('/templates')
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(Array.isArray(data.templates)).toBe(true)
      expect(data.templates.length).toBeGreaterThanOrEqual(3)
      const templateIds = data.templates.map((t: any) => t.id)
      expect(templateIds).toContain('ema-cross')
      expect(templateIds).toContain('rsi-mean-reversion')
      expect(templateIds).toContain('london-breakout')
    })

    it('fetches specific template and returns 404 for unknown template', async () => {
      const app = createTestApp()
      const res = await app.request('/templates/ema-cross')
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.template.id).toBe('ema-cross')
      expect(data.template.code).toContain('QCAlgorithm')

      const notFoundRes = await app.request('/templates/unknown-template')
      expect(notFoundRes.status).toBe(404)
    })
  })

  // ==================== 4. Backtest Simulation ====================
  describe('4. Backtest Simulation Endpoints', () => {
    it('rejects POST /backtests missing startDate or endDate', async () => {
      const app = createTestApp()
      const res = await app.request('/backtests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategyName: 'Test' })
      })
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toContain('startDate and endDate are required')
    })

    it('executes backtest simulation and returns typed results', async () => {
      const app = createTestApp()
      const res = await app.request('/backtests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyName: 'ValidStrategy',
          symbol: 'EURUSD',
          startDate: '2024-01-01',
          endDate: '2024-06-01',
          initialCash: 100000
        })
      })
      expect(res.status).toBe(201)
      const data = await res.json()
      expect(data.backtest.id).toBeDefined()
      expect(data.backtest.status).toBe('completed')
      expect(data.backtest.statistics.sharpeRatio).toBeDefined()
    })

    it('returns 500 when LEAN execution fails', async () => {
      const app = createTestApp()
      const res = await app.request('/backtests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyName: 'THROW_ERROR',
          symbol: 'EURUSD',
          startDate: '2024-01-01',
          endDate: '2024-06-01'
        })
      })
      expect(res.status).toBe(500)
      const data = await res.json()
      expect(data.error).toContain('Simulated LEAN engine crash')
    })

    it('fetches backtest by ID and returns 404 for unknown backtest', async () => {
      const app = createTestApp()
      const res = await app.request('/backtests/bt_stress_999')
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.backtest.id).toBe('bt_stress_999')

      const notFoundRes = await app.request('/backtests/unknown_bt')
      expect(notFoundRes.status).toBe(404)
    })
  })

  // ==================== 5. Experiments & Optimization Grid ====================
  describe('5. Experiments & Optimization Grid Execution', () => {
    it('creates, queries, and filters experiments', async () => {
      const app = createTestApp()
      // Missing fields validation
      const invalidRes = await app.request('/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategyId: 'strat1' })
      })
      expect(invalidRes.status).toBe(400)

      // Valid creation
      const createRes = await app.request('/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyId: 'strat_ema',
          hypothesis: 'Fast EMA outperforms in trending markets',
          instruments: ['EURUSD'],
          inSamplePeriod: { start: '2023-01-01', end: '2023-12-31' },
          outOfSamplePeriod: { start: '2024-01-01', end: '2024-06-30' },
          parameters: { fastEma: 10, slowEma: 30 },
          parameterRanges: {
            fastEma: { min: 10, max: 20, step: 5 },
            slowEma: { min: 30, max: 50, step: 10 }
          },
          tags: ['trend', 'ema']
        })
      })
      expect(createRes.status).toBe(201)
      const createData = await createRes.json()
      const expId = createData.experiment.id
      expect(expId).toBeDefined()

      // List with tag filter
      const listRes = await app.request('/experiments?tag=trend')
      expect(listRes.status).toBe(200)
      const listData = await listRes.json()
      expect(listData.experiments.length).toBe(1)
      expect(listData.experiments[0].id).toBe(expId)

      // Run backtest attached to experiment (in-sample)
      const runRes = await app.request(`/experiments/${expId}/run-backtest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'inSample' })
      })
      expect(runRes.status).toBe(200)
      const runData = await runRes.json()
      expect(runData.experiment.backtestIds.length).toBe(1)
      expect(runData.experiment.results.inSample).toBeDefined()

      // Execute grid optimization
      const optRes = await app.request(`/experiments/${expId}/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetMetric: 'sharpeRatio' })
      })
      expect(optRes.status).toBe(200)
      const optData = await optRes.json()
      expect(optData.optimizationRunId).toBeDefined()
      expect(optData.evaluatedCombinations).toBeGreaterThan(0)
      expect(optData.bestCombination).toBeDefined()
      expect(optData.results.length).toBe(optData.evaluatedCombinations)

      // Test lineage
      const lineageRes = await app.request(`/experiments/${expId}/lineage`)
      expect(lineageRes.status).toBe(200)
      const lineageData = await lineageRes.json()
      expect(lineageData.lineage.experiment.id).toBe(expId)
    })

    it('compares two experiments', async () => {
      const app = createTestApp()
      const expA = await expStore.create({
        strategyId: 'strat_a',
        hypothesis: 'Hypothesis A',
        inSamplePeriod: { start: '2023-01-01', end: '2023-06-30' },
        parameters: { param: 1 }
      })
      const expB = await expStore.create({
        strategyId: 'strat_b',
        hypothesis: 'Hypothesis B',
        inSamplePeriod: { start: '2023-01-01', end: '2023-06-30' },
        parameters: { param: 2 }
      })

      const compRes = await app.request('/experiments/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ experimentIdA: expA.id, experimentIdB: expB.id })
      })
      expect(compRes.status).toBe(200)
      const compData = await compRes.json()
      expect(compData.comparison.experimentA.id).toBe(expA.id)
      expect(compData.comparison.experimentB.id).toBe(expB.id)
      expect(compData.comparison.parameterDiffs).toBeDefined()
    })
  })

  // ==================== 6. Research Integrity ====================
  describe('6. Research Integrity & Statistical Validation', () => {
    it('evaluates research integrity via POST /integrity/evaluate without fake scores', async () => {
      const app = createTestApp()
      const evalRes = await app.request('/integrity/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyId: 'test_strategy',
          oosOptions: {
            isStats: mockBacktestResult.statistics,
            oosStats: {
              ...mockBacktestResult.statistics,
              sharpeRatio: 1.2,
              netProfit: 2000,
              drawdown: 0.08
            },
            isPeriod: { start: '2023-01-01', end: '2023-12-31' },
            oosPeriod: { start: '2024-01-01', end: '2024-06-30' },
            parameterCount: 3
          }
        })
      })
      expect(evalRes.status).toBe(200)
      const evalData = await evalRes.json()
      expect(evalData.report).toBeDefined()
      expect(evalData.report.outOfSample).toBeDefined()
      expect(evalData.report.outOfSample.sharpeDegradationPct).toBeDefined()
      // Evidence-based check: raw metrics present, no arbitrary single composite score
      expect(evalData.report.outOfSample.sharpeDegradationPct).toBeGreaterThan(0)
    })

    it('retrieves and dynamically generates integrity report for experiment', async () => {
      const app = createTestApp()
      const exp = await expStore.create({
        strategyId: 'strat_dynamic_integrity',
        hypothesis: 'Testing dynamic integrity calculation',
        inSamplePeriod: { start: '2023-01-01', end: '2023-12-31' },
        outOfSamplePeriod: { start: '2024-01-01', end: '2024-06-30' },
        parameters: { fast: 10 }
      })

      // Add inSample and outOfSample results to exp
      await expStore.update(exp.id, {
        results: {
          inSample: mockBacktestResult.statistics as any,
          outOfSample: {
            ...mockBacktestResult.statistics,
            sharpeRatio: 1.1,
            netProfit: 1500
          } as any
        }
      })

      const reportRes = await app.request(`/integrity/${exp.id}`)
      expect(reportRes.status).toBe(200)
      const reportData = await reportRes.json()
      expect(reportData.report.experimentId).toBe(exp.id)
      expect(reportData.report.outOfSample).toBeDefined()
    })
  })

  // ==================== 7. Trade Journal & Formalization ====================
  describe('7. Trade Journal & Formalization', () => {
    it('creates, formalizes, and filters trade journal entries', async () => {
      const app = createTestApp()
      // Missing required fields validation
      const invalidRes = await app.request('/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Incomplete Entry' })
      })
      expect(invalidRes.status).toBe(400)

      // Valid entry creation
      const createRes = await app.request('/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'EURUSD London Breakout Long',
          symbol: 'EURUSD',
          direction: 'long',
          entryTime: '2024-06-03T07:05:00.000Z',
          entryPrice: 1.0850,
          stopLoss: 1.0820,
          takeProfit: 1.0910,
          hypothesis: 'Clean 07:00 breakout above Asian session high with strong volume',
          indicators: { asianHigh: 1.0845, ema20: 1.0835 },
          tags: ['breakout', 'london']
        })
      })
      expect(createRes.status).toBe(201)
      const createData = await createRes.json()
      const jnlId = createData.entry.id
      expect(jnlId).toBeDefined()
      expect(createData.entry.formalizationStatus).toBe('draft')

      // List with filter
      const listRes = await app.request('/journal?symbol=EURUSD&direction=long')
      expect(listRes.status).toBe(200)
      const listData = await listRes.json()
      expect(listData.entries.length).toBe(1)
      expect(listData.entries[0].id).toBe(jnlId)

      // Formalize into systematic strategy proposal
      const formRes = await app.request(`/journal/${jnlId}/formalize`, { method: 'POST' })
      expect(formRes.status).toBe(200)
      const formData = await formRes.json()
      expect(formData.proposal).toBeDefined()
      expect(formData.proposal.entry.formalizationStatus).toBe('formalized')
      expect(formData.proposal.suggestedTemplateId).toBeDefined()
      expect(formData.proposal.suggestedParameters).toBeDefined()
      expect(formData.proposal.suggestedRanges).toBeDefined()
    })
  })

  // ==================== 8. Forex Data Ingestion ====================
  describe('8. Forex Data Ingestion', () => {
    it('rejects invalid ingestion payload', async () => {
      const app = createTestApp()
      const res = await app.request('/data/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: 'EURUSD', quotes: [] })
      })
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toContain('quotes array are required')
    })

    it('ingests quotes successfully', async () => {
      const app = createTestApp()
      const quotes = [
        {
          time: '2024-06-03T00:00:00.000Z',
          bid: { open: 1.085, high: 1.0855, low: 1.0848, close: 1.0852 },
          ask: { open: 1.0852, high: 1.0857, low: 1.085, close: 1.0854 }
        }
      ]
      const res = await app.request('/data/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: 'EURUSD',
          quotes,
          market: 'oanda',
          resolution: 'minute'
        })
      })
      expect(res.status).toBe(201)
      const data = await res.json()
      expect(data.result.symbol).toBe('EURUSD')
      expect(data.result.totalQuotes).toBe(1)
    })

    it('handles service errors during ingestion', async () => {
      const app = createTestApp()
      const res = await app.request('/data/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: 'INVALID_SYMBOL',
          quotes: [{ time: '2024-01-01T00:00:00Z', bid: { open: 1, high: 1, low: 1, close: 1 }, ask: { open: 1, high: 1, low: 1, close: 1 } }]
        })
      })
      expect(res.status).toBe(500)
      const data = await res.json()
      expect(data.error).toContain('Symbol formatting failure')
    })
  })
})
