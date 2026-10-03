import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
const ipc = vi.hoisted(() => ({ handle: vi.fn(), removeHandler: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: ipc }))
import { nativeMenuLabels, registerNativeMenuLocale } from './native-menu-locale.js'

beforeEach(() => vi.clearAllMocks())

describe('native menu language projection', () => {
  it('accepts supported locales only from the owning main frame and refreshes once per change', () => {
    const mainFrame = {}
    const webContents = { mainFrame }
    const owner = { webContents, once: vi.fn() }
    const refresh = vi.fn()
    registerNativeMenuLocale(owner as unknown as BrowserWindow, refresh)
    const handler = ipc.handle.mock.calls[0][1]
    const trusted = { sender: webContents, senderFrame: mainFrame }
    expect(nativeMenuLabels().show).toBe('Show OpenAlice')
    handler({ sender: {}, senderFrame: mainFrame }, 'zh')
    handler({ sender: webContents, senderFrame: {} }, 'zh')
    for (const invalid of [null, {}, '__proto__', 'fr']) handler(trusted, invalid)
    expect(refresh).not.toHaveBeenCalled()
    expect(nativeMenuLabels().show).toBe('Show OpenAlice')
    for (const [locale, show, hide] of [
      ['zh', '显示 OpenAlice', '隐藏桌宠'],
      ['zh-Hant', '顯示 OpenAlice', '隱藏桌寵'],
      ['ja', 'OpenAlice を表示', 'ペットを隠す'],
      ['en', 'Show OpenAlice', 'Hide pet'],
    ]) {
      handler(trusted, locale)
      expect(nativeMenuLabels()).toMatchObject({ show, hidePet: hide })
      handler(trusted, locale)
    }
    expect(refresh).toHaveBeenCalledTimes(4)
    handler(trusted, 'ja')
    owner.once.mock.calls[0][1]()
    expect(ipc.removeHandler).toHaveBeenCalledWith('openalice:native-menu:locale')
    expect(nativeMenuLabels().show).toBe('Show OpenAlice')
  })
})
