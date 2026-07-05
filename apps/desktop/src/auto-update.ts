import { app, dialog, shell, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

export interface AutoUpdateHooks {
  beforeInstall: () => Promise<void>
}

export function configureAutoUpdate(win: BrowserWindow, hooks: AutoUpdateHooks): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = app.getVersion().includes('-')
  autoUpdater.channel = channelForVersion(app.getVersion())
  autoUpdater.allowDowngrade = false

  autoUpdater.on('error', (err) => {
    console.error('[updater] update check failed:', err)
  })

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] update available: ${info.version}`)
  })

  autoUpdater.on('update-not-available', (info) => {
    console.log(`[updater] no update available (latest=${info.version})`)
  })

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[updater] downloading ${progress.percent.toFixed(1)}%`)
  })

  autoUpdater.on('update-downloaded', (info) => {
    void dialog
      .showMessageBox(win, {
        type: 'info',
        title: 'OpenAlice — update ready',
        message: `OpenAlice ${info.version} is ready to install.`,
        detail: 'Restart OpenAlice to install the update. Running UTA and Alice child processes will be stopped gracefully first.',
        buttons: ['Restart now', 'Later', 'View release'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(async ({ response }) => {
        if (response === 2) {
          const releaseUrl = `https://github.com/TraderAlice/OpenAlice/releases/tag/v${info.version}`
          void shell.openExternal(releaseUrl)
          return
        }
        if (response !== 0) return
        try {
          await hooks.beforeInstall()
          autoUpdater.quitAndInstall(false, true)
        } catch (err) {
          console.error('[updater] failed to prepare update install:', err)
          await dialog.showMessageBox(win, {
            type: 'error',
            title: 'OpenAlice — update install failed',
            message: 'OpenAlice could not prepare for the update.',
            detail: err instanceof Error ? err.message : String(err),
          })
        }
      })
  })

  void autoUpdater.checkForUpdates().catch((err) => {
    console.error('[updater] checkForUpdates threw:', err)
  })
}

function channelForVersion(version: string): string {
  const prerelease = version.match(/^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/)
  return prerelease?.[1] ?? 'latest'
}
