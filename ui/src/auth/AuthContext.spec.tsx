// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import '../i18n'

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
}))

vi.mock('./api', () => ({
  getStatus: mocks.getStatus,
}))

import { AuthProvider, BACKEND_HEALTH_POLL_MS, useAuth } from './AuthContext'
import { AuthGate, BackendUnavailableScreen } from './AuthGate'
import { BACKEND_PROBE_REQUESTED_EVENT } from './backendConnectivity'

function WorkspaceHarness() {
  const { refresh } = useAuth()
  return (
    <>
      <div>workspace-app</div>
      <button type="button" onClick={() => void refresh()}>Refresh auth</button>
    </>
  )
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
  it('shows the exact SSH route when a remote Runtime is unavailable', () => {
    render(
      <BackendUnavailableScreen
        retry={vi.fn(async () => undefined)}
        connection={{
          kind: 'remote',
          target: 'alice@example.com',
          sshPort: 2222,
          runtimePort: 47331,
          localEndpoint: '127.0.0.1:40123',
        }}
      />,
    )

    expect(screen.getByRole('alertdialog', {
      name: 'OpenAlice lost its connection to alice@example.com:2222',
    })).toBeTruthy()
    expect(screen.getByText('SSH tunnel')).toBeTruthy()
    expect(screen.getByText('127.0.0.1:40123')).toBeTruthy()
    expect(screen.getByText('127.0.0.1:47331')).toBeTruthy()
    expect(screen.getAllByText('alice@example.com:2222').length).toBeGreaterThan(0)
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
