import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import { resolveAutoUpdateCapability } from './auto-update-policy.js'

const { autoUpdater } = electronUpdater

export type UpdaterInstallStage =
  | 'preparing'
  | 'stopping-services'
  | 'releasing-runtime'
  | 'handing-off'

type UpdaterStatus =
  | { phase: 'available'; version?: string; releaseUrl?: string }
  | { phase: 'downloading'; version?: string; percent?: number }
  | { phase: 'downloaded'; version: string; releaseUrl: string }
  | { phase: 'installing'; version: string; stage: UpdaterInstallStage }
  | { phase: 'error'; message: string }

type UpdateCheckResult =
  | { supported: true }
  | { supported: false; reason: 'not-packaged' | 'missing-config' }

export interface AutoUpdateHooks {
  beforeInstall: (
    version: string,
    report: (stage: Exclude<UpdaterInstallStage, 'preparing' | 'handing-off'>) => void,
  ) => Promise<void>
  onInstallHandoff?: (version: string) => Promise<void> | void
  onInstallFailure?: (error: Error) => Promise<void> | void
}

export function configureAutoUpdate(win: BrowserWindow, hooks: AutoUpdateHooks): void {
  let downloadedVersion: string | null = null
  let availableVersion: string | null = null
  let latestStatus: UpdaterStatus | null = null
  let activeCheck: Promise<UpdateCheckResult> | null = null
  let installInProgress = false
  let installFailureHandled = false
  const capability = resolveAutoUpdateCapability({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  })

  const releaseUrlFor = (version: string): string =>
    `https://github.com/TraderAlice/OpenAlice/releases/tag/v${version}`

  const sendStatus = (status: UpdaterStatus) => {
    latestStatus = status
    if (win.isDestroyed()) return
    if (status.phase === 'downloading' && typeof status.percent === 'number') {
      win.setProgressBar?.(Math.max(0, Math.min(1, status.percent / 100)))
    } else if (status.phase === 'installing') {
      win.setProgressBar?.(2)
    } else {
      win.setProgressBar?.(-1)
    }
    win.webContents.send('openalice:updater:status', status)
  }

  const reportInstallFailure = async (error: Error): Promise<void> => {
    if (installFailureHandled) return
    installFailureHandled = true
    sendStatus({ phase: 'error', message: error.message })
    try {
      await hooks.onInstallFailure?.(error)
    } catch (hookError) {
      console.error('[updater] install failure recovery failed:', hookError)
    }
  }

  const checkForUpdates = (): Promise<UpdateCheckResult> => {
    if (!capability.enabled) {
      return Promise.resolve({ supported: false, reason: capability.reason })
    }
    if (activeCheck) return activeCheck
    activeCheck = autoUpdater.checkForUpdates()
      .then(() => ({ supported: true as const }))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        if (latestStatus?.phase !== 'error' || latestStatus.message !== message) {
          sendStatus({ phase: 'error', message })
        }
        return { supported: true as const }
      })
      .finally(() => {
        activeCheck = null
      })
    return activeCheck
  }

  ipcMain.removeHandler('openalice:updater:get-status')
  ipcMain.handle('openalice:updater:get-status', () => latestStatus)

  ipcMain.removeHandler('openalice:updater:check-for-updates')
  ipcMain.handle('openalice:updater:check-for-updates', () => checkForUpdates())

  ipcMain.removeHandler('openalice:updater:install-and-restart')
  ipcMain.handle('openalice:updater:install-and-restart', async () => {
    if (!downloadedVersion) throw new Error('No downloaded update is ready to install.')
    if (installInProgress) return { ok: true }
    installInProgress = true
    installFailureHandled = false
    const version = downloadedVersion
    try {
      sendStatus({ phase: 'installing', version, stage: 'preparing' })
      // Give the renderer one paint before managed services begin shutting
      // down. Without this yield the last visible frame is still the button.
      await new Promise((resolve) => setTimeout(resolve, 150))
      await hooks.beforeInstall(version, (stage) => {
        sendStatus({ phase: 'installing', version, stage })
      })
      sendStatus({ phase: 'installing', version, stage: 'handing-off' })
      await hooks.onInstallHandoff?.(version)
      // Assisted NSIS updates must be silent or they stop on the installer UI
      // after Electron exits. Force-run restarts the updated app on success.
      autoUpdater.quitAndInstall(true, true)
      return { ok: true }
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      await reportInstallFailure(normalized)
      installInProgress = false
      throw normalized
    }
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
    console.error(`[updater] ${installInProgress ? 'install handoff' : 'update check'} failed:`, err)
    const normalized = err instanceof Error ? err : new Error(String(err))
    if (installInProgress) {
      void reportInstallFailure(normalized)
      return
    }
    sendStatus({ phase: 'error', message: normalized.message })
  })

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] update available: ${info.version}`)
    availableVersion = info.version
    sendStatus({ phase: 'available', version: info.version, releaseUrl: releaseUrlFor(info.version) })
  })

  autoUpdater.on('update-not-available', (info) => {
    console.log(`[updater] no update available (latest=${info.version})`)
  })

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[updater] downloading ${progress.percent.toFixed(1)}%`)
    sendStatus({
      phase: 'downloading',
      ...(availableVersion ? { version: availableVersion } : {}),
      percent: progress.percent,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    downloadedVersion = info.version
    availableVersion = info.version
    sendStatus({ phase: 'downloaded', version: info.version, releaseUrl: releaseUrlFor(info.version) })
  })

  // electron-updater emits the same rejection through its `error` event
  // before rethrowing it from this promise. The event handler above owns the
  // diagnostic; consume the promise rejection so one failure is logged once.
  void checkForUpdates()
}

export function channelForVersion(version: string, platform: NodeJS.Platform, arch: string): string {
  const prerelease = version.match(/^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/)
  const channel = prerelease?.[1] ?? 'latest'
  // GenericProvider appends "-mac" to this channel. Intel therefore requests
  // latest-intel-mac.yml / beta-intel-mac.yml, which are compatibility aliases
  // of the public latest-mac-intel.yml / beta-mac-intel.yml feeds.
  return platform === 'darwin' && arch === 'x64' ? `${channel}-intel` : channel
}
