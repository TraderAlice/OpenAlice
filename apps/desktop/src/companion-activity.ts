import { app, ipcMain, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { createActivityPreferenceStore } from './activity-preferences.js'
import { ActivityController, type ActivitySource } from './activity-controller.js'

export function installCompanionActivity(owner: BrowserWindow, pet: BrowserWindow) {
  const store = createActivityPreferenceStore(join(app.getPath('userData'), 'activity-notifications.json'))
  let source: ActivitySource | undefined
  const foreground = () => !owner.isDestroyed() && owner.isVisible() && !owner.isMinimized()
  const controller = new ActivityController({ identity: () => source?.identity() ?? null, read: (query, signal) => {
    if (!source) throw new Error('No activity source')
    return source.read(query, signal)
  } }, {
    signals: signals => { if (!owner.isDestroyed()) owner.webContents.send('openalice:activity:signals', signals) },
    foreground, petVisible: () => !pet.isDestroyed() && pet.isVisible(),
    send: (surface, event) => {
      const window = surface === 'main' ? owner : pet
      if (!window.isDestroyed()) window.webContents.send('openalice:activity:display', event)
    },
    open: context => {
      if (owner.isDestroyed()) return
      if (owner.isMinimized()) owner.restore()
      owner.show(); owner.focus()
      owner.webContents.send('openalice:activity:open', context)
    },
  }, store.get())
  const trusted = (event: Electron.IpcMainInvokeEvent, window: BrowserWindow) =>
    !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
  const handlers: string[] = []
  const handle = (name: string, callback: (event: Electron.IpcMainInvokeEvent, input: unknown) => unknown) => {
    const channel = 'openalice:activity:' + name; handlers.push(channel); ipcMain.handle(channel, callback)
  }
  handle('preferences', event => { if (!trusted(event, owner)) throw new Error('Unauthorized activity access'); return store.get() })
  const publish = (settings: ReturnType<typeof store.get>) => {
    controller.setPreferences(settings)
    if (!owner.isDestroyed()) owner.webContents.send('openalice:activity:preferences-changed', settings)
    return settings
  }
  handle('update-preferences', async (event, input) => { if (!trusted(event, owner)) throw new Error('Unauthorized activity access'); return publish(await store.update(input)) })
  handle('reset-preferences', async event => { if (!trusted(event, owner)) throw new Error('Unauthorized activity access'); return publish(await store.reset()) })
  handle('signals', event => { if (!trusted(event, owner)) throw new Error('Unauthorized activity access'); return controller.signalSnapshot() })
  handle('snapshot', event => { if (!trusted(event, owner)) throw new Error('Unauthorized activity access'); return controller.snapshot() })
  for (const action of ['open', 'dismiss'] as const) handle(action, (event, input) => {
    const surface = trusted(event, owner) ? 'main' : trusted(event, pet) ? 'pet' : null
    if (!surface) throw new Error('Unauthorized activity access')
    return controller[action](input, surface)
  })
  const transition = () => controller.transition()
  owner.on('show', transition); owner.on('hide', transition); owner.on('minimize', transition); owner.on('restore', transition)
  pet.on('hide', transition)
  // Native main timer continues while the main renderer is minimized/throttled.
  const timer = setInterval(() => { void controller.poll() }, 4_000)
  owner.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) transition() })
  pet.once('closed', () => {
    clearInterval(timer); controller.stop()
    for (const channel of handlers) ipcMain.removeHandler(channel)
    owner.removeListener('show', transition); owner.removeListener('hide', transition); owner.removeListener('minimize', transition); owner.removeListener('restore', transition)
  })
  return { configure(value: ActivitySource) { source = value; void controller.poll() } }
}
