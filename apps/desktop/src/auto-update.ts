import { selectRelease, releaseChannelForVersion, type ReleaseDecision, type ClientReleaseObservation, type NativeUpdaterStatus as UpdaterStatus, type UpdaterInstallStage } from '@traderalice/update-lifecycle'
export type { UpdaterInstallStage } from '@traderalice/update-lifecycle'
import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import { resolveAutoUpdateCapability } from './auto-update-policy.js'

const { autoUpdater } = electronUpdater

type UpdateCheckResult =
  | { supported: true }
  | { supported: false; reason: 'not-packaged' | 'missing-config' }

export interface AutoUpdateHooks {
  beforeInstall: (
    version: string,
    report: (stage: Exclude<UpdaterInstallStage, 'preparing' | 'handing-off'>) => void,
  ) => Promise<void>
  executeInstall?: (version: string, prepare: () => Promise<void>, handoff: () => Promise<void>, parentOperationId?: string) => Promise<void>
  onInstallHandoff?: (version: string) => Promise<void> | void
  onInstallFailure?: (error: Error) => Promise<void> | void
}

export function configureAutoUpdate(win: BrowserWindow, hooks: AutoUpdateHooks, currentVersion: string): { discover(): Promise<ClientReleaseObservation>; install(expectedVersion?: string, parentOperationId?: string): Promise<{ ok: boolean }>; downloaded(): string | null } {
  let downloadedVersion: string | null = null
  let availableVersion: string | null = null
  let checkedRelease: { version: string; decision: ReleaseDecision } | null = null
  let latestStatus: UpdaterStatus | null = null
  let activeCheck: Promise<UpdateCheckResult> | null = null
  let installInProgress = false
  let installFailureHandled = false
  const capability = resolveAutoUpdateCapability({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  })

  const channel = releaseChannelForVersion(currentVersion)
  const select = (version: string): ReleaseDecision => channel
    ? selectRelease({ channel, version: currentVersion }, { channel, version }, channel)
    : { status: 'unknown', reason: 'invalid-identity' }

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
    if (installInProgress) return Promise.resolve({ supported: true })
    if (activeCheck) return activeCheck
    checkedRelease = null
    installFailureHandled = false
    sendStatus({ phase: 'checking' })
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

  const controls = { install: (expectedVersion?: string, parentOperationId?: string) => install(expectedVersion, parentOperationId), downloaded: () => downloadedVersion, discover: async (): Promise<ClientReleaseObservation> => {
    const result = await checkForUpdates()
    const base = { currentVersion, channel: !app.isPackaged ? 'dev' : channel ?? 'custom' }
    if (!result.supported) return { ...base, status: 'unsupported', message: result.reason }
    if (latestStatus?.phase === 'error') throw new Error(latestStatus.message)
    if (!checkedRelease) throw new Error('Native updater returned no release identity')
    return { ...base, ...checkedRelease.decision,
      latestVersion: checkedRelease.version, releaseNotesUrl: releaseUrlFor(checkedRelease.version) }
  } }

  const install = async (expectedVersion?: string, parentOperationId?: string) => {
    if (expectedVersion !== undefined && expectedVersion !== downloadedVersion) throw new Error('The downloaded update changed; review the current release before installing')
    if (!downloadedVersion) throw new Error('No downloaded update is ready to install.')
    if ((latestStatus?.phase === 'error' && !installFailureHandled) || select(downloadedVersion).status !== 'available') throw new Error('The downloaded release is not eligible for installation. Check updates again.')
    if (installInProgress) return { ok: true }
    installInProgress = true
    installFailureHandled = false
    const version = downloadedVersion
    try {
      sendStatus({ phase: 'installing', version, stage: 'preparing' })
      // Give the renderer one paint before managed services begin shutting
      // down. Without this yield the last visible frame is still the button.
      await new Promise((resolve) => setTimeout(resolve, 150))
      const prepare = async () => {
      await hooks.beforeInstall(version, (stage) => {
        sendStatus({ phase: 'installing', version, stage })
      })
      }
      const handoff = async () => {
      if (downloadedVersion !== version || select(version).status !== 'available') throw new Error('The downloaded update changed before handoff; review the current release before installing')
      sendStatus({ phase: 'installing', version, stage: 'handing-off' })
      await hooks.onInstallHandoff?.(version)
      // Assisted NSIS updates must be silent or they stop on the installer UI
      // after Electron exits. Force-run restarts the updated app on success.
      if (downloadedVersion !== version) throw new Error('The approved native payload changed during handoff')
      autoUpdater.quitAndInstall(true, true)
      }
      if (hooks.executeInstall) await hooks.executeInstall(version, prepare, handoff, parentOperationId)
      else { await prepare(); await handoff() }
      return { ok: true }
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      await reportInstallFailure(normalized)
      installInProgress = false
      throw normalized
    }
  }

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
    return controls
  }

  if (!channel) throw new Error('Native updater requires a supported OpenAlice product release identity')
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = channel === 'beta'
  autoUpdater.channel = channelForVersion(currentVersion, process.platform, process.arch)
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

  const acceptRelease = (version: string, nativeAvailable: boolean) => {
    const decision = select(version)
    checkedRelease = { version, decision }
    if (decision.status !== 'available') {
      availableVersion = null
      downloadedVersion = null
      if (decision.status === 'current') sendStatus({ phase: 'current', version: currentVersion })
      else sendStatus({ phase: decision.status, version, reason: decision.reason })
      return
    }
    if (!nativeAvailable) {
      sendStatus({ phase: 'error', message: 'The native updater did not accept the eligible release payload. Check updates again.' })
      return
    }
    availableVersion = version
    sendStatus({ phase: 'available', version, releaseUrl: releaseUrlFor(version) })
    void autoUpdater.downloadUpdate().catch((error: unknown) => {
      sendStatus({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
    })
  }
  autoUpdater.on('update-available', info => acceptRelease(info.version, true))
  autoUpdater.on('update-not-available', info => acceptRelease(info.version, false))

  autoUpdater.on('download-progress', (progress) => {
    if (!availableVersion || select(availableVersion).status !== 'available') return
    console.log(`[updater] downloading ${progress.percent.toFixed(1)}%`)
    sendStatus({
      phase: 'downloading',
      ...(availableVersion ? { version: availableVersion } : {}),
      percent: progress.percent,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    const decision = select(info.version)
    if (decision.status !== 'available') { acceptRelease(info.version, false); return }
    if (checkedRelease && checkedRelease.version !== info.version) {
      downloadedVersion = null
      sendStatus({ phase: 'error', message: 'The downloaded update does not match the checked release. Check updates again.' })
      return
    }
    downloadedVersion = info.version
    availableVersion = info.version
    sendStatus({ phase: 'downloaded', version: info.version, releaseUrl: releaseUrlFor(info.version) })
  })

  // The local lifecycle service owns policy and discovery activation; the
  // native updater remains the download/install effect owner.
  return controls
}

export function channelForVersion(version: string, platform: NodeJS.Platform, arch: string): string {
  const releaseChannel = releaseChannelForVersion(version)
  if (!releaseChannel) throw new Error('Unsupported OpenAlice release channel')
  const channel = releaseChannel === 'stable' ? 'latest' : releaseChannel
  // GenericProvider appends "-mac" to this channel. Intel therefore requests
  // latest-intel-mac.yml / beta-intel-mac.yml, which are compatibility aliases
  // of the public latest-mac-intel.yml / beta-mac-intel.yml feeds.
  return platform === 'darwin' && arch === 'x64' ? `${channel}-intel` : channel
}
