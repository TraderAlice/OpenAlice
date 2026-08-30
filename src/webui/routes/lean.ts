/**
 * LEAN Engine REST API Routes — `/api/lean/*`.
 *
 * Exposes full management and execution endpoints for LEAN GUI:
 * - Engine status & configuration
 * - QCAlgorithm templates and custom strategies
 * - Event-driven backtesting execution & results
 * - Quantitative experiments, lineage, and parameter optimization
 * - Evidence-based research integrity analysis
 * - Discretionary trade journal and systematic formalization
 * - Forex QuoteBar data ingestion
 */

import { Hono } from 'hono'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { EngineContext } from '../../core/types.js'
import {
  LeanService,
  DEFAULT_LEAN_CONFIG,
  type LeanConfig,
  type BacktestRequest,
  AlgorithmManager,
  type CreateStrategyOptions,
  type UpdateStrategyOptions,
  ExperimentStore,
  type CreateExperimentOptions,
  type ExperimentFilter,
  generateParameterGrid,
  TradeJournalStore,
  type CreateJournalEntryOptions,
  type JournalFilter,
  generateResearchIntegrityReport,
  type GenerateIntegrityReportOptions,
  type ForexQuote
} from '../../domain/lean/index.js'

export interface LeanRouteDeps {
  leanService?: LeanService | null
  algorithmManager?: AlgorithmManager
  experimentStore?: ExperimentStore
  journalStore?: TradeJournalStore
  projectRoot?: string
}

export function createLeanRoutes(ctx?: EngineContext, deps: LeanRouteDeps = {}): Hono {
  const app = new Hono()
  const projectRoot = deps.projectRoot ?? process.cwd()

  const configPath = join(projectRoot, 'data/config/lean.json')

  // Helper to load current config on demand
  async function loadCurrentConfig(): Promise<LeanConfig> {
    let loaded: Partial<LeanConfig> = {}
    if (existsSync(configPath)) {
      try {
        const raw = await readFile(configPath, 'utf8')
        loaded = JSON.parse(raw)
      } catch {
        // use fallback
      }
    }
    return {
      ...DEFAULT_LEAN_CONFIG,
      ...loaded
    }
  }

  // Domain service instances with fallback
  const algorithmsDir = resolve(projectRoot, 'data/lean/algorithms')
  const experimentsDir = resolve(projectRoot, 'data/lean/experiments')
  const journalDir = resolve(projectRoot, 'data/lean/journal')

  const algoManager = deps.algorithmManager ?? new AlgorithmManager(algorithmsDir)
  const expStore = deps.experimentStore ?? new ExperimentStore(experimentsDir)
  const jnlStore = deps.journalStore ?? new TradeJournalStore(journalDir)

  // ==================== Configuration & Engine Status ====================

  app.get('/config', async (c) => {
    try {
      const config = await loadCurrentConfig()
      let dockerStatus: { available: boolean; version?: string; error?: string } = { available: false }
      let leanCliStatus: { available: boolean; version?: string; error?: string } = { available: false }
      if (deps.leanService) {
        dockerStatus = await deps.leanService.checkDocker()
        leanCliStatus = await deps.leanService.checkLeanCli()
      } else {
        const tempService = new LeanService(config, projectRoot)
        dockerStatus = await tempService.checkDocker()
        leanCliStatus = await tempService.checkLeanCli()
      }
      return c.json({ config, docker: dockerStatus, leanCli: leanCliStatus })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to read config' }, 500)
    }
  })

  app.post('/config', async (c) => {
    try {
      const updates = await c.req.json<Partial<LeanConfig>>()
      const current = await loadCurrentConfig()
      const merged: LeanConfig = { ...current, ...updates }
      await writeFile(configPath, JSON.stringify(merged, null, 2), 'utf8')
      return c.json({ config: merged, success: true })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to update config' }, 500)
    }
  })

  app.get('/status', async (c) => {
    try {
      const config = await loadCurrentConfig()
      let dockerStatus: { available: boolean; version?: string; error?: string } = { available: false }
      let leanCliStatus: { available: boolean; version?: string; error?: string } = { available: false }
      if (deps.leanService) {
        dockerStatus = await deps.leanService.checkDocker()
        leanCliStatus = await deps.leanService.checkLeanCli()
      } else {
        const tempService = new LeanService(config, projectRoot)
        dockerStatus = await tempService.checkDocker()
        leanCliStatus = await tempService.checkLeanCli()
      }

      const templates = await algoManager.listTemplates()
      const strategies = await algoManager.listStrategies()
      const experiments = await expStore.list()
      const journalEntries = await jnlStore.list()
      let backtestsCount = 0
      if (deps.leanService) {
        const bts = await deps.leanService.listBacktests()
        backtestsCount = bts.length
      }

      return c.json({
        enabled: config.enabled,
        dockerAvailable: dockerStatus.available,
        dockerVersion: dockerStatus.version,
        dockerError: dockerStatus.error,
        leanCliAvailable: leanCliStatus.available,
        leanCliVersion: leanCliStatus.version,
        leanCliError: leanCliStatus.error,
        templateCount: templates.length,
        strategyCount: strategies.length,
        experimentCount: experiments.length,
        backtestCount: backtestsCount,
        journalCount: journalEntries.length,
        dataDirectories: {
          data: existsSync(resolve(projectRoot, config.dataDir)),
          algorithms: existsSync(algorithmsDir),
          runs: existsSync(resolve(projectRoot, config.runsDir)),
          experiments: existsSync(experimentsDir),
          journal: existsSync(journalDir)
        }
      })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to get engine status' }, 500)
    }
  })

  // ==================== Templates ====================

  app.get('/templates', async (c) => {
    try {
      const templates = await algoManager.listTemplates()
      return c.json({ templates })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to list templates' }, 500)
    }
  })

  app.get('/templates/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const template = await algoManager.getTemplate(id)
      if (!template) {
        return c.json({ error: `Template '${id}' not found` }, 404)
      }
      return c.json({ template })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to get template' }, 500)
    }
  })

  // ==================== Strategies ====================

  app.get('/strategies', async (c) => {
    try {
      const strategies = await algoManager.listStrategies()
      return c.json({ strategies })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to list strategies' }, 500)
    }
  })

  app.get('/strategies/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const strategy = await algoManager.getStrategy(id)
      if (!strategy) {
        return c.json({ error: `Strategy '${id}' not found` }, 404)
      }
      return c.json({ strategy })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to get strategy' }, 500)
    }
  })

  app.post('/strategies', async (c) => {
    try {
      const body = await c.req.json<CreateStrategyOptions>()
      if (!body.name) {
        return c.json({ error: 'Strategy name is required' }, 400)
      }
      const strategy = await algoManager.createStrategy(body)
      return c.json({ strategy }, 201)
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to create strategy' }, 400)
    }
  })

  app.put('/strategies/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const body = await c.req.json<UpdateStrategyOptions>()
      const strategy = await algoManager.updateStrategy(id, body)
      return c.json({ strategy })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to update strategy' }, 400)
    }
  })

  app.delete('/strategies/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const deleted = await algoManager.deleteStrategy(id)
      if (!deleted) {
        return c.json({ error: `Strategy '${id}' not found or could not be deleted` }, 404)
      }
      return c.json({ success: true })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to delete strategy' }, 500)
    }
  })

  // ==================== Backtesting Execution & Results ====================

  app.get('/backtests', async (c) => {
    try {
      let backtests: any[] = []
      if (deps.leanService) {
        backtests = await deps.leanService.listBacktests()
      } else {
        const config = await loadCurrentConfig()
        const tempService = new LeanService(config, projectRoot)
        backtests = await tempService.listBacktests()
      }
      return c.json({ backtests })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to list backtests' }, 500)
    }
  })

  app.get('/backtests/:id', async (c) => {
    try {
      const id = c.req.param('id')
      let result = null
      if (deps.leanService) {
        result = await deps.leanService.getBacktest(id)
      } else {
        const config = await loadCurrentConfig()
        const tempService = new LeanService(config, projectRoot)
        result = await tempService.getBacktest(id)
      }
      if (!result) {
        return c.json({ error: `Backtest '${id}' not found` }, 404)
      }
      return c.json({ backtest: result })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to get backtest' }, 500)
    }
  })

  app.post('/backtests', async (c) => {
    try {
      const body = await c.req.json<BacktestRequest>()
      if (!body.startDate || !body.endDate) {
        return c.json({ error: 'startDate and endDate are required' }, 400)
      }

      let service = deps.leanService
      if (!service) {
        const config = await loadCurrentConfig()
        service = new LeanService(config, projectRoot)
      }

      const backtest = await service.runBacktest(body)
      return c.json({ backtest }, 201)
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to run backtest' }, 500)
    }
  })

  // ==================== Experiments & Lineage ====================

  app.get('/experiments', async (c) => {
    try {
      const filter: ExperimentFilter = {}
      const strategyId = c.req.query('strategyId')
      const symbol = c.req.query('symbol')
      const source = c.req.query('source')
      const tag = c.req.query('tag')
      const limit = c.req.query('limit')

      if (strategyId) filter.strategyId = strategyId
      if (symbol) filter.symbol = symbol
      if (source) filter.source = source
      if (tag) filter.tag = tag
      if (limit) filter.limit = parseInt(limit, 10)

      const experiments = await expStore.list(filter)
      return c.json({ experiments })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to list experiments' }, 500)
    }
  })

  app.get('/experiments/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const experiment = await expStore.get(id)
      if (!experiment) {
        return c.json({ error: `Experiment '${id}' not found` }, 404)
      }
      return c.json({ experiment })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to get experiment' }, 500)
    }
  })

  app.post('/experiments', async (c) => {
    try {
      const body = await c.req.json<CreateExperimentOptions>()
      if (!body.strategyId || !body.hypothesis || !body.inSamplePeriod) {
        return c.json({ error: 'strategyId, hypothesis, and inSamplePeriod are required' }, 400)
      }
      const experiment = await expStore.create(body)
      return c.json({ experiment }, 201)
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to create experiment' }, 400)
    }
  })

  app.put('/experiments/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const body = await c.req.json<any>()
      const experiment = await expStore.update(id, body)
      return c.json({ experiment })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to update experiment' }, 400)
    }
  })

  app.delete('/experiments/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const deleted = await expStore.delete(id)
      if (!deleted) {
        return c.json({ error: `Experiment '${id}' not found or could not be deleted` }, 404)
      }
      return c.json({ success: true })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to delete experiment' }, 500)
    }
  })

  app.get('/experiments/:id/lineage', async (c) => {
    try {
      const id = c.req.param('id')
      const lineage = await expStore.getLineageTree(id)
      if (!lineage) {
        return c.json({ error: `Experiment lineage for '${id}' not found` }, 404)
      }
      return c.json({ lineage })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to get experiment lineage' }, 500)
    }
  })

  app.post('/experiments/compare', async (c) => {
    try {
      const { experimentIdA, experimentIdB } = await c.req.json<{ experimentIdA: string; experimentIdB: string }>()
      if (!experimentIdA || !experimentIdB) {
        return c.json({ error: 'experimentIdA and experimentIdB are required' }, 400)
      }
      const comparison = await expStore.compareExperiments(experimentIdA, experimentIdB)
      return c.json({ comparison })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to compare experiments' }, 400)
    }
  })

  app.post('/experiments/:id/run-backtest', async (c) => {
    try {
      const id = c.req.param('id')
      const experiment = await expStore.get(id)
      if (!experiment) {
        return c.json({ error: `Experiment '${id}' not found` }, 404)
      }

      const body = await c.req.json<{
        type: 'inSample' | 'outOfSample'
        symbol?: string
        initialCash?: number
        parameters?: Record<string, string | number | boolean>
      }>()

      const period = body.type === 'outOfSample' ? experiment.outOfSamplePeriod : experiment.inSamplePeriod
      if (!period) {
        return c.json({ error: `Experiment has no ${body.type} period defined` }, 400)
      }

      let service = deps.leanService
      if (!service) {
        const config = await loadCurrentConfig()
        service = new LeanService(config, projectRoot)
      }

      const backtest = await service.runBacktest({
        strategyId: experiment.strategyId,
        strategyName: `${experiment.strategyId}_${body.type}`,
        symbol: body.symbol || experiment.instruments[0] || 'EURUSD',
        startDate: period.start,
        endDate: period.end,
        initialCash: body.initialCash || 100000,
        parameters: { ...experiment.parameters, ...body.parameters }
      })

      // Link and update experiment
      await expStore.addBacktestId(id, backtest.id)
      if (backtest.statistics) {
        if (body.type === 'inSample') {
          await expStore.update(id, {
            results: { ...experiment.results, inSample: backtest.statistics }
          })
        } else {
          await expStore.update(id, {
            results: { ...experiment.results, outOfSample: backtest.statistics }
          })
        }
      }

      const updatedExp = await expStore.get(id)
      return c.json({ experiment: updatedExp, backtest })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to run experiment backtest' }, 500)
    }
  })

  app.post('/experiments/:id/optimize', async (c) => {
    try {
      const id = c.req.param('id')
      const experiment = await expStore.get(id)
      if (!experiment) {
        return c.json({ error: `Experiment '${id}' not found` }, 404)
      }

      const body = await c.req.json<{
        parameterRanges?: Record<string, { min: number; max: number; step: number }>
        symbol?: string
        startDate?: string
        endDate?: string
        initialCash?: number
        targetMetric?: string
      }>()

      const ranges = body.parameterRanges || experiment.parameterRanges
      if (!ranges || Object.keys(ranges).length === 0) {
        return c.json({ error: 'No parameter ranges provided for optimization' }, 400)
      }

      const grid = generateParameterGrid(ranges)
      const maxCombos = 25
      const combos = grid.slice(0, maxCombos)

      let service = deps.leanService
      if (!service) {
        const config = await loadCurrentConfig()
        service = new LeanService(config, projectRoot)
      }

      const startDate = body.startDate || experiment.inSamplePeriod.start
      const endDate = body.endDate || experiment.inSamplePeriod.end
      const symbol = body.symbol || experiment.instruments[0] || 'EURUSD'
      const initialCash = body.initialCash || 100000

      const runResults: Array<{
        parameters: Record<string, number>
        backtestId: string
        status: string
        statistics?: any
      }> = []

      for (const params of combos) {
        const res = await service.runBacktest({
          strategyId: experiment.strategyId,
          strategyName: `${experiment.strategyId}_opt`,
          symbol,
          startDate,
          endDate,
          initialCash,
          parameters: { ...experiment.parameters, ...params }
        })
        await expStore.addBacktestId(id, res.id)
        runResults.push({
          parameters: params,
          backtestId: res.id,
          status: res.status,
          statistics: res.statistics
        })
      }

      // Sort by Sharpe or NetProfit
      const metric = body.targetMetric || 'sharpeRatio'
      const sorted = [...runResults].sort((a, b) => {
        const valA = a.statistics?.[metric] ?? -999
        const valB = b.statistics?.[metric] ?? -999
        return valB - valA
      })

      const best = sorted[0]
      const optId = `opt_${Date.now()}`
      if (best && best.statistics) {
        await expStore.update(id, {
          optimizationRunId: optId,
          parameters: { ...experiment.parameters, ...best.parameters },
          results: { ...experiment.results, inSample: best.statistics }
        })
      }

      const updatedExp = await expStore.get(id)
      return c.json({
        experiment: updatedExp,
        optimizationRunId: optId,
        totalCombinations: grid.length,
        evaluatedCombinations: combos.length,
        bestCombination: best,
        results: sorted
      })
    } catch (err: any) {
      return c.json({ error: err.message || 'Optimization failed' }, 500)
    }
  })

  // ==================== Research Integrity ====================

  app.get('/integrity/:experimentId', async (c) => {
    try {
      const expId = c.req.param('experimentId')
      const exp = await expStore.get(expId)
      if (!exp) {
        return c.json({ error: `Experiment '${expId}' not found` }, 404)
      }

      if (exp.researchIntegrity) {
        return c.json({ report: exp.researchIntegrity })
      }

      // Generate report dynamically if experiment has inSample results
      if (exp.results?.inSample) {
        const report = generateResearchIntegrityReport({
          experimentId: exp.id,
          strategyId: exp.strategyId,
          oosOptions: exp.results.outOfSample ? {
            isStats: exp.results.inSample,
            oosStats: exp.results.outOfSample,
            isPeriod: exp.inSamplePeriod,
            oosPeriod: exp.outOfSamplePeriod ?? { start: exp.inSamplePeriod.end, end: exp.inSamplePeriod.end },
            parameterCount: Object.keys(exp.parameters || {}).length
          } : undefined
        })
        await expStore.update(expId, { researchIntegrity: report })
        return c.json({ report })
      }

      return c.json({ error: 'No backtest results attached to this experiment for integrity evaluation' }, 400)
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to get research integrity report' }, 500)
    }
  })

  app.post('/integrity/evaluate', async (c) => {
    try {
      const body = await c.req.json<GenerateIntegrityReportOptions>()
      const report = generateResearchIntegrityReport(body)
      if (body.experimentId) {
        try {
          await expStore.update(body.experimentId, { researchIntegrity: report })
        } catch {
          // ignore
        }
      }
      return c.json({ report })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to evaluate research integrity' }, 500)
    }
  })

  // ==================== Trade Journal & Idea Formalization ====================

  app.get('/journal', async (c) => {
    try {
      const filter: JournalFilter = {}
      const symbol = c.req.query('symbol')
      const direction = c.req.query('direction') as 'long' | 'short' | undefined
      const formalizationStatus = c.req.query('formalizationStatus') as any
      const tag = c.req.query('tag')
      const limit = c.req.query('limit')

      if (symbol) filter.symbol = symbol
      if (direction) filter.direction = direction
      if (formalizationStatus) filter.formalizationStatus = formalizationStatus
      if (tag) filter.tag = tag
      if (limit) filter.limit = parseInt(limit, 10)

      const entries = await jnlStore.list(filter)
      return c.json({ entries })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to list journal entries' }, 500)
    }
  })

  app.get('/journal/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const entry = await jnlStore.get(id)
      if (!entry) {
        return c.json({ error: `Journal entry '${id}' not found` }, 404)
      }
      return c.json({ entry })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to get journal entry' }, 500)
    }
  })

  app.post('/journal', async (c) => {
    try {
      const body = await c.req.json<CreateJournalEntryOptions>()
      if (!body.title || !body.symbol || !body.direction || !body.entryTime || body.entryPrice == null || !body.hypothesis) {
        return c.json({ error: 'title, symbol, direction, entryTime, entryPrice, and hypothesis are required' }, 400)
      }
      const entry = await jnlStore.create(body)
      return c.json({ entry }, 201)
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to create journal entry' }, 400)
    }
  })

  app.put('/journal/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const body = await c.req.json<any>()
      const entry = await jnlStore.update(id, body)
      return c.json({ entry })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to update journal entry' }, 400)
    }
  })

  app.delete('/journal/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const deleted = await jnlStore.delete(id)
      if (!deleted) {
        return c.json({ error: `Journal entry '${id}' not found or could not be deleted` }, 404)
      }
      return c.json({ success: true })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to delete journal entry' }, 500)
    }
  })

  app.post('/journal/:id/formalize', async (c) => {
    try {
      const id = c.req.param('id')
      const proposal = await jnlStore.formalizeIdea(id)
      return c.json({ proposal })
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to formalize journal entry' }, 400)
    }
  })

  // ==================== Forex Data Ingestion ====================

  app.post('/data/ingest', async (c) => {
    try {
      const body = await c.req.json<{
        symbol: string
        quotes: ForexQuote[]
        market?: string
        resolution?: 'minute' | 'daily'
      }>()

      if (!body.symbol || !Array.isArray(body.quotes) || body.quotes.length === 0) {
        return c.json({ error: 'symbol and non-empty quotes array are required' }, 400)
      }

      let service = deps.leanService
      if (!service) {
        const config = await loadCurrentConfig()
        service = new LeanService(config, projectRoot)
      }

      const result = await service.ingestForexQuotes(
        body.symbol,
        body.quotes,
        body.market || 'oanda',
        body.resolution || 'minute'
      )

      return c.json({ result }, 201)
    } catch (err: any) {
      return c.json({ error: err.message || 'Failed to ingest forex data' }, 500)
    }
  })

  return app
}
