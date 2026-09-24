// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VersionInfo } from '../../api/types'

const mocks = vi.hoisted(() => ({
  versionInfo: null as VersionInfo | null,
  nativeStatus: null as { phase: 'downloaded'; version: string; releaseUrl: string } | null,
  versionError: null as string | null,
  relayTarget: null as { machine: string; machineName: string; project: string; projectName: string } | null,
}))

vi.mock('../../hooks/useUpdateLifecycle', () => ({
  useUpdateLifecycle: () => ({ versionInfo: mocks.versionInfo, nativeStatus: mocks.nativeStatus,
    error: mocks.versionError, checking: false, refresh: vi.fn(async () => undefined) }),
}))

vi.mock('../../hooks/useRelayConnection', () => ({
  useRelayConnection: () => ({
    status: { schemaVersion: 1, target: mocks.relayTarget },
    fleet: [], loading: false, busy: false, error: null,
    refresh: vi.fn(async () => undefined),
  }),
}))

import '../../i18n'
import { i18n } from '../../i18n'
import { AboutOpenAliceSection } from './AboutOpenAliceSection'

const currentVersion: VersionInfo = {
  current: '0.82.0-beta', channel: 'beta', updateAuthority: 'source', latest: '0.82.0-beta', hasUpdate: false,
  releaseUrl: 'https://example.test/v0.82.0-beta', releaseNotes: null, publishedAt: '2026-07-19T00:00:00Z', error: null,
}

beforeAll(async () => { await i18n.changeLanguage('en') })
beforeEach(() => {
  mocks.versionInfo = currentVersion
  mocks.nativeStatus = null
  mocks.versionError = null
  mocks.relayTarget = null
})
afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'openAlice'); vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('AboutOpenAliceSection', () => {
  it('shows separate client and backend versions and reviews the selected remote project', async () => {
    mocks.relayTarget = { machine: 'cloud', machineName: 'Cloud Linux', project: 'main-cloud', projectName: 'Main Cloud' }
    mocks.versionInfo = { ...currentVersion, current: '0.93.1', channel: 'dev', updateAuthority: 'cli' }
    const preview = {
      id: 'plan-1', mode: 'upgrade', machine: { key: 'cloud', label: 'Cloud Linux', sshTarget: 'alice@cloud' },
      project: { key: 'main-cloud', displayName: 'Main Cloud' }, platform: 'Linux x64',
      installedVersion: '0.93.1', targetVersion: '0.94.1-beta', runtime: 'running · cli-server',
      actions: ['update remote OpenAlice CLI', 'restart remote OpenAlice Server'], blocker: null,
      deferredUpdate: false, expiresAt: '2026-09-24T10:00:00Z',
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => preview }))
    render(<AboutOpenAliceSection />)
    expect(screen.getByText('This app').parentElement?.textContent).not.toContain('v0.93.1')
    expect(screen.getByText('v0.93.1')).toBeTruthy()
    expect(screen.getByText('Cloud Linux')).toBeTruthy()
    expect(screen.getByText(/Main Cloud/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Review backend update' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/relay/v1/machines/plan', expect.objectContaining({
      body: JSON.stringify({ mode: 'upgrade', machineKey: 'cloud', projectKey: 'main-cloud' }),
    })))
    expect(await screen.findByText('0.93.1 → 0.94.1-beta')).toBeTruthy()
  })

  it('shows the running version without duplicating the update check control', () => {
    render(<AboutOpenAliceSection />)
    expect(screen.getByText('v0.82.0-beta')).toBeTruthy()
    expect(screen.getByText('You’re up to date.')).toBeTruthy()
    expect(screen.getByText('Browser / server')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull()
    expect(screen.getByRole('button', { name: 'View releases' })).toBeTruthy()
  })

  it.each([
    ['service', 'dev', 'Updates are managed by this deployment service.'],
    ['cli', 'dev', 'Use the OpenAlice CLI to check this development build for updates.'],
    ['none', 'pinned', 'This installation does not follow an automatic update channel.'],
  ] as const)('shows %s update ownership', (updateAuthority, channel, expectedStatus) => {
    mocks.versionInfo = { ...currentVersion, current: '0.90.1', channel, updateAuthority }
    render(<AboutOpenAliceSection />)
    expect(screen.getByText(expectedStatus)).toBeTruthy()
  })

  it('uses the shared native updater state and offers restart after download', async () => {
    const installAndRestart = vi.fn().mockResolvedValue({ ok: true })
    Object.defineProperty(window, 'openAlice', { configurable: true, value: {
      runtime: { info: vi.fn().mockResolvedValue({ mode: 'electron-packaged' }) },
      updater: { installAndRestart, openRelease: vi.fn().mockResolvedValue({ ok: true }) },
    } })
    mocks.nativeStatus = { phase: 'downloaded', version: '0.83.0-beta', releaseUrl: 'https://example.test/v0.83.0-beta' }
    render(<AboutOpenAliceSection />)
    expect(await screen.findByText('Desktop app')).toBeTruthy()
    expect(screen.getByText('OpenAlice v0.83.0-beta is ready to install.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Restart and update' }))
    await waitFor(() => expect(installAndRestart).toHaveBeenCalledOnce())
  })

  it('shows a failed shared version read without stale status', () => {
    mocks.versionInfo = null
    mocks.versionError = 'version unavailable'
    render(<AboutOpenAliceSection />)
    expect(screen.getByText('Couldn’t check for updates.')).toBeTruthy()
    expect(screen.queryByText('v0.82.0-beta')).toBeNull()
  })
})
