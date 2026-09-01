// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountReadinessBadge, BrokerSupportGate } from './BrokerPackGate'

afterEach(cleanup)

const missing = {
  accountId: 'main', label: 'Main', presetId: 'okx', configuredEnabled: true,
  engine: 'ccxt' as const, state: 'needs-install' as const, operational: false,
  action: 'install' as const,
}

describe('Broker Pack account gates', () => {
  it('separates configured state from machine-local support and only installs on click', () => {
    const onInstall = vi.fn().mockResolvedValue(undefined)
    render(<BrokerSupportGate readiness={missing} onInstall={onInstall} onRetry={vi.fn()} />)

    expect(screen.getByText(/account is still configured/i)).toBeTruthy()
    expect(onInstall).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(onInstall).toHaveBeenCalledWith('ccxt')
  })

  it('offers Retry when the Runtime cannot report support status', () => {
    const onRetry = vi.fn().mockResolvedValue(undefined)
    render(<BrokerSupportGate readiness={{ ...missing, engine: undefined, state: 'status-unavailable', reason: 'Runtime offline' }} onRetry={onRetry} />)

    expect(screen.getByText('Runtime offline')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('reports an install failure instead of leaking a rejected promise', async () => {
    render(<BrokerSupportGate
      readiness={missing}
      onInstall={vi.fn().mockRejectedValue(new Error('download failed'))}
      onRetry={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect((await screen.findByRole('alert')).textContent).toContain('download failed')
  })

  it('never labels a configured-but-missing account Connected', () => {
    render(<AccountReadinessBadge readiness={missing} health={{
      status: 'healthy', reach: 'readable', tier: 'trading', consecutiveFailures: 0,
      recovering: false, connecting: false, disabled: false,
    }} />)

    expect(screen.getByText('Support not installed')).toBeTruthy()
    expect(screen.queryByText('Connected')).toBeNull()
  })
})
