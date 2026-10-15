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
      getVersion: vi.fn(() => '39.8.10'),
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
      downloadUpdate: vi.fn(async () => []),
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
    const controls = configureAutoUpdate({} as never, { beforeInstall: vi.fn(async () => {}) }, '0.94.1-beta.2')

    expect([...mocks.handlers.keys()]).toEqual([
      'openalice:updater:get-status',
      'openalice:updater:open-release',
    ])
    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled()

    const getStatus = mocks.handlers.get('openalice:updater:get-status')
    const openRelease = mocks.handlers.get('openalice:updater:open-release')
    expect(await getStatus?.()).toBeNull()
    await expect(controls.discover()).resolves.toMatchObject({ status: 'unsupported', message: 'not-packaged', currentVersion: '0.94.1-beta.2', channel: 'dev' })
    await expect(controls.install()).rejects.toThrow('No downloaded update is ready to install.')
    await openRelease?.({}, undefined)
    expect(mocks.shell.openExternal)
      .toHaveBeenCalledWith('https://github.com/TraderAlice/OpenAlice/releases')
  })

  it('deduplicates owner discovery without exposing a second check IPC', async () => {
    mocks.app.isPackaged = true
    mocks.capability = { enabled: true, configPath: '/Applications/OpenAlice.app/app-update.yml' }
    let resolveCheck!: () => void
    const pendingCheck = new Promise<void>((resolve) => {
      resolveCheck = resolve
    })
    mocks.autoUpdater.checkForUpdates.mockReturnValue(pendingCheck)

    const controls = configureAutoUpdate({ isDestroyed: () => false, webContents: { send: vi.fn() } } as never, {
      beforeInstall: vi.fn(async () => {}),
    }, '0.94.1')

    expect(mocks.handlers.has('openalice:updater:check-for-updates')).toBe(false)
    const manual = controls.discover()
    const joined = controls.discover()
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledOnce()

    mocks.listeners.get('update-not-available')?.({ version: '0.94.1' })
    resolveCheck()
    await expect(manual).resolves.toMatchObject({ status: 'current', latestVersion: '0.94.1' })
    await expect(joined).resolves.toMatchObject({ status: 'current' })
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledOnce()
  })

  it.each([
    ['0.94.1', '0.94.0', 'blocked', 'older-release'],
    ['0.94.1-beta.10', '0.94.1-beta.2', 'blocked', 'older-release'],
    ['0.94.1+local.7', '0.94.1', 'current', 'same-release'],
    ['0.94.1-beta.2', '0.94.1-beta.10', 'available', 'newer-release'],
    ['0.94.1', '0.95.0', 'available', 'newer-release'],
    ['0.94.1', '0.94.1-beta.2', 'unknown', 'invalid-identity'],
    ['0.94.1', 'invalid', 'unknown', 'invalid-identity'],
  ])('uses policy for native event %s -> %s (%s)', async (current, candidate, status, reason) => {
    mocks.app.isPackaged = true
    mocks.capability = { enabled: true, configPath: '/fixture/app-update.yml' }
    const beforeInstall = vi.fn()
    const controls = configureAutoUpdate({ isDestroyed: () => false, webContents: { send: vi.fn() } } as never, { beforeInstall }, current)
    // Transport intentionally advertises every candidate as available.
    mocks.autoUpdater.checkForUpdates.mockImplementationOnce(async () => { mocks.listeners.get('update-available')?.({ version: candidate }) })
    await expect(controls.discover()).resolves.toMatchObject({ status, reason, latestVersion: candidate })
    expect(mocks.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(status === 'available' ? 1 : 0)
    if (status !== 'available') {
      mocks.listeners.get('update-downloaded')?.({ version: candidate })
      expect(controls.downloaded()).toBeNull()
      await expect(controls.install(candidate)).rejects.toThrow()
      expect(beforeInstall).not.toHaveBeenCalled()
      expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
    }
  })

  it('does not turn an older native no-update result into current', async () => {
    mocks.app.isPackaged = true
    mocks.capability = { enabled: true, configPath: '/fixture/app-update.yml' }
    const controls = configureAutoUpdate({ isDestroyed: () => false, webContents: { send: vi.fn() } } as never, { beforeInstall: vi.fn() }, '0.94.1')
    mocks.autoUpdater.checkForUpdates.mockImplementationOnce(async () => { mocks.listeners.get('update-not-available')?.({ version: '0.94.0' }) })
    await expect(controls.discover()).resolves.toMatchObject({ status: 'blocked', reason: 'older-release' })
  })

  it('rejects a changed download after review and a stale response during installation', async () => {
    mocks.app.isPackaged = true
    mocks.capability = { enabled: true, configPath: '/fixture/app-update.yml' }
    const controls = configureAutoUpdate({ isDestroyed: () => false, webContents: { send: vi.fn() } } as never, {
      beforeInstall: async () => { mocks.listeners.get('update-downloaded')?.({ version: '0.96.0' }) },
    }, '0.94.1')
    mocks.listeners.get('update-downloaded')?.({ version: '0.95.0' })
    await expect(controls.install('0.94.2')).rejects.toThrow('changed')
    await expect(controls.install('0.95.0')).rejects.toThrow('changed')
    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('reports visible install stages before handing off to the native updater', async () => {
    mocks.app.isPackaged = true
    mocks.capability = { enabled: true, configPath: '/Applications/OpenAlice.app/app-update.yml' }
    const send = vi.fn()
    const setProgressBar = vi.fn()
    const beforeInstall = vi.fn(async (_version, report) => {
      report('stopping-services')
      report('releasing-runtime')
    })
    const onInstallHandoff = vi.fn(async () => {})
    const controls = configureAutoUpdate({
      isDestroyed: () => false,
      setProgressBar,
      webContents: { send },
    } as never, { beforeInstall, onInstallHandoff }, '0.87.0-beta')

    mocks.listeners.get('update-available')?.({ version: '0.88.0-beta' })
    mocks.listeners.get('download-progress')?.({ percent: 42.4 })
    mocks.listeners.get('update-downloaded')?.({ version: '0.88.0-beta' })
    await expect(controls.install()).resolves.toEqual({ ok: true })

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
    const controls = configureAutoUpdate({
      isDestroyed: () => false,
      setProgressBar: vi.fn(),
      webContents: { send: vi.fn() },
    } as never, {
      beforeInstall: vi.fn(async () => {}),
      onInstallFailure,
    }, '0.87.0-beta')
    mocks.listeners.get('update-downloaded')?.({ version: '0.88.0-beta' })
    mocks.autoUpdater.quitAndInstall.mockImplementationOnce(() => {
      throw new Error('ShipIt refused the update')
    })

    await expect(controls.install()).rejects.toThrow('ShipIt refused the update')
    expect(onInstallFailure).toHaveBeenCalledOnce()
  })
})
