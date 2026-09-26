import { app, BrowserWindow, ipcMain, Menu, screen } from 'electron'
import { readFileSync } from 'node:fs'
import { writeFile, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { settleCompanion, snapEase, type Rect } from './companion-geometry.js'
import { createCompanionSoundStore, DEFAULT_SOUND, type CompanionSound } from './companion-sound.js'

/** Keep the renderer viewport dimensions stable across native window frames. */
export function resizeCompanionWindow(window: BrowserWindow, width: number, height: number): void {
  if (process.platform === 'win32') window.setContentSize(width, height)
  else window.setSize(width, height)
}

/** Move and size in the same coordinate space used by the renderer. */
export function setCompanionBounds(window: BrowserWindow, bounds: Rect): void {
  if (process.platform === 'win32') window.setContentBounds(bounds)
  else window.setBounds(bounds)
}

function companionBounds(window: BrowserWindow): Rect {
  return process.platform === 'win32' ? window.getContentBounds() : window.getBounds()
}

export interface CompanionHandle {
  readonly window: BrowserWindow
  trayMenuItems(): Electron.MenuItemConstructorOptions[]
}

/**
 * One presentation window belonging to the existing desktop process.
 * Thanks to MeteorNOX's DeepSeek Balance Whale Widget for the interaction model:
 * https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget
 * Press/release, mirroring, bubble timing and snapping follow that MIT project;
 * OpenAlice owns the native lifecycle/IPC adaptation. See companion/NOTICE.md.
 */
export function createCompanion(owner: BrowserWindow): CompanionHandle | undefined {
  if (process.env.OPENALICE_DISABLE_COMPANION === '1') return
  const here = dirname(fileURLToPath(import.meta.url))
  const assets = app.isPackaged
    ? join(process.resourcesPath, 'runtime/ui/dist/companion')
    : resolve(here, '../../ui/public/companion')
  const statePath = join(app.getPath('userData'), 'companion.json')
  let size = 220
  let enabled = true
  let saved: Partial<Rect> = {}
  try {
    const value = JSON.parse(readFileSync(statePath, 'utf8'))
    if ([170, 220, 280].includes(value.size)) size = value.size
    if (typeof value.enabled === 'boolean') enabled = value.enabled
    if (Number.isFinite(value.x) && Number.isFinite(value.y)) saved = { x: value.x, y: value.y }
  } catch { /* First launch or damaged launcher preference: use defaults. */ }
  const area = screen.getDisplayMatching(owner.getBounds()).workArea
  const width = Math.round(size * 2.7)
  const initial = { x: saved.x ?? area.x + area.width - width - 24, y: saved.y ?? area.y + area.height - Math.round(size * 1.65) - 24, width, height: Math.round(size * 1.65) }
  const bounds = settleCompanion(initial, screen.getDisplayMatching(initial).workArea, false)
  const pet = new BrowserWindow({
    x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    title: 'Alice', transparent: true, frame: false, hasShadow: false,
    // Frameless transparent Windows windows reserve a native border outside
    // the requested bounds unless their dimensions are content dimensions.
    // Keep macOS on its existing input-coordinate path.
    useContentSize: process.platform === 'win32',
    resizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, show: false,
    ...(process.platform === 'win32' ? { thickFrame: false, type: 'toolbar' } : {}),
    webPreferences: { preload: join(here, 'companion-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, autoplayPolicy: 'no-user-gesture-required' },
  })
  if (process.platform === 'darwin') pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  pet.setIgnoreMouseEvents(true, { forward: true })
  pet.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  pet.webContents.on('will-navigate', event => event.preventDefault())
  let ready = false
  let flipped = bounds.flipped
  let reducedMotion = false
  let snapTimer: ReturnType<typeof setInterval> | undefined
  const stopSnap = () => { clearInterval(snapTimer); snapTimer = undefined }
  let drag: { start: Electron.Point; bounds: Rect; moved: boolean } | undefined
  const petSize = () => ({ width: Math.round(size * 2.7), height: Math.round(size * 1.65) })
  const inPositionRange = (value: number) =>
    Number.isFinite(value) && Math.round(value) >= -2_147_483_648 && Math.round(value) <= 2_147_483_647
  const moveTo = (x: number, y: number): boolean => {
    if (pet.isDestroyed() || !inPositionRange(x) || !inPositionRange(y)) { stopSnap(); return false }
    try {
      setCompanionBounds(pet, { x: Math.round(x), y: Math.round(y), ...petSize() })
      return true
    } catch (error) {
      console.error('[companion] failed to move pet:', error)
      stopSnap()
      return false
    }
  }
  const updateDrag = () => {
    if (!drag) return
    const cursor = screen.getCursorScreenPoint()
    const dx = cursor.x - drag.start.x, dy = cursor.y - drag.start.y
    if (dx * dx + dy * dy >= 9) drag.moved = true
    if (drag.moved) moveTo(drag.bounds.x + dx, drag.bounds.y + dy)
  }
  let writeQueue = Promise.resolve()
  const save = () => {
    if (pet.isDestroyed()) return
    const { x, y } = companionBounds(pet)
    const payload = JSON.stringify({ x, y, size, enabled })
    writeQueue = writeQueue.then(async () => {
      await writeFile(statePath + '.tmp', payload)
      await rename(statePath + '.tmp', statePath)
    }).catch(error => console.error('[companion] preference save failed:', error.message))
  }
  const settle = (snap = true) => {
    stopSnap()
    if (pet.isDestroyed()) return
    const current = companionBounds(pet)
    const next = settleCompanion(current, screen.getDisplayMatching(current).workArea, snap)
    flipped = next.flipped
    pet.webContents.send('openalice:companion:flip', flipped)
    if (!snap || reducedMotion) { if (moveTo(next.x, next.y)) save(); return }
    const start = performance.now()
    snapTimer = setInterval(() => {
      const progress = Math.min(1, (performance.now() - start) / 160)
      const ease = snapEase(progress)
      if (!moveTo(current.x + (next.x - current.x) * ease, current.y + (next.y - current.y) * ease)) return
      if (progress === 1) { stopSnap(); if (moveTo(next.x, next.y)) save() }
    }, 16)
  }
  const open = () => { if (!owner.isDestroyed()) { if (owner.isMinimized()) owner.restore(); owner.show(); owner.focus() } }
  const toggle = () => {
    if (pet.isDestroyed()) return
    enabled = !enabled
    if (enabled && ready) { settle(false); pet.showInactive() } else pet.hide()
    save()
    if (!owner.isDestroyed()) owner.webContents.send('openalice:companion:visibility', enabled)
  }
  const ownerTrusted = (event: Electron.IpcMainInvokeEvent) =>
    event.sender === owner.webContents && event.senderFrame === owner.webContents.mainFrame
  const visibilityChannel = 'openalice:companion:get-visible'
  const toggleChannel = 'openalice:companion:toggle'
  const defaultSound: CompanionSound = {
    ...DEFAULT_SOUND,
    source: {
      name: 'OpenAlice default (Soft double).wav',
      dataUrl: `data:audio/wav;base64,${readFileSync(join(assets, 'click.wav')).toString('base64')}`,
    },
  }
  const sound = createCompanionSoundStore(join(app.getPath('userData'), 'companion-sound.json'), defaultSound)
  const soundGet = 'openalice:companion:sound:get'
  const soundUpdate = 'openalice:companion:sound:update'
  const soundReset = 'openalice:companion:sound:reset'
  const publishSound = (settings: CompanionSound) => {
    for (const window of [owner, pet]) {
      if (!window.isDestroyed()) window.webContents.send('openalice:companion:sound:changed', settings)
    }
  }
  ipcMain.handle(soundGet, event => {
    const petTrusted = event.sender === pet.webContents && event.senderFrame === pet.webContents.mainFrame
    if (!ownerTrusted(event) && !petTrusted) throw new Error('Unauthorized companion access')
    return sound.get()
  })
  ipcMain.handle(soundUpdate, async (event, input: unknown) => {
    if (!ownerTrusted(event)) throw new Error('Unauthorized companion access')
    const settings = await sound.update(input)
    publishSound(settings)
    return settings
  })
  ipcMain.handle(soundReset, async event => {
    if (!ownerTrusted(event)) throw new Error('Unauthorized companion access')
    const settings = await sound.reset()
    publishSound(settings)
    return settings
  })
  ipcMain.handle(visibilityChannel, event => {
    if (!ownerTrusted(event)) throw new Error('Unauthorized companion access')
    return enabled
  })
  ipcMain.handle(toggleChannel, event => {
    if (!ownerTrusted(event)) throw new Error('Unauthorized companion access')
    toggle()
    return enabled
  })
  pet.once('closed', () => {
    ipcMain.removeHandler(visibilityChannel)
    ipcMain.removeHandler(toggleChannel)
    ipcMain.removeHandler(soundGet)
    ipcMain.removeHandler(soundUpdate)
    ipcMain.removeHandler(soundReset)
  })
  const trayMenuItems = (): Electron.MenuItemConstructorOptions[] => [
    { label: enabled ? 'Hide pet' : 'Show pet', click: toggle },
    { label: 'Size', submenu: [170, 220, 280].map(value => ({
      label: value === 170 ? 'Small' : value === 220 ? 'Medium' : 'Large', type: 'radio' as const, checked: size === value,
      click: () => {
        if (pet.isDestroyed()) return
        const old = companionBounds(pet); size = value
        const { width, height } = petSize()
        setCompanionBounds(pet, { x: Math.round(old.x + (old.width - width) / 2), y: old.y + old.height - height, width, height })
        settle(false); save()
      },
    })) },
  ]
  const menu = () => Menu.buildFromTemplate([
    { label: 'Show OpenAlice', click: open },
    ...trayMenuItems(),
    { type: 'separator' },
    { label: 'Quit OpenAlice', click: () => app.quit() },
  ])
  const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => event.sender === pet.webContents && event.senderFrame === pet.webContents.mainFrame
  const listen = (action: string, callback: (input: unknown) => void) => {
    const channel = 'openalice:companion:' + action
    const handler = (event: Electron.IpcMainEvent, input: unknown) => { if (trusted(event)) callback(input) }
    ipcMain.on(channel, handler)
    pet.once('closed', () => ipcMain.removeListener(channel, handler))
  }
  listen('ready', () => { ready = true; pet.webContents.send('openalice:companion:flip', flipped); if (enabled) pet.showInactive() })
  listen('reduced-motion', value => { if (typeof value === 'boolean') reducedMotion = value })
  listen('interactive', value => { if (typeof value === 'boolean') pet.setIgnoreMouseEvents(drag ? false : !value, { forward: true }) })
  listen('begin-drag', () => { stopSnap(); drag = { start: screen.getCursorScreenPoint(), bounds: companionBounds(pet), moved: false }; pet.setIgnoreMouseEvents(false) })
  listen('move-drag', updateDrag)
  listen('menu', () => menu().popup({ window: pet }))
  listen('open', open)
  const endChannel = 'openalice:companion:end-drag'
  ipcMain.handle(endChannel, (event, cancelled) => {
    if (!trusted(event)) return false
    updateDrag()
    const moved = drag?.moved ?? false
    if (drag && cancelled === true && !pet.isDestroyed()) setCompanionBounds(pet, drag.bounds)
    drag = undefined
    if (moved && cancelled !== true) settle()
    return moved
  })
  // Cursor polling recovers hover after native click-through and crosses monitors.
  let lastCursor = ''
  const tick = setInterval(() => {
    if (pet.isDestroyed() || !ready || !pet.isVisible()) return
    const cursor = screen.getCursorScreenPoint()
    updateDrag()
    const box = companionBounds(pet)
    const point = { x: cursor.x - box.x, y: cursor.y - box.y }
    const key = `${point.x},${point.y}`
    if (key !== lastCursor) { lastCursor = key; pet.webContents.send('openalice:companion:cursor', point) }
  }, 50)
  const displayChanged = () => { if (!pet.isDestroyed()) { settle(false); save() } }
  screen.on('display-removed', displayChanged)
  screen.on('display-metrics-changed', displayChanged)
  owner.once('closed', () => { if (!pet.isDestroyed()) pet.destroy() })
  pet.once('closed', () => {
    clearInterval(tick); stopSnap(); ipcMain.removeHandler(endChannel)
    screen.removeListener('display-removed', displayChanged)
    screen.removeListener('display-metrics-changed', displayChanged)
  })
  void pet.loadFile(join(assets, 'index.html')).catch(error => {
    console.error('[companion] load failed:', error.message)
    if (!pet.isDestroyed()) pet.destroy()
  })
  return { window: pet, trayMenuItems }
}
