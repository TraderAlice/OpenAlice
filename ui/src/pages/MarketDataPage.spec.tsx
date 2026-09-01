// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MarketDataPage } from './MarketDataPage'

const mocks = vi.hoisted(() => ({
  hubStatus: vi.fn(),
  testProvider: vi.fn(),
  updateConfig: vi.fn(),
  updateConfigImmediate: vi.fn(),
  retry: vi.fn(),
}))

vi.mock('../api', () => ({
  api: {
    marketData: {
      hubStatus: mocks.hubStatus,
      testProvider: mocks.testProvider,
    },
  },
}))

vi.mock('../hooks/useConfigPage', () => ({
  useConfigPage: () => ({
    config: {
      enabled: true,
      hub: { enabled: false, baseUrl: 'https://traderhub.openalice.ai' },
      tushare: { enabled: false, baseUrl: 'https://api.tushare.pro' },
      extraVendors: [],
      providerKeys: {
        fmp: 'test-fmp-key',
        fred: 'test-fred-key',
        bls: 'test-bls-key',
        eia: 'test-eia-key',
        econdb: 'test-econdb-key',
        intrinio: 'test-intrinio-key',
        tushare: 'test-tushare-token',
      },
    },
    status: 'idle',
    loadError: false,
    updateConfig: mocks.updateConfig,
    updateConfigImmediate: mocks.updateConfigImmediate,
    retry: mocks.retry,
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.testProvider.mockResolvedValue({ ok: true })
})

afterEach(cleanup)

function openProviderKeys() {
  render(<MarketDataPage />)
  fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))
}

describe('MarketDataPage provider credentials', () => {
  it('configures and probes the native Tushare provider without exposing the token', async () => {
    render(<MarketDataPage />)

    const token = screen.getByLabelText('Tushare Pro token') as HTMLInputElement
    expect(token.type).toBe('password')
    expect(token.value).toBe('test-tushare-token')
    expect((screen.getByLabelText('Tushare endpoint') as HTMLInputElement).value).toBe('https://api.tushare.pro')

    fireEvent.click(screen.getByRole('button', { name: 'Test Tushare Pro key' }))
    expect(await screen.findByRole('button', { name: 'Tushare Pro key test passed' })).toBeTruthy()
    expect(mocks.testProvider).toHaveBeenCalledWith(
      'tushare', 'test-tushare-token', 'https://api.tushare.pro',
    )

    fireEvent.click(screen.getByRole('switch', { name: 'Tushare Pro' }))
    expect(mocks.updateConfigImmediate).toHaveBeenCalledWith({
      tushare: { enabled: true, baseUrl: 'https://api.tushare.pro' },
    })
  })

  it('gives every key field and test action a provider-specific name', () => {
    openProviderKeys()

    for (const provider of ['FMP', 'FRED', 'BLS', 'EIA', 'EconDB', 'Intrinio']) {
      const input = screen.getByLabelText(`${provider} API key`)
      expect(screen.getByText(provider, { selector: 'label' }).getAttribute('for'))
        .toBe(input.getAttribute('id'))
      expect(input.getAttribute('aria-describedby')).toBe(
        `market-data-provider-${provider.toLowerCase()}-key-description ` +
        `market-data-provider-${provider.toLowerCase()}-key-hint ` +
        `market-data-provider-${provider.toLowerCase()}-key-test-status`,
      )
      expect(screen.getByRole('button', { name: `Test ${provider} key` })).toBeTruthy()
    }
  })

  it('associates provider test progress and success with the matching field', async () => {
    let finishTest: ((result: { ok: boolean }) => void) | undefined
    mocks.testProvider.mockReturnValueOnce(new Promise((resolve) => {
      finishTest = resolve
    }))
    openProviderKeys()

    fireEvent.click(screen.getByRole('button', { name: 'Test FMP key' }))

    expect(await screen.findByRole('button', { name: 'Testing FMP key' })).toBeTruthy()
    expect(screen.getByText('Testing FMP key').getAttribute('id'))
      .toBe('market-data-provider-fmp-key-test-status')

    finishTest?.({ ok: true })

    expect(await screen.findByRole('button', { name: 'FMP key test passed' })).toBeTruthy()
    expect(screen.getByText('FMP key test passed').getAttribute('id'))
      .toBe('market-data-provider-fmp-key-test-status')
  })

  it('announces a failed provider test without changing another provider action', async () => {
    mocks.testProvider.mockResolvedValueOnce({ ok: false })
    openProviderKeys()

    fireEvent.click(screen.getByRole('button', { name: 'Test BLS key' }))

    expect(await screen.findByRole('button', { name: 'BLS key test failed' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Test FRED key' })).toBeTruthy()
  })
})
