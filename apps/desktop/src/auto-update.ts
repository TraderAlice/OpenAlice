import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import { resolveAutoUpdateCapability } from './auto-update-policy.js'

const { autoUpdater } = electronUpdater

type UpdaterStatus = {
  phase: 'available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  releaseUrl?: string
  message?: string
}

export interface AutoUpdateHooks {
  beforeInstall: () => Promise<void>
}

export function configureAutoUpdate(win: BrowserWindow, hooks: AutoUpdateHooks): void {
  let downloadedVersion: string | null = null
  let latestStatus: UpdaterStatus | null = null

  const releaseUrlFor = (version: string): string =>
    `https://github.com/TraderAlice/OpenAlice/releases/tag/v${version}`

  const sendStatus = (status: UpdaterStatus) => {
    latestStatus = status
    if (win.isDestroyed()) return
    win.webContents.send('openalice:updater:status', status)
  }

  ipcMain.removeHandler('openalice:updater:get-status')
  ipcMain.handle('openalice:updater:get-status', () => latestStatus)

  ipcMain.removeHandler('openalice:updater:install-and-restart')
  ipcMain.handle('openalice:updater:install-and-restart', async () => {
    if (!downloadedVersion) throw new Error('No downloaded update is ready to install.')
    await hooks.beforeInstall()
    autoUpdater.quitAndInstall(false, true)
    return { ok: true }
  })

  ipcMain.removeHandler('openalice:updater:open-release')
  ipcMain.handle('openalice:updater:open-release', async (_event, version: unknown) => {
    const target = typeof version === 'string' && version.length > 0 ? version : downloadedVersion
    if (!target) {
      await shell.openExternal('https://github.com/TraderAlice/OpenAlice/releases')
      return { ok: true }
    }
    await shell.openExternal(releaseUrlFor(target))
    return { ok: true }
  })

  // Keep the renderer IPC contract stable in dev and non-updatable directory
  // packages. Only the updater engine itself depends on packaged metadata.
  const capability = resolveAutoUpdateCapability({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  })
  if (!capability.enabled) {
    if (capability.reason === 'missing-config') {
      console.info(`[updater] disabled: update metadata not found at ${capability.configPath}`)
    }
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = app.getVersion().includes('-')
  autoUpdater.channel = channelForVersion(app.getVersion(), process.platform, process.arch)
  autoUpdater.allowDowngrade = false

  autoUpdater.on('error', (err) => {
    console.error('[updater] update check failed:', err)
  })

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] update available: ${info.version}`)
    sendStatus({ phase: 'available', version: info.version, releaseUrl: releaseUrlFor(info.version) })
  })

  autoUpdater.on('update-not-available', (info) => {
    console.log(`[updater] no update available (latest=${info.version})`)
  })

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[updater] downloading ${progress.percent.toFixed(1)}%`)
    sendStatus({ phase: 'downloading', percent: progress.percent })
  })

  autoUpdater.on('update-downloaded', (info) => {
    downloadedVersion = info.version
    sendStatus({ phase: 'downloaded', version: info.version, releaseUrl: releaseUrlFor(info.version) })
  })

  // electron-updater emits the same rejection through its `error` event
  // before rethrowing it from this promise. The event handler above owns the
  // diagnostic; consume the promise rejection so one failure is logged once.
  void autoUpdater.checkForUpdates().catch(() => {})
}

export function channelForVersion(version: string, platform: NodeJS.Platform, arch: string): string {
  const prerelease = version.match(/^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/)
  const channel = prerelease?.[1] ?? 'latest'
  // GenericProvider appends "-mac" to this channel. Intel therefore requests
  // latest-intel-mac.yml / beta-intel-mac.yml, which are compatibility aliases
  // of the public latest-mac-intel.yml / beta-mac-intel.yml feeds.
  return platform === 'darwin' && arch === 'x64' ? `${channel}-intel` : channel
}
