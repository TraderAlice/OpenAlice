import type { BarMeta, OhlcvBar } from '../market-data/bars/index.js'

export const MARKET_MONITOR_ASSETS = ['BTC', 'TSLA'] as const
export type MarketMonitorAsset = typeof MARKET_MONITOR_ASSETS[number]
export type MarketMonitorTrigger = 'manual' | 'scheduled'
export type EvidenceTone = 'positive' | 'negative' | 'neutral'

export interface MarketMonitorAssetConfig {
  asset: MarketMonitorAsset
  label: string
  symbol: string
  assetClass: 'crypto' | 'equity'
  barId: string
}

export const MARKET_MONITOR_ASSET_CONFIG: Record<MarketMonitorAsset, MarketMonitorAssetConfig> = {
  BTC: { asset: 'BTC', label: 'Bitcoin', symbol: 'BTC-USD', assetClass: 'crypto', barId: 'yfinance|BTC-USD' },
  TSLA: { asset: 'TSLA', label: 'Tesla', symbol: 'TSLA', assetClass: 'equity', barId: 'yfinance|TSLA' },
}

export interface MarketMonitorSettings {
  enabledAssets: MarketMonitorAsset[]
  intervalMinutes: number
  notifications: boolean
  alertConfidence: number
  abnormalVolumeRatio: number
  abnormalMovePercent: number
}

export const DEFAULT_MARKET_MONITOR_SETTINGS: MarketMonitorSettings = {
  enabledAssets: ['BTC', 'TSLA'],
  intervalMinutes: 15,
  notifications: false,
  alertConfidence: 68,
  abnormalVolumeRatio: 1.8,
  abnormalMovePercent: 1.5,
}

export interface SourceHealth {
  id: string
  label: string
  status: 'ok' | 'degraded' | 'unavailable'
  provider: string
  asOf: string | null
  detail: string
}

export interface EvidenceItem {
  id: string
  label: string
  timeframe: '1D' | '1W' | '1H'
  tone: EvidenceTone
  observation: string
  interpretation: string
  weight: number
}

export interface MarketHypothesis {
  id: 'demand-control' | 'supply-control' | 'balanced-range'
  label: string
  bias: 'bullish' | 'bearish' | 'neutral'
  confidence: number
  summary: string
  confirm: string[]
  invalidate: string[]
  alternatives: string[]
}

export interface IntradayPulse {
  available: boolean
  latestAt: string | null
  latestChangePercent: number | null
  fourHourChangePercent: number | null
  volumeRatio: number | null
  abnormal: boolean
  note: string
}

export interface MarketMonitorMetrics {
  lastPrice: number
  lastBarAt: string
  change1dPercent: number | null
  change5dPercent: number | null
  rangePosition60d: number | null
  volumeRatio20d: number | null
  weeklyChangePercent: number | null
  intraday: IntradayPulse
}

export interface MarketContext {
  fundingRate?: number | null
  openInterest?: number | null
  annualizedBasisPercent?: number | null
  optionOpenInterest?: number | null
  putCallOpenInterestRatio?: number | null
  marketCap?: number | null
  trailingPe?: number | null
  forwardPe?: number | null
  analystTargetMean?: number | null
  shortPercentFloat?: number | null
  nextEarningsAt?: string | null
  recentNews?: Array<{ title: string; time: string; source: string | null }>
}

export interface MarketMonitorSnapshot {
  id: string
  asset: MarketMonitorAsset
  capturedAt: string
  trigger: MarketMonitorTrigger
  strategyId: 'evidence-chain-v1'
  fingerprint: string
  metrics: MarketMonitorMetrics
  hypothesis: MarketHypothesis
  evidence: EvidenceItem[]
  context: MarketContext
  sourceHealth: SourceHealth[]
  chart: {
    daily: OhlcvBar[]
    intraday: OhlcvBar[]
    dailyMeta: BarMeta
    intradayMeta: BarMeta | null
  }
}

export interface MarketMonitorAlert {
  id: string
  asset: MarketMonitorAsset
  createdAt: string
  snapshotId: string
  severity: 'info' | 'warning'
  title: string
  message: string
  fingerprint: string
}

export interface MarketMonitorReceipt {
  id: string
  asset: MarketMonitorAsset
  requestedAt: string
  trigger: MarketMonitorTrigger
  outcome: 'stored' | 'duplicate' | 'failed'
  snapshotId?: string
  error?: string
}

export interface MarketMonitorScanResult {
  snapshot: MarketMonitorSnapshot
  stored: boolean
  alert: MarketMonitorAlert | null
  receipt: MarketMonitorReceipt
}

export interface MarketMonitorEvaluation {
  asset: MarketMonitorAsset
  samples: number
  resolved: number
  directionalAccuracy: number | null
  averageForwardChangePercent: number | null
  rows: Array<{
    capturedAt: string
    hypothesis: MarketHypothesis['bias']
    confidence: number
    nextCapturedAt: string | null
    forwardChangePercent: number | null
    correct: boolean | null
  }>
}
