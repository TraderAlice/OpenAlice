// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getVersion: vi.fn(),
  checkVersion: vi.fn(),
  backendUnavailable: false,
  backendRecoveryGeneration: 0,
  relayTarget: null as { machine: string; machineName: string; project: string; projectName: string } | null,
}))

vi.mock('../../api', () => ({
  api: {
    version: {
      get: mocks.getVersion,
      check: mocks.checkVersion,
    },
  },
}))

vi.mock('../../auth/AuthContext', () => ({
  useBackendRecoverySignal: () => ({
    backendUnavailable: mocks.backendUnavailable,
    backendRecoveryGeneration: mocks.backendRecoveryGeneration,
  }),
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

const currentVersion = {
  current: '0.82.0-beta',
  channel: 'beta' as const,
  updateAuthority: 'source' as const,
  latest: '0.82.0-beta',
  hasUpdate: false,
  releaseUrl: 'https://example.test/v0.82.0-beta',
  releaseNotes: null,
  publishedAt: '2026-07-19T00:00:00Z',
  error: null,
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  mocks.backendUnavailable = false
  mocks.backendRecoveryGeneration = 0
  mocks.relayTarget = null
  mocks.getVersion.mockResolvedValue(currentVersion)
  mocks.checkVersion.mockResolvedValue(currentVersion)
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'openAlice')
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('AboutOpenAliceSection', () => {
  it('separates the client and connected backend versions and reviews that project\'s upgrade', async () => {
    mocks.relayTarget = { machine: 'cloud', machineName: 'Cloud Linux', project: 'main-cloud', projectName: 'Main Cloud' }
    mocks.getVersion.mockResolvedValue({ ...currentVersion, current: '0.93.1', channel: 'dev', updateAuthority: 'cli' })
    const preview = {
      id: 'plan-1', mode: 'upgrade', machine: { key: 'cloud', label: 'Cloud Linux', sshTarget: 'alice@cloud' },
      project: { key: 'main-cloud', displayName: 'Main Cloud' }, platform: 'Linux x64',
      installedVersion: '0.93.1', targetVersion: '0.94.1-beta', runtime: 'running · cli-server',
      actions: ['update remote OpenAlice CLI', 'restart remote OpenAlice Server'], blocker: null,
      deferredUpdate: false, expiresAt: '2026-09-24T10:00:00Z',
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => preview }))
    render(<AboutOpenAliceSection />)

    const client = screen.getByText('This app').parentElement
    expect(client?.textContent).not.toContain('v0.93.1')
    expect(await screen.findByText('v0.93.1')).toBeTruthy()
    expect(screen.getByText('Cloud Linux')).toBeTruthy()
    expect(screen.getByText(/Main Cloud/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Review backend update' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/relay/v1/machines/plan', expect.objectContaining({
      body: JSON.stringify({ mode: 'upgrade', machineKey: 'cloud', projectKey: 'main-cloud' }),
    })))
    expect(await screen.findByText('0.93.1 → 0.94.1-beta')).toBeTruthy()
  })

  it('shows the running version and performs a forced manual check', async () => {
    render(<AboutOpenAliceSection />)

    expect(await screen.findByText('v0.82.0-beta')).toBeTruthy()
    expect(screen.getByText('You’re up to date.')).toBeTruthy()
    expect(screen.getByText('Browser / server')).toBeTruthy()
    expect(screen.queryByText('Current AliceProject')).toBeNull()
    expect(screen.getByRole('button', { name: 'Check for updates' }).className).toContain('min-h-10')
    expect(screen.getByRole('button', { name: 'View releases' }).className).toContain('min-h-10')

    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))

    await waitFor(() => expect(mocks.checkVersion).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByText('Checking for updates…')).toBeNull())
    expect(screen.getByText('You’re up to date.')).toBeTruthy()
  })

  it('uses the backend channel instead of inferring it from the version', async () => {
    mocks.getVersion.mockResolvedValue({
      ...currentVersion,
      current: '0.90.1',
      channel: 'dev',
    })

    render(<AboutOpenAliceSection />)

    expect(await screen.findByText('Development channel')).toBeTruthy()
  })

  it('refreshes Runtime identity after backend recovery without remounting', async () => {
    const recoveredVersion = {
      ...currentVersion,
      current: '0.91.0-beta.3',
      latest: '0.91.0-beta.3',
      updateAuthority: 'service' as const,
    }
    const view = render(<AboutOpenAliceSection />)

    expect(await screen.findByText('v0.82.0-beta')).toBeTruthy()

    mocks.backendUnavailable = true
    view.rerender(<AboutOpenAliceSection />)

    mocks.getVersion.mockResolvedValueOnce(recoveredVersion)
    mocks.backendUnavailable = false
    mocks.backendRecoveryGeneration = 1
    view.rerender(<AboutOpenAliceSection />)

    expect(await screen.findByText('v0.91.0-beta.3')).toBeTruthy()
    expect(mocks.getVersion).toHaveBeenCalledTimes(2)
  })

  it('hides the previous Runtime identity when recovery reads fail', async () => {
    const view = render(<AboutOpenAliceSection />)
    expect(await screen.findByText('v0.82.0-beta')).toBeTruthy()

    mocks.backendUnavailable = true
    view.rerender(<AboutOpenAliceSection />)

    mocks.getVersion.mockRejectedValueOnce(new Error('version unavailable'))
    mocks.backendUnavailable = false
    mocks.backendRecoveryGeneration = 1
    view.rerender(<AboutOpenAliceSection />)

    expect(screen.queryByText('v0.82.0-beta')).toBeNull()
    expect(await screen.findByText('Couldn’t check for updates.')).toBeTruthy()
  })

  it.each([
    ['service', 'dev', 'Updates are managed by this deployment service.'],
    ['cli', 'dev', 'Use the OpenAlice CLI to check this development build for updates.'],
    ['none', 'pinned', 'This installation does not follow an automatic update channel.'],
  ] as const)('shows %s update ownership without offering a no-op Web check', async (
    updateAuthority,
    channel,
    expectedStatus,
  ) => {
    mocks.getVersion.mockResolvedValue({
      ...currentVersion,
      current: '0.90.1',
      channel,
      updateAuthority,
    })

    render(<AboutOpenAliceSection />)

    expect(await screen.findByText(expectedStatus)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull()
  })

  it('uses the packaged updater and offers restart after a download completes', async () => {
    type TestUpdateStatus =
      | { phase: 'downloaded'; version: string; releaseUrl: string }
      | { phase: 'installing'; version: string; stage: 'stopping-services' }
    let listener: ((status: TestUpdateStatus) => void) | null = null
    const updater = {
      getStatus: vi.fn().mockResolvedValue(null),
      checkForUpdates: vi.fn().mockImplementation(async () => {
        listener?.({
          phase: 'downloaded',
          version: '0.83.0-beta',
          releaseUrl: 'https://example.test/v0.83.0-beta',
        })
        return { supported: true as const }
      }),
      onStatus: vi.fn((callback) => {
        listener = callback
        return () => { listener = null }
      }),
      installAndRestart: vi.fn().mockImplementation(async () => {
        listener?.({
          phase: 'installing',
          version: '0.83.0-beta',
          stage: 'stopping-services',
        })
        return { ok: true }
      }),
      openRelease: vi.fn().mockResolvedValue({ ok: true }),
    }
    Object.defineProperty(window, 'openAlice', {
      configurable: true,
      value: {
        runtime: {
          info: vi.fn().mockResolvedValue({
            mode: 'electron-packaged',
            transport: 'electron-ipc',
            ports: { web: null, mcp: null, uta: null },
            userDataHome: '/tmp/openalice',
            appHome: '/Applications/OpenAlice.app',
          }),
        },
        updater,
      },
    })

    render(<AboutOpenAliceSection />)
    expect(await screen.findByText('Desktop app')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))

    expect(await screen.findByText('OpenAlice v0.83.0-beta is ready to install.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Restart and update' }))
    await waitFor(() => expect(updater.installAndRestart).toHaveBeenCalledOnce())
    expect(await screen.findByText('Safely stopping OpenAlice services…')).toBeTruthy()
    expect(screen.getByRole('progressbar')).toBeTruthy()
    expect(screen.getByText(/OpenAlice will close while the system installs/)).toBeTruthy()
  })
})
