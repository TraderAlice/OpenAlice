import { fetchJson } from './client'

export type EvidenceTone = 'muted' | 'red' | 'amber'
export type QualityTone = EvidenceTone | 'green'
export type BridgeState = 'awaiting_bridge' | 'stale' | 'unsafe_account' | 'disconnected' | 'ready'
export type Mt5LearningState = 'no_data' | 'learning' | 'blocked' | 'stale'
export type JmbDecisionState = 'no_decision' | 'shadow' | 'demo_blocked' | 'error'

export interface Mt5TradeLedgerSummary {
  state: Mt5LearningState
  label: string
  detail: string
  broker: string
  symbol: string
  accountMode: string | null
  server: string | null
  lastDealTime: string | null
  lastUpdated: string | null
  totalDeals: number
  manualDeals: number
  eaDeals: number
  otherDeals: number
  unknownDeals: number
  netProfit: number
}

export interface JmbDecisionSummary {
  state: JmbDecisionState
  label: string
  detail: string
  broker: string
  symbol: string
  lastUpdated: string | null
  decision: null | {
    decisionId: string
    createdAt: string
    strategyVersion: string
    mode: string
    direction: string
    reasonCode: string
    reasonDetail: string
    spread: number | null
    volume: number
    stopLoss: number | null
    gateResults: Array<{ gate: string; state: string; detail: string }>
  }
}

export interface ResearchInstrument {
  broker: string
  symbol: string
  bridgeSymbol?: string
  label: string
  export: {
    available: boolean
    files: number
    firstFile: string | null
    lastFile: string | null
    totalBytes: number
    lastUpdated: string | null
  }
  quality: {
    label: string
    tone: QualityTone
    inspectedFiles: number
    likelyM1Files: number
    fallbackFiles: number
    badRows: number
    duplicateRows: number
  }
  report: null | {
    data: { daily_bars: number; first_day: string; last_day: string }
    selected_on_training_sharpe: { lookback_days: number; sharpe: number | null; max_drawdown: number | null }
    untouched_holdout: { total_return: number | null; sharpe: number | null; max_drawdown: number | null }
    latest_observation?: { as_of: string; direction: 'uptrend' | 'downtrend' | 'flat'; lookback_return: number; lookback_days: number }
  }
  walkForward: null | {
    method: { training_months: number; test_months: number }
    windows: unknown[]
    out_of_sample_aggregate: { total_return: number | null; sharpe: number | null; max_drawdown: number | null }
  }
  bridge: {
    state: BridgeState
    label: string
    detail: string
    broker: string
    symbol: string
    server: string | null
    capturedAt: string | null
    lastUpdated: string | null
    bid: number | null
    ask: number | null
    spread: number | null
    openPositions: number | null
    openOrders: number | null
  }
  learning: Mt5TradeLedgerSummary
  decision: JmbDecisionSummary
  evidence: { label: string; tone: EvidenceTone; score: number }
}

export interface ResearchDashboard {
  asOf: string
  mode: 'research_only'
  tradingEnabled: boolean
  summary: { exportRoot: string; tradeLedgerRoot: string; decisionRoot: string; instrumentsWithData: number; completedBaselines: number; completedWalkForwards: number; readyDemoBridges: number; learningInstruments: number; shadowDecisions: number; validatedInstruments: number; hfmReady: boolean; experimentRuns: number }
  stages: Array<{ key: string; label: string; state: 'complete' | 'waiting' | 'next' | 'blocked'; detail: string }>
  instruments: ResearchInstrument[]
  experiments: Array<{
    id: string
    created_at: string
    broker: string
    symbol: string
    data: { first_eligible_day: string; last_day: string; daily_bars: number; effective_train_start: string }
    method: { training_months: number; test_months: number; drawdown_review_alert: number }
    scenarios: Array<{
      id: string
      lookback_set: string
      lookbacks: number[]
      one_way_cost_bps: number
      unseen_windows: number
      out_of_sample: { total_return: number | null; sharpe: number | null; max_drawdown: number | null; win_rate: number | null }
      review_flags: string[]
    }>
    warning: string
  }>
  news: Array<{ time: string; title: string; source: string | null; link: string | null }>
  disclaimer: string
}

export const researchApi = {
  get: () => fetchJson<ResearchDashboard>('/api/research'),
}
