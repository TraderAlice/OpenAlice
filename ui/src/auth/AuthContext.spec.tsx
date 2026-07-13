import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
}))

vi.mock('./api', () => ({
  getStatus: mocks.getStatus,
}))

import { AuthProvider, useAuth } from './AuthContext'
import { AuthGate } from './AuthGate'

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

    expect(screen.getByRole('status')).toBeTruthy()
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
    expect(screen.getByRole('status')).toBeTruthy()
    expect(document.querySelector('input[type="password"]')).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })

    expect(screen.getByText('workspace-app')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
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
