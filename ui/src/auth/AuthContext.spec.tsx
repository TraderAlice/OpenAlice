// @vitest-environment jsdom

import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import '../i18n'

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
}))

vi.mock('./api', () => ({
  getStatus: mocks.getStatus,
}))

import {
  AuthProvider,
  BACKEND_HEALTH_POLL_MS,
  useAuth,
  useBackendRecoverySignal,
} from './AuthContext'
import { AuthGate, BackendUnavailableScreen } from './AuthGate'
import { BACKEND_PROBE_REQUESTED_EVENT } from './backendConnectivity'
import { useHideBackendOutageOverlay } from './BackendOutageOverlayContext'

function WorkspaceHarness() {
  const { backendRecoveryGeneration, refresh } = useAuth()
  return (
    <>
      <div>workspace-app</div>
      <span data-testid="backend-recovery-generation">{backendRecoveryGeneration}</span>
      <button type="button" onClick={() => void refresh()}>Refresh auth</button>
    </>
  )
}

function OptionalBackendSignalHarness() {
  const { backendUnavailable, backendRecoveryGeneration } = useBackendRecoverySignal()
  return <span>{`${backendUnavailable}:${backendRecoveryGeneration}`}</span>
}

function PlannedRestartHarness() {
  const [updating, setUpdating] = useState(true)
  useHideBackendOutageOverlay(updating)
  return <><WorkspaceHarness /><button type="button" onClick={() => setUpdating(false)}>Finish update</button></>
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

afterEach(() => {
  cleanup()
  mocks.getStatus.mockReset()
  vi.useRealTimers()
})

describe('AuthProvider backend recovery', () => {
  it('lets reusable domain hooks default to no observed outage outside AuthProvider', () => {
    render(<OptionalBackendSignalHarness />)
    expect(screen.getByText('false:0')).toBeTruthy()
  })

  it('shows a recoverable backend outage without guessing Machine identity', () => {
    render(
      <BackendUnavailableScreen
        retry={vi.fn(async () => undefined)}
      />,
    )

    expect(screen.getByRole('alertdialog', {
      name: 'OpenAlice lost its backend connection',
    })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry now' })).toBeTruthy()
  })

  it('does not manufacture a login screen during a cold-start outage', async () => {
    vi.useFakeTimers()
    mocks.getStatus
      .mockRejectedValueOnce(new Error('backend restarting'))
      .mockResolvedValueOnce({ authed: true, tokenConfigured: true })

    render(
      <AuthProvider>
        <AuthGate><WorkspaceHarness /></AuthGate>
      </AuthProvider>,
    )
    await flushEffects()

    const recoveryDialog = screen.getByRole('alertdialog')
    expect(recoveryDialog).toBeTruthy()
    expect(recoveryDialog).toBe(document.activeElement)
    expect(screen.getByRole('button', { name: 'Retry now' })).toBeTruthy()
    expect(screen.queryByText('workspace-app')).toBeNull()
    expect(document.querySelector('input[type="password"]')).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })

    expect(screen.getByText('workspace-app')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('keeps an authenticated app mounted while Alice restarts, then recovers', async () => {
    vi.useFakeTimers()
    mocks.getStatus
      .mockResolvedValueOnce({ authed: true, tokenConfigured: true })
      .mockRejectedValueOnce(new Error('backend restarting'))
      .mockResolvedValueOnce({ authed: true, tokenConfigured: true })

    render(
      <AuthProvider>
        <AuthGate><WorkspaceHarness /></AuthGate>
      </AuthProvider>,
    )
    await flushEffects()
    expect(screen.getByText('workspace-app')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh auth' }))
    await flushEffects()

    expect(screen.getByText('workspace-app')).toBeTruthy()
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(screen.getByText('workspace-app').closest('[inert]')).toBeTruthy()
    expect(document.querySelector('input[type="password"]')).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })

    expect(screen.getByText('workspace-app')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByTestId('backend-recovery-generation').textContent).toBe('1')
  })

  it('keeps the active upgrade dialog visible during its planned backend restart', async () => {
    mocks.getStatus
      .mockResolvedValueOnce({ authed: true, tokenConfigured: true })
      .mockRejectedValueOnce(new Error('backend restarting'))

    render(
      <AuthProvider>
        <AuthGate><PlannedRestartHarness /></AuthGate>
      </AuthProvider>,
    )
    await flushEffects()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh auth' }))
    await flushEffects()

    expect(screen.getByText('workspace-app')).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByText('workspace-app').closest('[inert]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Finish update' }))
    await flushEffects()
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  })

  it('increments the recovery generation once per unavailable-to-available transition', async () => {
    vi.useFakeTimers()
    mocks.getStatus
      .mockResolvedValueOnce({ authed: true, tokenConfigured: true })
      .mockRejectedValueOnce(new Error('backend restarting'))
      .mockResolvedValueOnce({ authed: true, tokenConfigured: true })
      .mockResolvedValueOnce({ authed: true, tokenConfigured: true })

    render(
      <AuthProvider>
        <AuthGate><WorkspaceHarness /></AuthGate>
      </AuthProvider>,
    )
    await flushEffects()
    expect(screen.getByTestId('backend-recovery-generation').textContent).toBe('0')

    fireEvent.click(screen.getByRole('button', { name: 'Refresh auth' }))
    await flushEffects()
    expect(screen.getByTestId('backend-recovery-generation').textContent).toBe('0')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(screen.getByTestId('backend-recovery-generation').textContent).toBe('1')

    fireEvent.click(screen.getByRole('button', { name: 'Refresh auth' }))
    await flushEffects()
    expect(screen.getByTestId('backend-recovery-generation').textContent).toBe('1')
  })

  it('detects a quiet backend shutdown with the core heartbeat', async () => {
    vi.useFakeTimers()
    mocks.getStatus
      .mockResolvedValueOnce({ authed: true, tokenConfigured: true })
      .mockRejectedValueOnce(new Error('backend stopped'))
      .mockResolvedValueOnce({ authed: true, tokenConfigured: true })

    render(
      <AuthProvider>
        <AuthGate><WorkspaceHarness /></AuthGate>
      </AuthProvider>,
    )
    await flushEffects()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BACKEND_HEALTH_POLL_MS)
    })

    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(mocks.getStatus).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByText('workspace-app')).toBeTruthy()
  })

  it('debounces simultaneous page failures into one independent core probe', async () => {
    vi.useFakeTimers()
    mocks.getStatus
      .mockResolvedValueOnce({ authed: true, tokenConfigured: true })
      .mockRejectedValueOnce(new Error('backend stopped'))

    render(
      <AuthProvider>
        <AuthGate><WorkspaceHarness /></AuthGate>
      </AuthProvider>,
    )
    await flushEffects()

    act(() => {
      window.dispatchEvent(new Event(BACKEND_PROBE_REQUESTED_EVENT))
      window.dispatchEvent(new Event(BACKEND_PROBE_REQUESTED_EVENT))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(mocks.getStatus).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  })

  it('still shows login for an explicit unauthenticated response', async () => {
    mocks.getStatus.mockResolvedValueOnce({ authed: false, tokenConfigured: true })

    render(
      <AuthProvider>
        <AuthGate><WorkspaceHarness /></AuthGate>
      </AuthProvider>,
    )
    await flushEffects()

    expect(screen.queryByText('workspace-app')).toBeNull()
    expect(document.querySelector('input[type="password"]')).toBeTruthy()
  })
})
