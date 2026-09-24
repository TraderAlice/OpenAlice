// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VersionInfo } from '../api/types'

const mocks = vi.hoisted(() => ({
  versionInfo: null as VersionInfo | null,
  autoCheckApp: true,
}))

vi.mock('../hooks/useUpdateLifecycle', () => ({
  useUpdateLifecycle: () => ({ versionInfo: mocks.versionInfo, preferences: { autoCheckApp: mocks.autoCheckApp } }),
}))

import { UpdateBanner } from './UpdateBanner'

const availableUpdate: VersionInfo = {
  current: '0.90.1', channel: 'stable', updateAuthority: 'source', latest: '0.90.2', hasUpdate: true,
  releaseUrl: 'https://example.test/v0.90.2', releaseNotes: null, publishedAt: '2026-09-01T00:00:00Z', error: null,
}

beforeEach(() => {
  localStorage.clear()
  mocks.versionInfo = availableUpdate
  mocks.autoCheckApp = true
})

afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'openAlice'); vi.clearAllMocks() })

describe('UpdateBanner', () => {
  it.each([
    ['source', 'git pull && pnpm build'],
    ['cli', 'openalice update'],
    ['desktop', 'Desktop updater will prompt when the download is ready'],
  ] as const)('shows the %s-owned update action', (updateAuthority, action) => {
    mocks.versionInfo = { ...availableUpdate, updateAuthority }
    render(<UpdateBanner />)
    expect(screen.getByText(action)).toBeTruthy()
  })

  it.each(['service', 'none'] as const)('hides %s-owned updates', (updateAuthority) => {
    mocks.versionInfo = { ...availableUpdate, updateAuthority }
    render(<UpdateBanner />)
    expect(screen.queryByText('v0.90.2')).toBeNull()
  })

  it('hides the banner when automatic app checks are disabled', () => {
    mocks.autoCheckApp = false
    render(<UpdateBanner />)
    expect(screen.queryByText('v0.90.2')).toBeNull()
  })

  it('shows a newer version after the previous one was skipped', () => {
    const view = render(<UpdateBanner />)
    fireEvent.click(screen.getByRole('button', { name: /Skip this version/ }))
    expect(screen.queryByText('v0.90.2')).toBeNull()
    mocks.versionInfo = { ...availableUpdate, latest: '0.90.3' }
    view.rerender(<UpdateBanner />)
    expect(screen.getByText('v0.90.3')).toBeTruthy()
  })

  it('keeps a dismissal for the current page session', () => {
    const view = render(<UpdateBanner />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    mocks.versionInfo = { ...availableUpdate, latest: '0.90.3' }
    view.rerender(<UpdateBanner />)
    expect(screen.queryByText('v0.90.3')).toBeNull()
  })

  it('hides the old update when the shared version state clears', () => {
    const view = render(<UpdateBanner />)
    expect(screen.getByText('v0.90.2')).toBeTruthy()
    mocks.versionInfo = null
    view.rerender(<UpdateBanner />)
    expect(screen.queryByText('v0.90.2')).toBeNull()
  })
})
