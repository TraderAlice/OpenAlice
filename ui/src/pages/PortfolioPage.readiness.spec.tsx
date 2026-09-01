// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UTAConfig } from '../api/types'
import { PortfolioPage } from './PortfolioPage'

const mocks = vi.hoisted(() => ({
  equity: vi.fn(), fxRates: vi.fn(), equityCurve: vi.fn(), utaAccount: vi.fn(),
  utaPositions: vi.fn(), walletLog: vi.fn(), snapshots: vi.fn(),
}))

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      config: { ...actual.api.config, load: vi.fn(async () => ({ snapshot: { enabled: true, every: '15m' } })) },
      trading: {
        ...actual.api.trading,
        equity: mocks.equity, fxRates: mocks.fxRates, equityCurve: mocks.equityCurve,
        utaAccount: mocks.utaAccount, utaPositions: mocks.utaPositions,
        walletLog: mocks.walletLog, snapshots: mocks.snapshots,
      },
    },
  }
})

const uta: UTAConfig = {
  id: 'remote-okx', label: 'Remote OKX', presetId: 'okx', enabled: true,
  guards: [], presetConfig: {}, readOnly: false, asVendor: true,
}
const readiness = {
  accountId: uta.id, label: uta.label!, presetId: uta.presetId, configuredEnabled: true,
  engine: 'ccxt' as const, state: 'needs-install' as const, operational: false, action: 'install' as const,
}
const configuredUtas = [uta]
const brokerRefresh = vi.fn().mockResolvedValue(undefined)
const brokerInstall = vi.fn().mockResolvedValue(undefined)
const brokerForAccount = vi.fn(() => readiness)

vi.mock('../hooks/useTradingConfig', () => ({
  useTradingConfig: () => ({ utas: configuredUtas, loading: false, error: null }),
}))

vi.mock('../hooks/useBrokerPackReadiness', () => ({
  useBrokerPackReadiness: () => ({
    data: { packs: [], accounts: [readiness] }, loading: false, error: null, installingEngine: null,
    forAccount: brokerForAccount,
    refresh: brokerRefresh, install: brokerInstall,
  }),
}))

vi.mock('../hooks/useAccountHealth', () => ({ useAccountHealth: () => ({}) }))
vi.mock('../live/trading-mode', () => ({
  ensureTradingModePolling: vi.fn(),
  useTradingMode: (selector: (state: { status: { mode: 'pro' }; loading: boolean }) => unknown) => selector({ status: { mode: 'pro' }, loading: false }),
}))
vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: { openOrFocus: () => void; setSidebar: () => void }) => unknown) => selector({ openOrFocus: vi.fn(), setSidebar: vi.fn() }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Portfolio broker support gating', () => {
  it('keeps the configured account visible without polling its live endpoints', async () => {
    mocks.snapshots.mockResolvedValue({ snapshots: [] })

    render(<PortfolioPage />)

    expect(await screen.findByText('Remote OKX')).toBeTruthy()
    expect(screen.getByText('Support not installed')).toBeTruthy()
    await waitFor(() => expect(mocks.snapshots).toHaveBeenCalledWith(uta.id, { limit: 200 }))
    expect(mocks.equity).not.toHaveBeenCalled()
    expect(mocks.fxRates).not.toHaveBeenCalled()
    expect(mocks.utaAccount).not.toHaveBeenCalled()
    expect(mocks.utaPositions).not.toHaveBeenCalled()
    expect(mocks.walletLog).not.toHaveBeenCalled()
    expect(screen.queryByText('No trading accounts connected.')).toBeNull()
    expect(screen.queryByLabelText('Live')).toBeNull()
  })
})
