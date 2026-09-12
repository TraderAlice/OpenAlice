import { http, HttpResponse } from 'msw'
import type { MonitorAlert, MonitorAsset, MonitorSettings } from '../../api/market-monitor'
import { demoMonitorSnapshot } from '../fixtures/market-monitor'

let settings: MonitorSettings = { enabledAssets: ['BTC', 'TSLA'], intervalMinutes: 15, notifications: false, alertConfidence: 68, abnormalVolumeRatio: 1.8, abnormalMovePercent: 1.5 }
const snapshots: Record<MonitorAsset, ReturnType<typeof demoMonitorSnapshot>[]> = { BTC: [demoMonitorSnapshot('BTC')], TSLA: [demoMonitorSnapshot('TSLA')] }
const alerts: MonitorAlert[] = []

export const marketMonitorHandlers = [
  http.get('/api/market-monitor/settings', () => HttpResponse.json(settings)),
  http.put('/api/market-monitor/settings', async ({ request }) => {
    settings = await request.json() as MonitorSettings
    return HttpResponse.json(settings)
  }),
  http.post('/api/market-monitor/scan', async ({ request }) => {
    const body = await request.json() as { asset: MonitorAsset; trigger: 'manual' | 'scheduled' }
    const previous = snapshots[body.asset].at(-1)!
    return HttpResponse.json({ snapshot: previous, stored: false, alert: null, receipt: { id: `demo-receipt-${Date.now()}`, asset: body.asset, requestedAt: new Date().toISOString(), trigger: body.trigger, outcome: 'duplicate', snapshotId: previous.id } })
  }),
  http.get('/api/market-monitor/snapshots', ({ request }) => {
    const asset = new URL(request.url).searchParams.get('asset') as MonitorAsset | null
    const rows = asset ? snapshots[asset] : [...snapshots.BTC, ...snapshots.TSLA]
    return HttpResponse.json({ snapshots: rows, count: rows.length })
  }),
  http.get('/api/market-monitor/alerts', () => HttpResponse.json({ alerts, count: alerts.length })),
  http.get('/api/market-monitor/receipts', () => HttpResponse.json({ receipts: [], count: 0 })),
  http.get('/api/market-monitor/evaluation', ({ request }) => {
    const asset = (new URL(request.url).searchParams.get('asset') ?? 'BTC') as MonitorAsset
    return HttpResponse.json({ asset, samples: 1, resolved: 0, directionalAccuracy: null, averageForwardChangePercent: null, rows: [{ capturedAt: snapshots[asset][0].capturedAt, hypothesis: snapshots[asset][0].hypothesis.bias, confidence: snapshots[asset][0].hypothesis.confidence, nextCapturedAt: null, forwardChangePercent: null, correct: null }] })
  }),
]
