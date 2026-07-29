import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BrokerPackStatus } from '../api/types'

const { installBrokerPack } = vi.hoisted(() => ({ installBrokerPack: vi.fn() }))

vi.mock('../api', () => ({
  api: { trading: { installBrokerPack } },
}))

import {
  ExternalOrderMonitoringRow,
  KeylessDataSourcesRow,
  MissingBrokerPacksNotice,
} from './TradingPage'

const missingCcxt: BrokerPackStatus = {
  engine: 'ccxt',
  installed: false,
  source: 'missing',
  requiredBy: ['Main OKX'],
}

beforeEach(() => {
  installBrokerPack.mockResolvedValue({
    engine: 'ccxt', installed: true, source: 'downloaded', version: '0.80.0-beta', requiredBy: [],
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
      onInstalled={vi.fn()}
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
      onInstalled={vi.fn()}
    />)

    expect(screen.getByText('Installed support is from OpenAlice 0.84.0-beta')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Update' })).toBeTruthy()
  })

  it('installs from the notice and reports a failed repair in place', async () => {
    const onInstalled = vi.fn()
    const { rerender } = render(
      <MissingBrokerPacksNotice packs={[missingCcxt]} onInstalled={onInstalled} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    await waitFor(() => expect(onInstalled).toHaveBeenCalledWith(expect.objectContaining({ installed: true })))

    installBrokerPack.mockRejectedValueOnce(new Error('download failed'))
    rerender(<MissingBrokerPacksNotice packs={[missingCcxt]} onInstalled={onInstalled} />)
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    await waitFor(() => expect(screen.getByText('download failed')).toBeTruthy())
  })
})

describe('KeylessDataSourcesRow', () => {
  it('allows disabling an already-selected source while blocking new sources until CCXT is installed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      trading: { observeExternalOrdersEvery: '15m', keylessDataSources: ['binance'] },
    }), { status: 200, headers: { 'content-type': 'application/json' } })))

    render(<KeylessDataSourcesRow ccxtPack={missingCcxt} onPackInstalled={vi.fn()} />)

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
    const onPackInstalled = vi.fn()
    render(<KeylessDataSourcesRow ccxtPack={missingCcxt} onPackInstalled={onPackInstalled} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Install data support' }))

    await waitFor(() => expect(installBrokerPack).toHaveBeenCalledWith('ccxt'))
    expect(onPackInstalled).toHaveBeenCalledWith(expect.objectContaining({ engine: 'ccxt', installed: true }))
    expect(screen.getByText('Installed — choose the feeds you want')).toBeTruthy()
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
