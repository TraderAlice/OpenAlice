import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { BrowserWindow } from 'electron'

const electron = vi.hoisted(() => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() }, nativeTheme: { shouldUseDarkColors: false } }))
vi.mock('electron', () => electron)
import { configureWindowChrome, windowChromeOptions } from './window-chrome.js'

beforeEach(() => { vi.clearAllMocks(); electron.nativeTheme.shouldUseDarkColors = false })

describe('native window chrome', () => {
  it('retains platform-native controls without making a frameless window', () => {
    expect(windowChromeOptions('win32')).toMatchObject({ titleBarStyle: 'hidden', titleBarOverlay: { height: 44, color: '#faf9f6' } })
    expect(windowChromeOptions('win32')).not.toHaveProperty('frame')
    expect(windowChromeOptions('darwin')).toEqual({ titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 15 } })
    expect(windowChromeOptions('linux')).toEqual({})
    electron.nativeTheme.shouldUseDarkColors = true
    expect(windowChromeOptions('win32')).toMatchObject({ titleBarOverlay: { color: '#181818' } })
  })
  it('accepts only color updates from this window\'s application main frame and cleans up', () => {
    const mainFrame = { url: 'app://openalice/quick-start' }
    const webContents = { mainFrame }
    const win = { webContents, setTitleBarOverlay: vi.fn(), isDestroyed: () => false, once: vi.fn() }
    configureWindowChrome(win as unknown as BrowserWindow, 'win32')
    const handler = electron.ipcMain.handle.mock.calls[0][1]
    const theme = { color: '#faf9f6', symbolColor: '#252629' }
    handler({ sender: {}, senderFrame: mainFrame }, theme)
    handler({ sender: webContents, senderFrame: {} }, theme)
    handler({ sender: webContents, senderFrame: mainFrame }, { color: 'url(bad)', symbolColor: '#252629' })
    expect(win.setTitleBarOverlay).not.toHaveBeenCalled()
    handler({ sender: webContents, senderFrame: mainFrame }, theme)
    expect(win.setTitleBarOverlay).toHaveBeenCalledWith({ ...theme, height: 44 })
    mainFrame.url = 'https://example.com/'
    handler({ sender: webContents, senderFrame: mainFrame }, theme)
    expect(win.setTitleBarOverlay).toHaveBeenCalledTimes(1)
    win.once.mock.calls[0][1]()
    expect(electron.ipcMain.removeHandler).toHaveBeenCalledWith('openalice:window-chrome:theme')
  })
  it('does not register Windows IPC on other platforms', () => {
    configureWindowChrome({} as BrowserWindow, 'darwin')
    expect(electron.ipcMain.handle).not.toHaveBeenCalled()
  })
})
