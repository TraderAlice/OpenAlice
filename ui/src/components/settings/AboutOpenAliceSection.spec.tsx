// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getVersion: vi.fn(),
  checkVersion: vi.fn(),
  getAliceProject: vi.fn(),
  getBackendConnection: vi.fn(),
  backendUnavailable: false,
  backendRecoveryGeneration: 0,
}))

vi.mock('../../api', () => ({
  api: {
    version: {
      get: mocks.getVersion,
      check: mocks.checkVersion,
    },
    aliceProject: {
      get: mocks.getAliceProject,
    },
  },
}))

vi.mock('../../auth/backendConnection', () => ({
  getBackendConnection: mocks.getBackendConnection,
}))

vi.mock('../../auth/AuthContext', () => ({
  useBackendRecoverySignal: () => ({
    backendUnavailable: mocks.backendUnavailable,
    backendRecoveryGeneration: mocks.backendRecoveryGeneration,
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

const currentProject = {
  id: 'alice-project-test',
  key: 'research',
  displayName: 'Research AliceProject',
  home: '/tmp/openalice-research',
  appRoot: '/tmp/openalice-app',
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  mocks.backendUnavailable = false
  mocks.backendRecoveryGeneration = 0
  mocks.getVersion.mockResolvedValue(currentVersion)
  mocks.checkVersion.mockResolvedValue(currentVersion)
  mocks.getAliceProject.mockResolvedValue({ project: currentProject })
  mocks.getBackendConnection.mockReturnValue({ kind: 'local', endpoint: '127.0.0.1:47331' })
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'openAlice')
  vi.clearAllMocks()
})

describe('AboutOpenAliceSection', () => {
  it('shows the running version and performs a forced manual check', async () => {
    render(<AboutOpenAliceSection />)

    expect(await screen.findByText('v0.82.0-beta')).toBeTruthy()
    expect(screen.getByText('You’re up to date.')).toBeTruthy()
    expect(screen.getByText('Browser / server')).toBeTruthy()
    expect(await screen.findByText('Research AliceProject')).toBeTruthy()
    expect(screen.getByText('/tmp/openalice-research')).toBeTruthy()
    expect(screen.getByText('alice-project-test')).toBeTruthy()
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

  it('refreshes Runtime and AliceProject identity after backend recovery without remounting', async () => {
    const recoveredVersion = {
      ...currentVersion,
      current: '0.91.0-beta.3',
      latest: '0.91.0-beta.3',
      updateAuthority: 'service' as const,
    }
    const recoveredProject = {
      ...currentProject,
      displayName: 'Remote AliceProject',
      appRoot: '/data/home/.local/share/openalice/releases/0.91.0-beta.3',
    }
    const view = render(<AboutOpenAliceSection />)

    expect(await screen.findByText('v0.82.0-beta')).toBeTruthy()
    expect(await screen.findByText('Research AliceProject')).toBeTruthy()

    mocks.backendUnavailable = true
    view.rerender(<AboutOpenAliceSection />)

    mocks.getVersion.mockResolvedValueOnce(recoveredVersion)
    mocks.getAliceProject.mockResolvedValueOnce({ project: recoveredProject })
    mocks.backendUnavailable = false
    mocks.backendRecoveryGeneration = 1
    view.rerender(<AboutOpenAliceSection />)

    expect(await screen.findByText('v0.91.0-beta.3')).toBeTruthy()
    expect(await screen.findByText('Remote AliceProject')).toBeTruthy()
    expect(screen.getByText('/data/home/.local/share/openalice/releases/0.91.0-beta.3')).toBeTruthy()
    expect(mocks.getVersion).toHaveBeenCalledTimes(2)
    expect(mocks.getAliceProject).toHaveBeenCalledTimes(2)
  })

  it('hides the previous Runtime identity when recovery reads fail', async () => {
    const view = render(<AboutOpenAliceSection />)
    expect(await screen.findByText('v0.82.0-beta')).toBeTruthy()
    expect(await screen.findByText('Research AliceProject')).toBeTruthy()

    mocks.backendUnavailable = true
    view.rerender(<AboutOpenAliceSection />)

    mocks.getVersion.mockRejectedValueOnce(new Error('version unavailable'))
    mocks.getAliceProject.mockRejectedValueOnce(new Error('project unavailable'))
    mocks.backendUnavailable = false
    mocks.backendRecoveryGeneration = 1
    view.rerender(<AboutOpenAliceSection />)

    expect(screen.queryByText('v0.82.0-beta')).toBeNull()
    expect(screen.queryByText('Research AliceProject')).toBeNull()
    expect(await screen.findByText('Couldn’t check for updates.')).toBeTruthy()
    expect(await screen.findByText('AliceProject information is unavailable.')).toBeTruthy()
  })

  it('shows the healthy SSH route that owns this browser surface', async () => {
    mocks.getBackendConnection.mockReturnValue({
      kind: 'remote',
      target: 'alice@example.com',
      sshPort: 2222,
      runtimePort: 47331,
      localEndpoint: '127.0.0.1:40123',
    })

    render(<AboutOpenAliceSection />)

    expect(await screen.findByRole('heading', { name: 'Backend connection' })).toBeTruthy()
    expect(screen.getByText('Connected')).toBeTruthy()
    expect(screen.getByText('alice@example.com:2222')).toBeTruthy()
    expect(screen.getByText('127.0.0.1:40123')).toBeTruthy()
    expect(screen.getByText('127.0.0.1:47331')).toBeTruthy()
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
