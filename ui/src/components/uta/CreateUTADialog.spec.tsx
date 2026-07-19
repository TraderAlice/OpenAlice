import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BrokerPreset } from '../../api/types'

const { getBrokerPacks, installBrokerPack } = vi.hoisted(() => ({
  getBrokerPacks: vi.fn(),
  installBrokerPack: vi.fn(),
}))

vi.mock('../../api', () => ({
  api: {
    trading: {
      getBrokerPacks,
      installBrokerPack,
      testConnection: vi.fn(),
    },
  },
}))

import { CreateUTADialog } from './CreateUTADialog'

const brokerPreset: BrokerPreset = {
  id: 'okx',
  label: 'OKX',
  description: 'OKX Unified Trading Account.',
  category: 'recommended',
  defaultName: 'OKX',
  badge: 'OK',
  badgeColor: 'text-muted-foreground',
  engine: 'ccxt',
  guardCategory: 'crypto',
  subtitleFields: [],
  schema: {
    type: 'object',
    properties: {
      apiKey: { type: 'string', title: 'API key', writeOnly: true },
    },
    required: ['apiKey'],
  },
}

function setup(props: Partial<Parameters<typeof CreateUTADialog>[0]> = {}) {
  const onClose = vi.fn()
  const onSave = vi.fn()
  const onOpenExisting = vi.fn()
  render(
    <CreateUTADialog
      presets={[brokerPreset]}
      onClose={onClose}
      onSave={onSave}
      onOpenExisting={onOpenExisting}
      {...props}
    />,
  )
  return { onClose, onSave, onOpenExisting }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  getBrokerPacks.mockResolvedValue({
    packs: [{ engine: 'ccxt', installed: true, source: 'workspace', requiredBy: [] }],
  })
  installBrokerPack.mockResolvedValue({
    engine: 'ccxt', installed: true, source: 'downloaded', version: '1.0.0', requiredBy: [],
  })
})

describe('CreateUTADialog', () => {
  it('uses broker-facing setup labels instead of internal UTA labels', () => {
    setup()

    expect(screen.getByText('Connect Broker · Pick Platform')).toBeTruthy()
    expect(screen.getByLabelText('Close broker setup')).toBeTruthy()
  })

  it('can default a readonly onboarding account to read-only', async () => {
    setup({ initialReadOnly: true })

    await waitFor(() => expect(getBrokerPacks).toHaveBeenCalled())

    fireEvent.click(screen.getByText('OKX'))

    const switches = screen.getAllByRole('switch')
    expect(switches[0]?.getAttribute('aria-checked')).toBe('true')
    expect(switches[1]?.getAttribute('aria-checked')).toBe('true')
  })

  it('installs a missing broker pack before asking for credentials', async () => {
    getBrokerPacks.mockResolvedValueOnce({
      packs: [{ engine: 'ccxt', installed: false, source: 'missing', requiredBy: [] }],
    })
    const onPackInstalled = vi.fn()
    setup({ onPackInstalled })

    await waitFor(() => expect(getBrokerPacks).toHaveBeenCalled())
    fireEvent.click(screen.getByText('OKX'))

    expect(screen.getByRole('button', { name: 'Install OKX support' })).toBeTruthy()
    expect(screen.queryByText('API key')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Install OKX support' }))

    await waitFor(() => expect(installBrokerPack).toHaveBeenCalledWith('ccxt'))
    await waitFor(() => expect(screen.getByText('API key')).toBeTruthy())
    expect(onPackInstalled).toHaveBeenCalledWith(expect.objectContaining({ engine: 'ccxt', installed: true }))
  })

  it('skips the install step when support is already available', async () => {
    setup()

    await waitFor(() => expect(getBrokerPacks).toHaveBeenCalled())
    fireEvent.click(screen.getByText('OKX'))

    expect(screen.getByText('API key')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Install OKX support/i })).toBeNull()
    expect(installBrokerPack).not.toHaveBeenCalled()
  })

  it('keeps a broken pack on the repair step and shows the load and repair errors', async () => {
    getBrokerPacks.mockResolvedValueOnce({
      packs: [{
        engine: 'ccxt', installed: false, source: 'broken',
        reason: 'Installed broker pack targets another OpenAlice version', requiredBy: [],
      }],
    })
    installBrokerPack.mockRejectedValueOnce(new Error('checksum mismatch'))
    setup()

    await waitFor(() => expect(getBrokerPacks).toHaveBeenCalled())
    fireEvent.click(screen.getByText('OKX'))

    expect(screen.getByText(/targets another OpenAlice version/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Repair support' }))
    await waitFor(() => expect(screen.getByText('checksum mismatch')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Repair support' })).toBeTruthy()
    expect(screen.queryByText('API key')).toBeNull()
  })

  it('still offers contextual installation when the initial status request fails', async () => {
    getBrokerPacks.mockRejectedValueOnce(new Error('status endpoint unavailable'))
    setup()

    await waitFor(() => expect(getBrokerPacks).toHaveBeenCalled())
    fireEvent.click(screen.getByText('OKX'))

    expect(screen.getByText('status endpoint unavailable')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Install OKX support' })).toBeTruthy()
    expect(screen.queryByText('API key')).toBeNull()
  })

  it('surfaces an onboarding escape action from every wizard step', () => {
    const onEscape = vi.fn()
    setup({ escapeAction: { label: 'Continue without UTA', onClick: onEscape } })

    fireEvent.click(screen.getByRole('button', { name: 'Continue without UTA' }))

    expect(onEscape).toHaveBeenCalled()
  })
})
