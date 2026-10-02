import { ipcMain, type BrowserWindow } from 'electron'

// Native-only copy. The renderer locale store remains the preference owner;
// this process-local projection is republished at boot and on every change.
const labels = {
  en: { show: 'Show OpenAlice', pet: 'Pet', quit: 'Quit', quitApp: 'Quit OpenAlice', hidePet: 'Hide pet', showPet: 'Show pet', size: 'Size', small: 'Small', medium: 'Medium', large: 'Large' },
  zh: { show: '显示 OpenAlice', pet: '桌宠', quit: '退出', quitApp: '退出 OpenAlice', hidePet: '隐藏桌宠', showPet: '显示桌宠', size: '大小', small: '小', medium: '中', large: '大' },
  'zh-Hant': { show: '顯示 OpenAlice', pet: '桌寵', quit: '結束', quitApp: '結束 OpenAlice', hidePet: '隱藏桌寵', showPet: '顯示桌寵', size: '大小', small: '小', medium: '中', large: '大' },
  ja: { show: 'OpenAlice を表示', pet: 'ペット', quit: '終了', quitApp: 'OpenAlice を終了', hidePet: 'ペットを隠す', showPet: 'ペットを表示', size: 'サイズ', small: '小', medium: '中', large: '大' },
}
let locale: keyof typeof labels = 'en'

export function nativeMenuLabels(): typeof labels.en { return labels[locale] }

export function registerNativeMenuLocale(owner: BrowserWindow, refresh: () => void = () => {}): void {
  locale = 'en'
  const channel = 'openalice:native-menu:locale'
  ipcMain.handle(channel, (event, input: unknown) => {
    if (event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame) return
    if (input !== 'en' && input !== 'zh' && input !== 'zh-Hant' && input !== 'ja') return
    if (locale === input) return
    locale = input
    refresh()
  })
  owner.once('closed', () => { ipcMain.removeHandler(channel); locale = 'en' })
}
