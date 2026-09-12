import { describe, expect, it, vi } from 'vitest'
import type { EngineContext } from '../../core/types.js'
import type { MarketMonitorService } from '../../domain/market-monitor/service.js'
import { DEFAULT_MARKET_MONITOR_SETTINGS } from '../../domain/market-monitor/types.js'
import { createMarketMonitorRoutes } from './market-monitor.js'

function service(): MarketMonitorService {
  return {
    settings: vi.fn(async () => DEFAULT_MARKET_MONITOR_SETTINGS),
    saveSettings: vi.fn(async () => undefined),
    scan: vi.fn(async () => ({ snapshot: {} as never, stored: true, alert: null, receipt: {} as never })),
    snapshots: vi.fn(async () => []), alerts: vi.fn(async () => []), receipts: vi.fn(async () => []),
    evaluation: vi.fn(async (asset) => ({ asset, samples: 0, resolved: 0, directionalAccuracy: null, averageForwardChangePercent: null, rows: [] })),
  }
}

describe('market monitor routes', () => {
  it('validates scan identity and preserves trigger provenance', async () => {
    const fake = service()
    const app = createMarketMonitorRoutes({} as EngineContext, fake)
    expect((await app.request('/scan', { method: 'POST', body: JSON.stringify({ asset: 'ETH' }), headers: { 'Content-Type': 'application/json' } })).status).toBe(400)
    expect((await app.request('/scan', { method: 'POST', body: JSON.stringify({ asset: 'BTC', trigger: 'scheduled' }), headers: { 'Content-Type': 'application/json' } })).status).toBe(200)
    expect(fake.scan).toHaveBeenCalledWith('BTC', 'scheduled')
  })

  it('rejects unsafe settings rather than coercing them', async () => {
    const fake = service()
    const app = createMarketMonitorRoutes({} as EngineContext, fake)
    const response = await app.request('/settings', { method: 'PUT', body: JSON.stringify({ ...DEFAULT_MARKET_MONITOR_SETTINGS, intervalMinutes: 0 }), headers: { 'Content-Type': 'application/json' } })
    expect(response.status).toBe(400)
    expect(fake.saveSettings).not.toHaveBeenCalled()
  })

  it('provides bounded histories and evaluation', async () => {
    const fake = service()
    const app = createMarketMonitorRoutes({} as EngineContext, fake)
    expect((await app.request('/snapshots?asset=TSLA&limit=99999')).status).toBe(200)
    expect(fake.snapshots).toHaveBeenCalledWith('TSLA', 1000)
    expect((await app.request('/evaluation?asset=BTC')).status).toBe(200)
  })
})
