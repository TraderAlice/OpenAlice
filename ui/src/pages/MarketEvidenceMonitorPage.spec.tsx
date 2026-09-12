// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { demoMonitorSnapshot } from '../demo/fixtures/market-monitor'
import { MarketEvidenceMonitorPage } from './MarketEvidenceMonitorPage'

const mocks = vi.hoisted(() => ({
  settings: vi.fn(), snapshots: vi.fn(), alerts: vi.fn(), evaluation: vi.fn(), scan: vi.fn(), saveSettings: vi.fn(),
}))
vi.mock('../api', () => ({ api: { marketMonitor: mocks } }))

beforeEach(() => {
  window.localStorage.clear()
  const settings = { enabledAssets: ['BTC', 'TSLA'], intervalMinutes: 15, notifications: false, alertConfidence: 68, abnormalVolumeRatio: 1.8, abnormalMovePercent: 1.5 }
  mocks.settings.mockResolvedValue(settings)
  mocks.snapshots.mockImplementation(async (asset: 'BTC' | 'TSLA') => ({ snapshots: [demoMonitorSnapshot(asset)], count: 1 }))
  mocks.alerts.mockResolvedValue({ alerts: [], count: 0 })
  mocks.evaluation.mockImplementation(async (asset: 'BTC' | 'TSLA') => ({ asset, samples: 1, resolved: 0, directionalAccuracy: null, averageForwardChangePercent: null, rows: [] }))
  mocks.scan.mockResolvedValue({ snapshot: demoMonitorSnapshot('BTC'), stored: false, alert: null, receipt: {} })
  mocks.saveSettings.mockImplementation(async (value) => value)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('shows attributed BTC evidence and switches to the independent hourly series', async () => {
  render(<MarketEvidenceMonitorPage />)
  expect((await screen.findAllByText('Demand has provisional control')).length).toBeGreaterThan(0)
  expect(screen.getAllByText('demo/yfinance').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: '1H' }))
  expect(screen.getByRole('button', { name: '1H' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('img', { name: /Price path ending/ })).toBeTruthy()
})

it('switches from BTC to TSLA without losing the other asset history', async () => {
  render(<MarketEvidenceMonitorPage />)
  await screen.findAllByText('Demand has provisional control')
  fireEvent.click(screen.getByRole('tab', { name: /TSLA/ }))
  expect((await screen.findAllByText('Evidence remains balanced')).length).toBeGreaterThan(0)
  expect(screen.getByText('Trailing P/E')).toBeTruthy()
  expect(mocks.snapshots).toHaveBeenCalledWith('BTC', 120)
  expect(mocks.snapshots).toHaveBeenCalledWith('TSLA', 120)
})

it('keeps the rendered snapshot when a background refresh fails', async () => {
  render(<MarketEvidenceMonitorPage />)
  await screen.findAllByText('Demand has provisional control')
  mocks.scan.mockRejectedValueOnce(new Error('offline'))
  fireEvent.click(screen.getByRole('button', { name: /Scan now/ }))
  await waitFor(() => expect(screen.getByText(/last successful view is retained/i)).toBeTruthy())
  expect(screen.getAllByText('Demand has provisional control').length).toBeGreaterThan(0)
})
