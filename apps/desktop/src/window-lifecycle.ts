import type { App, BrowserWindow } from 'electron'

/** Restore the same window from the tray or the macOS Dock. */
export function showAppWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** Closing the window keeps the desktop runtime alive; explicit quit owns shutdown. */
export function configureWindowLifecycle(app: App, win: BrowserWindow, isQuitting: () => boolean): void {
  win.on('close', event => {
    if (isQuitting()) return
    event.preventDefault()
    win.hide()
  })

  const activate = () => {
    if (!isQuitting()) showAppWindow(win)
  }
  app.on('activate', activate)
  win.once('closed', () => app.removeListener('activate', activate))
}
