// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BrokerPackStatus } from '../api/types'

const apiMocks = vi.hoisted(() => ({
  installBrokerPack: vi.fn(),
  getBrokerPresets: vi.fn(),
  status: vi.fn(),
  equity: vi.fn(),
}))
const pageMocks = vi.hoisted(() => ({
  readable: false,
  openOrFocus: vi.fn(),
  setSidebar: vi.fn(),
}))

vi.mock('../api', () => ({
  api: { trading: apiMocks },
}))
vi.mock('../hooks/useTradingConfig', () => ({
  useTradingConfig: () => ({
    utas: [{
      id: 'main', label: 'Main', presetId: 'okx', enabled: true,
      guards: [], presetConfig: {}, readOnly: false, asVendor: true,
    }],
    loading: false,
    error: null,
    refresh: vi.fn(),
    createUTA: vi.fn(),
    saveUTA: vi.fn(),
    deleteUTA: vi.fn(),
    reconnectUTA: vi.fn(),
  }),
}))
vi.mock('../hooks/useAccountHealth', () => ({
  useAccountHealth: () => ({}),
}))
vi.mock('../hooks/useBrokerPackReadiness', () => ({
  useBrokerPackReadiness: () => ({
    data: { packs: [], accounts: [] },
    loading: false,
    error: null,
    installingEngine: null,
    install: vi.fn(),
    refresh: vi.fn(),
    forAccount: () => ({
      accountId: 'main', label: 'Main', presetId: 'okx', configuredEnabled: true,
      engine: 'ccxt', state: pageMocks.readable ? 'ready' : 'needs-install',
      operational: pageMocks.readable,
    }),
  }),
  deriveAccountInteractionPolicy: () => ({
    canRead: pageMocks.readable,
    canReconnect: pageMocks.readable,
    canTrade: false,
  }),
}))
vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: { openOrFocus: typeof pageMocks.openOrFocus; setSidebar: typeof pageMocks.setSidebar }) => unknown) => selector(pageMocks),
}))

import {
  ExternalOrderMonitoringRow,
  KeylessDataSourcesRow,
  MissingBrokerPacksNotice,
  TradingPage,
} from './TradingPage'

const missingCcxt: BrokerPackStatus = {
  engine: 'ccxt',
  installed: false,
  source: 'missing',
  requiredBy: ['Main OKX'],
}

beforeEach(() => {
  pageMocks.readable = false
  apiMocks.installBrokerPack.mockResolvedValue({
    engine: 'ccxt', installed: true, source: 'downloaded', version: '0.80.0-beta', requiredBy: [],
  })
  apiMocks.getBrokerPresets.mockResolvedValue({ presets: [] })
  apiMocks.status.mockResolvedValue({ available: true, state: 'ready', mode: 'pro' })
  apiMocks.equity.mockResolvedValue({
    totalEquity: '100', totalCash: '100', totalUnrealizedPnL: '0', totalRealizedPnL: '0',
    accounts: [{ id: 'main', label: 'Main', equity: '100', cash: '100' }],
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('MissingBrokerPacksNotice', () => {
  it('lists only required missing packs and preserves repair diagnostics', () => {
    render(<MissingBrokerPacksNotice
      packs={[
        { ...missingCcxt, source: 'broken', reason: 'API version mismatch' },
        { engine: 'alpaca', installed: false, source: 'missing', requiredBy: [] },
        { engine: 'ibkr', installed: true, source: 'downloaded', requiredBy: ['IBKR Main'] },
      ]}
      onInstall={vi.fn().mockResolvedValue(undefined)}
    />)

    expect(screen.getByText('Broker support needs attention')).toBeTruthy()
    expect(screen.getByText('Required by Main OKX')).toBeTruthy()
    expect(screen.getByText('API version mismatch')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Repair' })).toBeTruthy()
    expect(screen.queryByText('ALPACA')).toBeNull()
    expect(screen.queryByText('IBKR')).toBeNull()
  })

  it('offers an in-place update while a compatible previous Pack remains installed', () => {
    render(<MissingBrokerPacksNotice
      packs={[{
        ...missingCcxt,
        installed: true,
        source: 'downloaded',
        version: '0.84.0-beta',
        updateAvailable: true,
      }]}
      onInstall={vi.fn().mockResolvedValue(undefined)}
    />)

    expect(screen.getByText('Installed support is from OpenAlice 0.84.0-beta')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Update' })).toBeTruthy()
  })

  it('installs from the notice and reports a failed repair in place', async () => {
    const onInstall = vi.fn(async (engine: string) => { await apiMocks.installBrokerPack(engine) })
    const { rerender } = render(
      <MissingBrokerPacksNotice packs={[missingCcxt]} onInstall={onInstall} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    await waitFor(() => expect(onInstall).toHaveBeenCalledWith('ccxt'))

    apiMocks.installBrokerPack.mockRejectedValueOnce(new Error('download failed'))
    rerender(<MissingBrokerPacksNotice packs={[missingCcxt]} onInstall={onInstall} />)
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    await waitFor(() => expect(screen.getByText('download failed')).toBeTruthy())
  })
})

describe('KeylessDataSourcesRow', () => {
  it('allows disabling an already-selected source while blocking new sources until CCXT is installed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      trading: { observeExternalOrdersEvery: '15m', keylessDataSources: ['binance'] },
    }), { status: 200, headers: { 'content-type': 'application/json' } })))

    render(<KeylessDataSourcesRow ccxtPack={missingCcxt} onInstall={vi.fn().mockResolvedValue(undefined)} />)

    const binance = await screen.findByRole('switch', { name: 'Binance public data source' })
    const okx = screen.getByRole('switch', { name: 'OKX public data source' })
    expect(binance.getAttribute('aria-checked')).toBe('true')
    expect(binance.hasAttribute('disabled')).toBe(false)
    expect(okx.getAttribute('aria-checked')).toBe('false')
    expect(okx.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Install data support' })).toBeTruthy()
  })

  it('installs CCXT data support without requiring broker credentials', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      trading: { observeExternalOrdersEvery: '15m', keylessDataSources: [] },
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const onInstall = vi.fn(async () => { await apiMocks.installBrokerPack('ccxt') })
    render(<KeylessDataSourcesRow ccxtPack={missingCcxt} onInstall={onInstall} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Install data support' }))

    await waitFor(() => expect(apiMocks.installBrokerPack).toHaveBeenCalledWith('ccxt'))
    expect(onInstall).toHaveBeenCalledOnce()
    expect(screen.getByText('Installed — choose the feeds you want')).toBeTruthy()
  })
})

describe('TradingPage broker polling', () => {
  it('starts and stops status and equity polling with readable account readiness', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      trading: { observeExternalOrdersEvery: '15m', keylessDataSources: [] },
    }), { status: 200, headers: { 'content-type': 'application/json' } })))

    try {
      const { rerender } = render(<TradingPage />)
      await act(async () => { await Promise.resolve() })

      expect(apiMocks.status).not.toHaveBeenCalled()
      expect(apiMocks.equity).not.toHaveBeenCalled()

      pageMocks.readable = true
      rerender(<TradingPage />)
      await act(async () => { await Promise.resolve() })

      expect(apiMocks.status).toHaveBeenCalledOnce()
      expect(apiMocks.equity).toHaveBeenCalledOnce()

      pageMocks.readable = false
      rerender(<TradingPage />)
      const statusCalls = apiMocks.status.mock.calls.length
      const equityCalls = apiMocks.equity.mock.calls.length
      await act(async () => { vi.advanceTimersByTime(60_000) })

      expect(apiMocks.status).toHaveBeenCalledTimes(statusCalls)
      expect(apiMocks.equity).toHaveBeenCalledTimes(equityCalls)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ExternalOrderMonitoringRow', () => {
  it('names and describes the cadence picker, then announces a saved change', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Response(null, { status: 204 })
      return new Response(JSON.stringify({
        trading: { observeExternalOrdersEvery: '15m', keylessDataSources: [] },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ExternalOrderMonitoringRow />)

    const select = await screen.findByRole('combobox', { name: 'External order monitoring' })
    const describedBy = select.getAttribute('aria-describedby')?.split(' ') ?? []

    expect(select.id).not.toBe('')
    expect(document.querySelector(`label[for="${select.id}"]`)?.textContent).toContain(
      'External order monitoring',
    )
    expect(describedBy.some((id) =>
      document.getElementById(id)?.textContent?.includes('orders placed outside Alice'),
    )).toBe(true)

    fireEvent.change(select, { target: { value: '5m' } })

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(
      'Saved — restarting UTA to apply',
    ))
    expect(fetchMock).toHaveBeenCalledWith('/api/config/trading', expect.objectContaining({
      method: 'PUT',
    }))
  })
})
