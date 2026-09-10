import { ipcMain, nativeTheme, type BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'

export function windowChromeOptions(platform = process.platform): BrowserWindowConstructorOptions {
  if (platform === 'darwin') return { titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 15 } }
  if (platform !== 'win32') return {}
  return {
    minWidth: 400,
    minHeight: 320,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      height: 44,
      color: nativeTheme.shouldUseDarkColors ? '#181818' : '#faf9f6',
      symbolColor: nativeTheme.shouldUseDarkColors ? '#eeeeee' : '#252629',
    },
  }
}

/** Color-only bridge: window operations and caption hit testing stay native. */
export function configureWindowChrome(win: BrowserWindow, platform = process.platform): void {
  if (platform !== 'win32') return
  const channel = 'openalice:window-chrome:theme'
  ipcMain.handle(channel, (event, input: unknown) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return
    if (!event.senderFrame?.url.startsWith('app://openalice/')) return
    if (!input || typeof input !== 'object') return
    const { color, symbolColor } = input as Record<string, unknown>
    const hex = /^#[0-9a-f]{6}$/i
    if (typeof color !== 'string' || !hex.test(color) || typeof symbolColor !== 'string' || !hex.test(symbolColor)) return
    if (!win.isDestroyed()) win.setTitleBarOverlay({ color, symbolColor, height: 44 })
  })
  win.once('closed', () => ipcMain.removeHandler(channel))
}
