import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const listeners = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    listeners,
    capability: { enabled: false, reason: 'not-packaged', configPath: null } as
      | { enabled: true; configPath: string }
      | { enabled: false; reason: 'not-packaged'; configPath: null }
      | { enabled: false; reason: 'missing-config'; configPath: string },
    app: {
      isPackaged: false,
      getVersion: vi.fn(() => '0.0.0'),
    },
    ipcMain: {
      removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
    },
    shell: {
      openExternal: vi.fn(async () => {}),
    },
    autoUpdater: {
      checkForUpdates: vi.fn(),
      quitAndInstall: vi.fn(),
      on: vi.fn((event: string, listener: (...args: unknown[]) => unknown) => {
        listeners.set(event, listener)
      }),
    },
  }
})

vi.mock('electron', () => ({
  app: mocks.app,
  ipcMain: mocks.ipcMain,
  shell: mocks.shell,
}))

vi.mock('electron-updater', () => ({
  default: { autoUpdater: mocks.autoUpdater },
}))

vi.mock('./auto-update-policy.js', () => ({
  resolveAutoUpdateCapability: vi.fn(() => mocks.capability),
}))

import { channelForVersion, configureAutoUpdate } from './auto-update.js'

describe('channelForVersion', () => {
  it('keeps Apple Silicon on the canonical mac feed', () => {
    expect(channelForVersion('1.2.3', 'darwin', 'arm64')).toBe('latest')
    expect(channelForVersion('1.2.3-beta.4', 'darwin', 'arm64')).toBe('beta')
  })

  it('routes Intel builds to architecture-specific mac feeds', () => {
    expect(channelForVersion('1.2.3', 'darwin', 'x64')).toBe('latest-intel')
    expect(channelForVersion('1.2.3-beta.4', 'darwin', 'x64')).toBe('beta-intel')
  })

  it('does not route Windows x64 through the Intel Mac feed', () => {
    expect(channelForVersion('1.2.3', 'win32', 'x64')).toBe('latest')
    expect(channelForVersion('1.2.3-beta.4', 'win32', 'x64')).toBe('beta')
  })
})

describe('configureAutoUpdate', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.listeners.clear()
    vi.clearAllMocks()
    mocks.app.isPackaged = false
    mocks.capability = { enabled: false, reason: 'not-packaged', configPath: null }
    mocks.autoUpdater.checkForUpdates.mockResolvedValue(undefined)
  })

  it('keeps updater IPC stable when the updater engine is disabled', async () => {
    configureAutoUpdate({} as never, { beforeInstall: vi.fn(async () => {}) })

    expect([...mocks.handlers.keys()]).toEqual([
      'openalice:updater:get-status',
      'openalice:updater:check-for-updates',
      'openalice:updater:install-and-restart',
      'openalice:updater:open-release',
    ])
    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled()

    const getStatus = mocks.handlers.get('openalice:updater:get-status')
    const check = mocks.handlers.get('openalice:updater:check-for-updates')
    const install = mocks.handlers.get('openalice:updater:install-and-restart')
    const openRelease = mocks.handlers.get('openalice:updater:open-release')
    expect(await getStatus?.()).toBeNull()
    await expect(check?.()).resolves.toEqual({ supported: false, reason: 'not-packaged' })
    await expect(install?.()).rejects.toThrow('No downloaded update is ready to install.')
    await openRelease?.({}, undefined)
    expect(mocks.shell.openExternal)
      .toHaveBeenCalledWith('https://github.com/TraderAlice/OpenAlice/releases')
  })

  it('deduplicates an active native check and exposes a manual check handler', async () => {
    mocks.app.isPackaged = true
    mocks.capability = { enabled: true, configPath: '/Applications/OpenAlice.app/app-update.yml' }
    let resolveCheck!: () => void
    const pendingCheck = new Promise<void>((resolve) => {
      resolveCheck = resolve
    })
    mocks.autoUpdater.checkForUpdates.mockReturnValue(pendingCheck)

    configureAutoUpdate({ isDestroyed: () => false, webContents: { send: vi.fn() } } as never, {
      beforeInstall: vi.fn(async () => {}),
    })

    const check = mocks.handlers.get('openalice:updater:check-for-updates')!
    const manual = check()
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledOnce()

    resolveCheck()
    await expect(manual).resolves.toEqual({ supported: true })

    await check()
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('reports visible install stages before handing off to the native updater', async () => {
    mocks.app.isPackaged = true
    mocks.app.getVersion.mockReturnValue('0.87.0-beta')
    mocks.capability = { enabled: true, configPath: '/Applications/OpenAlice.app/app-update.yml' }
    const send = vi.fn()
    const setProgressBar = vi.fn()
    const beforeInstall = vi.fn(async (_version, report) => {
      report('stopping-services')
      report('releasing-runtime')
    })
    const onInstallHandoff = vi.fn(async () => {})
    configureAutoUpdate({
      isDestroyed: () => false,
      setProgressBar,
      webContents: { send },
    } as never, { beforeInstall, onInstallHandoff })

    mocks.listeners.get('update-available')?.({ version: '0.88.0-beta' })
    mocks.listeners.get('download-progress')?.({ percent: 42.4 })
    mocks.listeners.get('update-downloaded')?.({ version: '0.88.0-beta' })
    const install = mocks.handlers.get('openalice:updater:install-and-restart')!
    await expect(install()).resolves.toEqual({ ok: true })

    expect(beforeInstall).toHaveBeenCalledWith('0.88.0-beta', expect.any(Function))
    expect(onInstallHandoff).toHaveBeenCalledWith('0.88.0-beta')
    expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true)
    expect(setProgressBar).toHaveBeenCalledWith(0.424)
    expect(setProgressBar).toHaveBeenCalledWith(2)
    expect(send.mock.calls.map(([, status]) => status)).toContainEqual({
      phase: 'installing',
      version: '0.88.0-beta',
      stage: 'handing-off',
    })
  })

  it('reports an installer handoff failure once', async () => {
    mocks.app.isPackaged = true
    mocks.capability = { enabled: true, configPath: '/Applications/OpenAlice.app/app-update.yml' }
    const onInstallFailure = vi.fn(async () => {})
    configureAutoUpdate({
      isDestroyed: () => false,
      setProgressBar: vi.fn(),
      webContents: { send: vi.fn() },
    } as never, {
      beforeInstall: vi.fn(async () => {}),
      onInstallFailure,
    })
    mocks.listeners.get('update-downloaded')?.({ version: '0.88.0-beta' })
    mocks.autoUpdater.quitAndInstall.mockImplementationOnce(() => {
      throw new Error('ShipIt refused the update')
    })

    const install = mocks.handlers.get('openalice:updater:install-and-restart')!
    await expect(install()).rejects.toThrow('ShipIt refused the update')
    expect(onInstallFailure).toHaveBeenCalledOnce()
  })
})
