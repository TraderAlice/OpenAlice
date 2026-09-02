/**
 * Frontend Typed API Client for LEAN Engine & LEAN GUI (`/api/lean/*`).
 */

import { fetchJson, headers } from './client'

export interface LeanConfig {
  enabled: boolean
  dockerImage: string
  dataDir: string
  algorithmsDir: string
  runsDir: string
  experimentsDir: string
  journalDir: string
  algorithmLanguage: 'Python' | 'CSharp'
  maxConcurrentBacktests: number
  defaultCash: number
  defaultBrokerage: string
  defaultTimeoutSeconds: number
  memoryLimit?: string
  cpuLimit?: string
}

export interface DockerStatus {
  available: boolean
  version?: string
  error?: string
}

export interface LeanStatus {
  enabled: boolean
  dockerAvailable: boolean
  dockerVersion?: string
  dockerError?: string
  leanCliAvailable: boolean
  leanCliVersion?: string
  leanCliError?: string
  templateCount: number
  strategyCount: number
  experimentCount: number
  backtestCount: number
  journalCount: number
  dataDirectories: {
    data: boolean
    algorithms: boolean
    runs: boolean
    experiments: boolean
    journal: boolean
  }
}

export interface StrategyTemplateParameter {
  name: string
  type: 'string' | 'number' | 'boolean'
  defaultValue: string | number | boolean
  min?: number
  max?: number
  description?: string
}

export interface StrategyTemplate {
  id: string
  name: string
  description: string
  category: 'trend' | 'breakout' | 'mean-reversion' | 'momentum' | string
  code: string
  defaultParameters: Record<string, string | number | boolean>
  parameterDefs: StrategyTemplateParameter[]
}

export interface StrategyMetadata {
  id: string
  name: string
  description: string
  templateId?: string
  parameters: Record<string, string | number | boolean>
  parameterDefs: StrategyTemplateParameter[]
  filePath: string
  createdAt: string
  updatedAt: string
}

export interface LeanStrategy extends StrategyMetadata {
  code: string
}

export interface CreateStrategyOptions {
  id?: string
  name: string
  description?: string
  templateId?: string
  code?: string
  parameters?: Record<string, string | number | boolean>
}

export interface UpdateStrategyOptions {
  name?: string
  description?: string
  code?: string
  parameters?: Record<string, string | number | boolean>
}

export interface BacktestRequest {
  strategyId?: string
  strategyName: string
  pythonCode?: string
  symbol: string
  market?: string
  resolution?: 'minute' | 'hour' | 'daily'
  startDate: string
  endDate: string
  initialCash?: number
  parameters?: Record<string, string | number | boolean>
  brokerage?: string
  timeoutSeconds?: number
}

export interface ChartPoint {
  x: number
  y: number
}

export interface ChartSeries {
  name: string
  unit: string
  values: ChartPoint[]
}

export interface LeanOrder {
  id: number
  symbol: string
  price: number
  quantity: number
  direction: 'Buy' | 'Sell' | 'Hold'
  type: string
  status: string
  time: string
  createdTime?: string
  lastFillTime?: string | null
  tag?: string
  fee: number
  feeCurrency: string
  value: number
}

export interface ClosedTrade {
  symbol: string
  entryTime: string
  entryPrice: number
  exitTime: string
  exitPrice: number
  quantity: number
  profitLoss: number
  totalFees: number
  mae: number
  mfe: number
  duration: string
}

export interface LeanStatistics {
  totalTrades: number
  winningTrades: number
  losingTrades: number
  winRate: number
  lossRate: number
  averageWin: number
  averageLoss: number
  profitLossRatio: number
  compoundingAnnualReturn: number
  drawdown: number
  netProfit: number
  sharpeRatio: number
  sortinoRatio: number
  probabilisticSharpeRatio: number
  expectancy: number
  totalFees: number
  alpha: number
  beta: number
  annualStandardDeviation: number
  annualVariance: number
  informationRatio: number
  trackingError: number
  raw: Record<string, string>
}

export interface LeanRuntimeStatistics {
  equity: number
  fees: number
  holdings: number
  netProfit: number
  returnPct: number
  unrealized: number
  volume: number
  raw: Record<string, string>
}

export interface BacktestResult {
  id: string
  request: BacktestRequest
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout'
  startedAt: string
  completedAt?: string
  durationMs?: number
  exitCode?: number
  statistics?: LeanStatistics
  runtimeStatistics?: LeanRuntimeStatistics
  charts: Record<string, ChartSeries>
  orders: LeanOrder[]
  closedTrades: ClosedTrade[]
  logs?: string
  error?: string
  runDir?: string
}

export interface BacktestSummary {
  id: string
  strategyName: string
  symbol: string
  startDate: string
  endDate: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout'
  startedAt: string
  completedAt?: string
  netProfit?: number
  sharpeRatio?: number
  drawdown?: number
  totalTrades?: number
}

export interface OutOfSampleReport {
  isPeriod: { start: string; end: string }
  oosPeriod: { start: string; end: string }
  isSharpe: number
  oosSharpe: number
  sharpeDegradationPct: number
  isNetProfit: number
  oosNetProfit: number
  netProfitDegradationPct: number
  isWinRate: number
  oosWinRate: number
  isMaxDrawdown: number
  oosMaxDrawdown: number
  parameterCount: number
  independentDataPoints: number
  parameterToDataRatio: number
  deflatedSharpeRatio: {
    dsr: number
    expectedMaxSharpeNull: number
    estimatedSharpe: number
    sampleLengthT: number
    skewness: number
    kurtosis: number
    trialsTested: number
  }
  interpretation: string
  academicReferences: string[]
}

export interface WalkForwardWindow {
  windowIndex: number
  isPeriod: { start: string; end: string }
  oosPeriod: { start: string; end: string }
  isReturn: number
  oosReturn: number
  isSharpe: number
  oosSharpe: number
  isMaxDrawdown: number
  oosMaxDrawdown: number
  wfeRatio: number
}

export interface WalkForwardReport {
  mode: 'rolling' | 'anchored'
  windowCount: number
  windows: WalkForwardWindow[]
  aggregateIsReturn: number
  aggregateOosReturn: number
  walkForwardEfficiency: number
  positiveOosWindowRatio: number
  consistentSharpeWindowRatio: number
  maxOosDrawdown: number
  interpretation: string
  academicReferences: string[]
}

export interface MonteCarloPercentiles {
  p05: number
  p25: number
  p50: number
  p75: number
  p95: number
  p99?: number
}

export interface MonteCarloReport {
  iterations: number
  tradeCount: number
  initialEquity: number
  ruinThresholdPct: number
  ruinProbability: number
  maxDrawdownDistribution: MonteCarloPercentiles
  finalReturnDistribution: MonteCarloPercentiles
  sharpeRatioDistribution: MonteCarloPercentiles
  longestLosingStreakDistribution: {
    median: number
    p95: number
    max: number
  }
  confidenceIntervals: {
    maxDrawdown95: [number, number]
    finalReturn95: [number, number]
  }
  methodologyAssumptions: string[]
  academicReferences: string[]
}

export interface ParameterPerturbation {
  parameterName: string
  baseValue: number
  perturbedValue: number
  perturbationPct: number
  resultingSharpe: number
  resultingNetProfit: number
  resultingMaxDrawdown: number
  sharpeChangePct: number
  elasticity: number
}

export interface ParameterSensitivityReport {
  baseParameters: Record<string, number>
  perturbations: ParameterPerturbation[]
  parameterFragility: Record<string, {
    maxSharpeDropPct: number
    averageElasticity: number
    isUnstable: boolean
  }>
  interpretation: string
  academicReferences: string[]
}

export interface DataSnoopingReport {
  totalHistoricalTrials: number
  nominalAlpha: number
  bonferroniAlpha: number
  rawPValue: number
  bonferroniAdjustedPValue: number
  holmAdjustedPValue: number
  expectedFalseDiscoveries: number
  tStatistic: number
  haircutSharpeRatio: number
  isSignificantAfterCorrection: boolean
  interpretation: string
  academicReferences: string[]
}

export interface ResearchIntegrityReport {
  experimentId?: string
  strategyId?: string
  evaluatedAt: string
  outOfSample?: OutOfSampleReport
  walkForward?: WalkForwardReport
  monteCarlo?: MonteCarloReport
  sensitivity?: ParameterSensitivityReport
  dataSnooping?: DataSnoopingReport
  summaryFindings: string[]
  methodologyNotice: string
}

export interface Experiment {
  id: string
  strategyId: string
  strategyVersion?: string
  gitCommit?: string
  hypothesis: string
  parameters: Record<string, string | number | boolean>
  parameterRanges?: Record<string, { min: number; max: number; step: number }>
  instruments: string[]
  timeframe: { resolution: string; start: string; end: string }
  dataSource: string
  inSamplePeriod: { start: string; end: string }
  outOfSamplePeriod?: { start: string; end: string }
  backtestIds: string[]
  optimizationRunId?: string
  results?: {
    inSample?: LeanStatistics
    outOfSample?: LeanStatistics
  }
  researchIntegrity?: ResearchIntegrityReport
  aiAnalysis?: string
  manualNotes?: string
  parentExperimentId?: string
  childExperimentIds?: string[]
  source: 'manual' | 'ai' | 'optimization' | 'journal'
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface CreateExperimentOptions {
  id?: string
  strategyId: string
  strategyVersion?: string
  hypothesis: string
  parameters: Record<string, string | number | boolean>
  parameterRanges?: Record<string, { min: number; max: number; step: number }>
  instruments?: string[]
  timeframe?: { resolution: string; start: string; end: string }
  dataSource?: string
  inSamplePeriod: { start: string; end: string }
  outOfSamplePeriod?: { start: string; end: string }
  parentExperimentId?: string
  source?: 'manual' | 'ai' | 'optimization' | 'journal'
  tags?: string[]
  manualNotes?: string
}

export interface ExperimentFilter {
  strategyId?: string
  symbol?: string
  source?: string
  tag?: string
  limit?: number
}

export interface ExperimentLineageNode {
  experiment: Experiment
  children: ExperimentLineageNode[]
}

export interface ExperimentComparison {
  experimentA: Experiment
  experimentB: Experiment
  parameterDiffs: Record<string, { a: unknown; b: unknown }>
  metricDiffs: {
    isSharpeDiff?: number
    oosSharpeDiff?: number
    isNetProfitDiff?: number
    oosNetProfitDiff?: number
    isDrawdownDiff?: number
    oosDrawdownDiff?: number
  }
}

export interface OptimizationRunResult {
  experiment: Experiment
  optimizationRunId: string
  totalCombinations: number
  evaluatedCombinations: number
  bestCombination: {
    parameters: Record<string, number>
    backtestId: string
    status: string
    statistics?: LeanStatistics
  }
  results: Array<{
    parameters: Record<string, number>
    backtestId: string
    status: string
    statistics?: LeanStatistics
  }>
}

export interface TradeJournalEntry {
  id: string
  title: string
  symbol: string
  direction: 'long' | 'short'
  entryTime: string
  exitTime?: string
  entryPrice: number
  exitPrice?: number
  profitLoss?: number
  hypothesis: string
  marketContext?: {
    session?: 'Asian' | 'London' | 'NewYork' | 'Overlap' | string
    trend?: 'uptrend' | 'downtrend' | 'range' | string
    newsEvents?: string[]
    notes?: string
  }
  review?: {
    whatWorked?: string
    whatFailed?: string
    emotionalState?: string
    lessonsLearned?: string
  }
  formalizationStatus: 'draft' | 'formalized' | 'backtested'
  formalizedStrategyId?: string
  formalizedExperimentId?: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface CreateJournalEntryOptions {
  id?: string
  title: string
  symbol: string
  direction: 'long' | 'short'
  entryTime: string
  exitTime?: string
  entryPrice: number
  exitPrice?: number
  profitLoss?: number
  hypothesis: string
  marketContext?: TradeJournalEntry['marketContext']
  review?: TradeJournalEntry['review']
  tags?: string[]
}

export interface JournalFilter {
  symbol?: string
  direction?: 'long' | 'short'
  formalizationStatus?: 'draft' | 'formalized' | 'backtested'
  tag?: string
  limit?: number
}

export interface FormalizedStrategyProposal {
  entry: TradeJournalEntry
  suggestedTemplateId: 'ema-cross' | 'london-breakout' | 'rsi-mean-reversion'
  strategyName: string
  formalizedHypothesis: string
  suggestedParameters: Record<string, string | number | boolean>
  suggestedRanges: Record<string, { min: number; max: number; step: number }>
}

export const leanApi = {
  // Config & Status
  getConfig: () => fetchJson<{ config: LeanConfig; docker: DockerStatus }>('/api/lean/config'),
  updateConfig: (updates: Partial<LeanConfig>) =>
    fetchJson<{ config: LeanConfig; success: boolean }>('/api/lean/config', {
      method: 'POST',
      headers,
      body: JSON.stringify(updates)
    }),
  getStatus: () => fetchJson<LeanStatus>('/api/lean/status'),

  // Templates
  listTemplates: () => fetchJson<{ templates: StrategyTemplate[] }>('/api/lean/templates'),
  getTemplate: (id: string) => fetchJson<{ template: StrategyTemplate }>(`/api/lean/templates/${encodeURIComponent(id)}`),

  // Strategies
  listStrategies: () => fetchJson<{ strategies: StrategyMetadata[] }>('/api/lean/strategies'),
  getStrategy: (id: string) => fetchJson<{ strategy: LeanStrategy }>(`/api/lean/strategies/${encodeURIComponent(id)}`),
  createStrategy: (options: CreateStrategyOptions) =>
    fetchJson<{ strategy: LeanStrategy }>('/api/lean/strategies', {
      method: 'POST',
      headers,
      body: JSON.stringify(options)
    }),
  updateStrategy: (id: string, updates: UpdateStrategyOptions) =>
    fetchJson<{ strategy: LeanStrategy }>(`/api/lean/strategies/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(updates)
    }),
  deleteStrategy: (id: string) =>
    fetchJson<{ success: boolean }>(`/api/lean/strategies/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    }),

  // Backtests
  listBacktests: () => fetchJson<{ backtests: BacktestSummary[] }>('/api/lean/backtests'),
  getBacktest: (id: string) => fetchJson<{ backtest: BacktestResult }>(`/api/lean/backtests/${encodeURIComponent(id)}`),
  runBacktest: (request: BacktestRequest) =>
    fetchJson<{ backtest: BacktestResult }>('/api/lean/backtests', {
      method: 'POST',
      headers,
      body: JSON.stringify(request)
    }),

  // Experiments & Lineage
  listExperiments: (filter?: ExperimentFilter) => {
    const params = new URLSearchParams()
    if (filter?.strategyId) params.set('strategyId', filter.strategyId)
    if (filter?.symbol) params.set('symbol', filter.symbol)
    if (filter?.source) params.set('source', filter.source)
    if (filter?.tag) params.set('tag', filter.tag)
    if (filter?.limit) params.set('limit', String(filter.limit))
    const query = params.toString() ? `?${params.toString()}` : ''
    return fetchJson<{ experiments: Experiment[] }>(`/api/lean/experiments${query}`)
  },
  getExperiment: (id: string) => fetchJson<{ experiment: Experiment }>(`/api/lean/experiments/${encodeURIComponent(id)}`),
  createExperiment: (options: CreateExperimentOptions) =>
    fetchJson<{ experiment: Experiment }>('/api/lean/experiments', {
      method: 'POST',
      headers,
      body: JSON.stringify(options)
    }),
  updateExperiment: (id: string, updates: Partial<Experiment>) =>
    fetchJson<{ experiment: Experiment }>(`/api/lean/experiments/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(updates)
    }),
  deleteExperiment: (id: string) =>
    fetchJson<{ success: boolean }>(`/api/lean/experiments/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    }),
  getExperimentLineage: (id: string) =>
    fetchJson<{ lineage: ExperimentLineageNode }>(`/api/lean/experiments/${encodeURIComponent(id)}/lineage`),
  compareExperiments: (experimentIdA: string, experimentIdB: string) =>
    fetchJson<{ comparison: ExperimentComparison }>('/api/lean/experiments/compare', {
      method: 'POST',
      headers,
      body: JSON.stringify({ experimentIdA, experimentIdB })
    }),
  runExperimentBacktest: (
    id: string,
    options: {
      type: 'inSample' | 'outOfSample'
      symbol?: string
      initialCash?: number
      parameters?: Record<string, string | number | boolean>
    }
  ) =>
    fetchJson<{ experiment: Experiment; backtest: BacktestResult }>(
      `/api/lean/experiments/${encodeURIComponent(id)}/run-backtest`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(options)
      }
    ),
  optimizeExperiment: (
    id: string,
    options: {
      parameterRanges?: Record<string, { min: number; max: number; step: number }>
      symbol?: string
      startDate?: string
      endDate?: string
      initialCash?: number
      targetMetric?: string
    }
  ) =>
    fetchJson<OptimizationRunResult>(`/api/lean/experiments/${encodeURIComponent(id)}/optimize`, {
      method: 'POST',
      headers,
      body: JSON.stringify(options)
    }),

  // Research Integrity
  getIntegrityReport: (experimentId: string) =>
    fetchJson<{ report: ResearchIntegrityReport }>(`/api/lean/integrity/${encodeURIComponent(experimentId)}`),
  evaluateIntegrity: (options: any) =>
    fetchJson<{ report: ResearchIntegrityReport }>('/api/lean/integrity/evaluate', {
      method: 'POST',
      headers,
      body: JSON.stringify(options)
    }),

  // Trade Journal
  listJournal: (filter?: JournalFilter) => {
    const params = new URLSearchParams()
    if (filter?.symbol) params.set('symbol', filter.symbol)
    if (filter?.direction) params.set('direction', filter.direction)
    if (filter?.formalizationStatus) params.set('formalizationStatus', filter.formalizationStatus)
    if (filter?.tag) params.set('tag', filter.tag)
    if (filter?.limit) params.set('limit', String(filter.limit))
    const query = params.toString() ? `?${params.toString()}` : ''
    return fetchJson<{ entries: TradeJournalEntry[] }>(`/api/lean/journal${query}`)
  },
  getJournal: (id: string) => fetchJson<{ entry: TradeJournalEntry }>(`/api/lean/journal/${encodeURIComponent(id)}`),
  createJournal: (options: CreateJournalEntryOptions) =>
    fetchJson<{ entry: TradeJournalEntry }>('/api/lean/journal', {
      method: 'POST',
      headers,
      body: JSON.stringify(options)
    }),
  updateJournal: (id: string, updates: Partial<TradeJournalEntry>) =>
    fetchJson<{ entry: TradeJournalEntry }>(`/api/lean/journal/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(updates)
    }),
  deleteJournal: (id: string) =>
    fetchJson<{ success: boolean }>(`/api/lean/journal/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    }),
  formalizeJournal: (id: string) =>
    fetchJson<{ proposal: FormalizedStrategyProposal }>(`/api/lean/journal/${encodeURIComponent(id)}/formalize`, {
      method: 'POST'
    }),

  // Data Ingestion
  ingestForexData: (payload: {
    symbol: string
    quotes: any[]
    market?: string
    resolution?: 'minute' | 'daily'
  }) =>
    fetchJson<{ result: any }>('/api/lean/data/ingest', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    })
}
