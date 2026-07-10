import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
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

import { configureAutoUpdate } from './auto-update.js'

describe('configureAutoUpdate', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    vi.clearAllMocks()
    mocks.app.isPackaged = false
  })

  it('keeps updater IPC stable when the updater engine is disabled', async () => {
    configureAutoUpdate({} as never, { beforeInstall: vi.fn(async () => {}) })

    expect([...mocks.handlers.keys()]).toEqual([
      'openalice:updater:get-status',
      'openalice:updater:install-and-restart',
      'openalice:updater:open-release',
    ])
    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled()

    const getStatus = mocks.handlers.get('openalice:updater:get-status')
    const install = mocks.handlers.get('openalice:updater:install-and-restart')
    const openRelease = mocks.handlers.get('openalice:updater:open-release')
    expect(await getStatus?.()).toBeNull()
    await expect(install?.()).rejects.toThrow('No downloaded update is ready to install.')
    await openRelease?.({}, undefined)
    expect(mocks.shell.openExternal)
      .toHaveBeenCalledWith('https://github.com/TraderAlice/OpenAlice/releases')
  })
})
