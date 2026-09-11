// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UTAConfig } from '../api/types'
import { UTADetailPage } from './UTADetailPage'

const mocks = vi.hoisted(() => ({
  utaAccount: vi.fn(), utaPositions: vi.fn(), utaOrders: vi.fn(),
  utaSubAccounts: vi.fn(), marketClock: vi.fn(), snapshots: vi.fn(),
  getBrokerPacks: vi.fn(),
  reconnectUTA: vi.fn(), placeOrder: vi.fn(), closePosition: vi.fn(), cancelOrder: vi.fn(),
  saveUTA: vi.fn(), deleteUTA: vi.fn(),
}))
const pageState = vi.hoisted(() => {
  const uta = {
    id: 'remote-okx', label: 'Remote OKX', presetId: 'okx', enabled: true,
    guards: [], presetConfig: {}, readOnly: false, asVendor: true,
  }
  return {
    uta,
    utas: [uta],
    mode: 'pro' as 'lite' | 'readonly' | 'pro',
    health: {
      status: 'healthy' as 'healthy' | 'degraded' | 'offline',
      reach: 'readable' as 'down' | 'connected' | 'readable',
      tier: 'trading' as 'data' | 'account' | 'trading',
      consecutiveFailures: 0, recovering: false, connecting: false, disabled: false,
      lastError: undefined as string | undefined,
    },
  }
})

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      trading: {
        ...actual.api.trading,
        getBrokerPresets: vi.fn(async () => ({ presets: [] })),
        getBrokerPacks: mocks.getBrokerPacks,
        installBrokerPack: vi.fn(),
        snapshots: mocks.snapshots,
        utaAccount: mocks.utaAccount,
        utaPositions: mocks.utaPositions,
        utaOrders: mocks.utaOrders,
        utaSubAccounts: mocks.utaSubAccounts,
        marketClock: mocks.marketClock,
        reconnectUTA: mocks.reconnectUTA,
        placeOrder: mocks.placeOrder,
        closePosition: mocks.closePosition,
        cancelOrder: mocks.cancelOrder,
      },
    },
  }
})

const uta = pageState.uta as UTAConfig

vi.mock('../hooks/useTradingConfig', () => ({
  useTradingConfig: () => ({
    utas: pageState.utas, loading: false, error: null,
    saveUTA: mocks.saveUTA, deleteUTA: mocks.deleteUTA, refresh: vi.fn(),
  }),
}))

vi.mock('../hooks/useAccountHealth', () => ({
  useAccountHealth: () => ({
    [uta.id]: pageState.health,
  }),
}))

vi.mock('../live/trading-mode', () => ({
  ensureTradingModePolling: vi.fn(),
  useTradingMode: (selector: (state: { status: { mode: 'lite' | 'readonly' | 'pro' }; loading: boolean }) => unknown) => selector({ status: { mode: pageState.mode }, loading: false }),
}))

beforeEach(() => {
  pageState.uta.readOnly = false
  pageState.uta.enabled = true
  pageState.mode = 'pro'
  Object.assign(pageState.health, {
    status: 'healthy', reach: 'readable', tier: 'trading', consecutiveFailures: 0,
    recovering: false, connecting: false, disabled: false, lastError: undefined,
  })
  mocks.snapshots.mockResolvedValue({ snapshots: [] })
  mocks.utaSubAccounts.mockResolvedValue({ subAccounts: [] })
  mocks.marketClock.mockResolvedValue({ isOpen: true })
  mocks.utaAccount.mockRejectedValue(new Error('account unavailable in test'))
  mocks.utaPositions.mockResolvedValue({ positions: [] })
  mocks.utaOrders.mockResolvedValue({ orders: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('UTA Detail broker support gating', () => {
  it('does not poll live account APIs or open a deep-linked order when the Pack is missing', async () => {
    mocks.getBrokerPacks.mockResolvedValue({
      packs: [{ engine: 'ccxt', installed: false, source: 'missing', requiredBy: ['Remote OKX'] }],
      accounts: [{
        accountId: uta.id, label: uta.label, presetId: uta.presetId, configuredEnabled: true,
        engine: 'ccxt', state: 'needs-install', operational: false, action: 'install',
      }],
    })
    render(
      <MemoryRouter initialEntries={['/?aliceId=okx%7CBTC-USDT']}>
        <UTADetailPage spec={{ kind: 'uta-detail', params: { id: uta.id } }} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Broker support is not installed')).toBeTruthy()
    await waitFor(() => expect(mocks.getBrokerPacks).toHaveBeenCalledOnce())
    expect(mocks.utaAccount).not.toHaveBeenCalled()
    expect(mocks.utaPositions).not.toHaveBeenCalled()
    expect(mocks.utaOrders).not.toHaveBeenCalled()
    expect(mocks.utaSubAccounts).not.toHaveBeenCalled()
    expect(mocks.marketClock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Reconnect' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '+ Place Order' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByLabelText('Live')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it.each([
    ['read-only account', () => { pageState.uta.readOnly = true }],
    ['non-pro mode', () => { pageState.mode = 'readonly' }],
    ['unhealthy broker', () => { Object.assign(pageState.health, { status: 'offline', reach: 'down', lastError: 'Broker offline' }) }],
  ])('does not open or call an order write for a deep link on a %s', async (_label, configure) => {
    configure()
    mocks.getBrokerPacks.mockResolvedValue({
      packs: [{ engine: 'ccxt', installed: true, source: 'downloaded', requiredBy: ['Remote OKX'] }],
      accounts: [{
        accountId: uta.id, label: uta.label, presetId: uta.presetId, configuredEnabled: true,
        engine: 'ccxt', state: 'ready', operational: true,
      }],
    })

    render(
      <MemoryRouter initialEntries={['/?aliceId=okx%7CBTC-USDT']}>
        <UTADetailPage spec={{ kind: 'uta-detail', params: { id: uta.id } }} />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.getBrokerPacks).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getByRole('button', { name: '+ Place Order' }).hasAttribute('disabled')).toBe(true))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.placeOrder).not.toHaveBeenCalled()
    expect(mocks.closePosition).not.toHaveBeenCalled()
    expect(mocks.cancelOrder).not.toHaveBeenCalled()
    expect(mocks.reconnectUTA).not.toHaveBeenCalled()
  })

  it('blocks enabling a configured-off account until its Pack is available', async () => {
    pageState.uta.enabled = false
    mocks.getBrokerPacks.mockResolvedValue({
      packs: [{ engine: 'ccxt', installed: false, source: 'missing', requiredBy: [] }],
      accounts: [{
        accountId: uta.id, label: uta.label, presetId: uta.presetId, configuredEnabled: false,
        engine: 'ccxt', state: 'needs-install', operational: false, action: 'install',
      }],
    })

    render(
      <MemoryRouter>
        <UTADetailPage spec={{ kind: 'uta-detail', params: { id: uta.id } }} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Broker support is not installed')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'remote-okx enabled' }).hasAttribute('disabled')).toBe(true)
    expect(mocks.saveUTA).not.toHaveBeenCalled()
  })
})
