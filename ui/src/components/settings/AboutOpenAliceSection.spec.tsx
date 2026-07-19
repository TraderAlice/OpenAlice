// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getVersion: vi.fn(),
  checkVersion: vi.fn(),
}))

vi.mock('../../api', () => ({
  api: {
    version: {
      get: mocks.getVersion,
      check: mocks.checkVersion,
    },
  },
}))

import '../../i18n'
import { i18n } from '../../i18n'
import { AboutOpenAliceSection } from './AboutOpenAliceSection'

const currentVersion = {
  current: '0.82.0-beta',
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
  mocks.getVersion.mockResolvedValue(currentVersion)
  mocks.checkVersion.mockResolvedValue(currentVersion)
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

    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))

    await waitFor(() => expect(mocks.checkVersion).toHaveBeenCalledOnce())
    expect(screen.getByText('You’re up to date.')).toBeTruthy()
  })

  it('uses the packaged updater and offers restart after a download completes', async () => {
    let listener: ((status: {
      phase: 'downloaded'
      version: string
      releaseUrl: string
    }) => void) | null = null
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
      installAndRestart: vi.fn().mockResolvedValue({ ok: true }),
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
  })
})
