import { BrowserWindow } from 'electron'
import { configureWindowChrome, windowChromeOptions } from './window-chrome.js'
import { createCompanion, type CompanionHandle } from './companion.js'

/** Companion plus the window it creates, or `undefined` when disabled. */
export interface AppWindow {
  readonly window: BrowserWindow
  readonly companion?: CompanionHandle
}

/** Keep dev/demo and installed desktop renderer isolation and chrome identical. */
export function createAppWindow(preload: string, title = 'OpenAlice'): AppWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title,
    ...windowChromeOptions(),
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false },
  })
  configureWindowChrome(win)
  let companion: CompanionHandle | undefined
  try { companion = createCompanion(win) } catch (error) { console.error('[companion] startup failed:', error) }
  return { window: win, companion }
}
