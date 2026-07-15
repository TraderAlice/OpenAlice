import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import '../i18n'
import { i18n } from '../i18n'
import { DataHomeSection } from './SettingsPage'

const currentStatus: OpenAliceDataHomeStatus = {
  currentHome: '/Users/alice/.openalice-dev/project-a',
  defaultHome: '/Users/alice/.openalice',
  source: 'desktop-preference',
  recentHomes: [
    '/Users/alice/.openalice-dev/project-a',
    '/Users/alice/.openalice-dev/project-b',
  ],
  askOnStartup: false,
  selectionLocked: false,
  selectionLock: null,
}

function installBridge(status: OpenAliceDataHomeStatus = currentStatus) {
  const dataHome = {
    getStatus: vi.fn().mockResolvedValue(status),
    chooseAndRestart: vi.fn().mockResolvedValue({ outcome: 'restarting', status }),
    useRecentAndRestart: vi.fn().mockResolvedValue({ outcome: 'restarting', status }),
    setAskOnStartup: vi.fn().mockImplementation(async (enabled: boolean) => ({
      ...status,
      askOnStartup: enabled,
    })),
    openCurrent: vi.fn().mockResolvedValue(''),
  }
  Object.defineProperty(window, 'openAlice', {
    configurable: true,
    value: { dataHome },
  })
  return dataHome
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'openAlice')
  vi.clearAllMocks()
})

describe('DataHomeSection', () => {
  it('explains command-line selection on browser/dev surfaces', () => {
    render(<DataHomeSection />)

    expect(screen.getByText('openalice start --home <path>')).toBeTruthy()
    expect(screen.getByText('pnpm dev -- --home <path>')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Choose folder and restart' })).toBeNull()
  })

  it('shows the complete desktop home and can switch to a recent location', async () => {
    const bridge = installBridge()
    render(<DataHomeSection />)

    expect(await screen.findByText(currentStatus.currentHome)).toBeTruthy()
    expect(screen.getByText('Desktop selection')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use and restart' }))

    await waitFor(() => {
      expect(bridge.useRecentAndRestart)
        .toHaveBeenCalledWith('/Users/alice/.openalice-dev/project-b')
    })
    expect(await screen.findByText('Restarting...')).toBeTruthy()
  })

  it('persists the ask-on-startup preference through the desktop bridge', async () => {
    const bridge = installBridge()
    render(<DataHomeSection />)

    const toggle = await screen.findByRole('switch', { name: 'Ask which location to use at startup' })
    fireEvent.click(toggle)

    await waitFor(() => expect(bridge.setAskOnStartup).toHaveBeenCalledWith(true))
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })

  it('surfaces a native open-folder failure returned by Electron', async () => {
    const bridge = installBridge()
    bridge.openCurrent.mockResolvedValue('folder unavailable')
    render(<DataHomeSection />)

    fireEvent.click(await screen.findByRole('button', { name: 'Open folder' }))
    expect(await screen.findByText('Could not open the current data folder.')).toBeTruthy()
  })

  it('disables switching when an environment override splits the root boundary', async () => {
    installBridge({
      ...currentStatus,
      source: 'environment',
      selectionLocked: true,
      selectionLock: 'workspace-root-env',
    })
    render(<DataHomeSection />)

    expect(await screen.findByText(/AQ_LAUNCHER_ROOT/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Choose folder and restart' }))
      .toHaveProperty('disabled', true)
    expect(screen.getByRole('switch', { name: 'Ask which location to use at startup' }))
      .toHaveProperty('disabled', true)
  })
})
