import { fetchJson, headers } from './client'
import type { BarMeta, HistoricalBar } from './market'

export type MonitorAsset = 'BTC' | 'TSLA'
export type MonitorTrigger = 'manual' | 'scheduled'

export interface MonitorSettings {
  enabledAssets: MonitorAsset[]
  intervalMinutes: number
  notifications: boolean
  alertConfidence: number
  abnormalVolumeRatio: number
  abnormalMovePercent: number
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
  tone: 'positive' | 'negative' | 'neutral'
  observation: string
  interpretation: string
  weight: number
}

export interface MonitorSnapshot {
  id: string
  asset: MonitorAsset
  capturedAt: string
  trigger: MonitorTrigger
  strategyId: 'evidence-chain-v1'
  fingerprint: string
  metrics: {
    lastPrice: number
    lastBarAt: string
    change1dPercent: number | null
    change5dPercent: number | null
    rangePosition60d: number | null
    volumeRatio20d: number | null
    weeklyChangePercent: number | null
    intraday: {
      available: boolean
      latestAt: string | null
      latestChangePercent: number | null
      fourHourChangePercent: number | null
      volumeRatio: number | null
      abnormal: boolean
      note: string
    }
  }
  hypothesis: {
    id: 'demand-control' | 'supply-control' | 'balanced-range'
    label: string
    bias: 'bullish' | 'bearish' | 'neutral'
    confidence: number
    summary: string
    confirm: string[]
    invalidate: string[]
    alternatives: string[]
  }
  evidence: EvidenceItem[]
  context: Record<string, unknown> & { recentNews?: Array<{ title: string; time: string; source: string | null }> }
  sourceHealth: SourceHealth[]
  chart: { daily: HistoricalBar[]; intraday: HistoricalBar[]; dailyMeta: BarMeta; intradayMeta: BarMeta | null }
}

export interface MonitorAlert {
  id: string
  asset: MonitorAsset
  createdAt: string
  snapshotId: string
  severity: 'info' | 'warning'
  title: string
  message: string
  fingerprint: string
}

export interface MonitorReceipt {
  id: string
  asset: MonitorAsset
  requestedAt: string
  trigger: MonitorTrigger
  outcome: 'stored' | 'duplicate' | 'failed'
  snapshotId?: string
  error?: string
}

export interface ScanResult {
  snapshot: MonitorSnapshot
  stored: boolean
  alert: MonitorAlert | null
  receipt: MonitorReceipt
}

export interface MonitorEvaluation {
  asset: MonitorAsset
  samples: number
  resolved: number
  directionalAccuracy: number | null
  averageForwardChangePercent: number | null
  rows: Array<{
    capturedAt: string
    hypothesis: 'bullish' | 'bearish' | 'neutral'
    confidence: number
    nextCapturedAt: string | null
    forwardChangePercent: number | null
    correct: boolean | null
  }>
}

function query(asset?: MonitorAsset, limit = 100): string {
  const params = new URLSearchParams({ limit: String(limit) })
  if (asset) params.set('asset', asset)
  return params.toString()
}

export const marketMonitorApi = {
  settings: () => fetchJson<MonitorSettings>('/api/market-monitor/settings'),
  saveSettings: (settings: MonitorSettings) => fetchJson<MonitorSettings>('/api/market-monitor/settings', { method: 'PUT', headers, body: JSON.stringify(settings) }),
  scan: (asset: MonitorAsset, trigger: MonitorTrigger = 'manual') => fetchJson<ScanResult>('/api/market-monitor/scan', { method: 'POST', headers, body: JSON.stringify({ asset, trigger }) }),
  snapshots: (asset?: MonitorAsset, limit = 100) => fetchJson<{ snapshots: MonitorSnapshot[]; count: number }>(`/api/market-monitor/snapshots?${query(asset, limit)}`),
  alerts: (asset?: MonitorAsset, limit = 100) => fetchJson<{ alerts: MonitorAlert[]; count: number }>(`/api/market-monitor/alerts?${query(asset, limit)}`),
  receipts: (asset?: MonitorAsset, limit = 100) => fetchJson<{ receipts: MonitorReceipt[]; count: number }>(`/api/market-monitor/receipts?${query(asset, limit)}`),
  evaluation: (asset: MonitorAsset) => fetchJson<MonitorEvaluation>(`/api/market-monitor/evaluation?asset=${asset}`),
}
