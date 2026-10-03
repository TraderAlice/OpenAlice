import { registerNativeMenuLocale } from './native-menu-locale.js'
/** Development-only entry. Deliberately does not import the production Guardian. */
import { app, ipcMain, Menu, protocol } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ClientUpdateService } from './web-relay.js'
import { runDemoSmoke } from './demo-smoke.js'
import { createAppWindow } from './app-window.js'
import { fetchAliceWebRequest, handleOpenAliceIpcMessage, registerOpenAliceIpc } from './ipc.js'

if (app.isPackaged) throw new Error('Electron demo is a source-development entry only')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const demoRoot = mkdtempSync(join(tmpdir(), 'openalice-demo-'))
const home = join(demoRoot, 'home')
mkdirSync(home)
app.setPath('userData', join(demoRoot, 'electron'))
process.env.OPENALICE_HOME = home
process.env.AQ_LAUNCHER_ROOT = join(home, 'workspaces')
process.env.OPENALICE_GLOBAL_DIR = join(demoRoot, 'global')
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}])
let backend: ChildProcess | null = null
app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => { backend?.kill() })

void app.whenReady().then(async () => {
  // Only paths and basic process locale are handed to the fixture process.
  // It has no broker, agent, remote-project, or credential configuration.
  backend = spawn(process.execPath, [join(root, 'dist/demo/backend.mjs')], {
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      OPENALICE_DEMO_UI: join(root, 'ui/dist-demo'),
      AQ_LAUNCHER_ROOT: process.env.AQ_LAUNCHER_ROOT,
      ...(process.env.TZ ? { TZ: process.env.TZ } : {}),
      ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
    },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'], serialization: 'advanced',
  })
  backend.on('message', handleOpenAliceIpcMessage)
  await new Promise<void>((done, reject) => {
    const timeout = setTimeout(() => reject(new Error('Demo backend readiness timed out')), 15_000)
    backend!.on('message', (message: { type?: string }) => {
      if (message.type === 'demo:ready') { clearTimeout(timeout); done() }
    })
    backend!.once('error', reject)
    backend!.once('exit', code => { clearTimeout(timeout); reject(new Error(`Demo backend exited: ${code}`)) })
  })
  backend.on('exit', () => app.quit())
  const status = {
    currentHome: home, defaultHome: home, source: 'environment' as const,
    recentHomes: [home], askOnStartup: false, selectionLocked: true,
    selectionLock: 'openalice-home-env' as const,
  }
  registerOpenAliceIpc({
    mode: 'electron-dev', userDataHome: home, appHome: root,
    webPort: null, mcpPort: null, utaPort: null, getAliceProcess: () => backend,
    dataHome: {
      getStatus: () => status,
      chooseAndRestart: async () => ({ outcome: 'locked', status }),
      useRecentAndRestart: async () => ({ outcome: 'locked', status }),
      setAskOnStartup: async () => status,
      openCurrent: async () => '',
    },
  })
  // Demo is an attached isolated Project; the shared preload now asks for this status before mounting React.
  ipcMain.handle('openalice:desktop-connection:status', () => ({
    schemaVersion: 1, generation: 0, target: { machine: 'demo', project: 'isolated-demo' }, switching: false,
  }))
  ipcMain.handle('openalice:updater:get-status', () => null)
  const clientUpdates = new ClientUpdateService({
    kind: 'desktop', path: join(app.getPath('userData'), 'client-updates.json'),
    discover: async () => ({ status: 'unsupported', channel: 'demo', message: 'Demo mode' }),
  })
  ipcMain.handle('openalice:client-updates:status', () => clientUpdates.snapshot())
  ipcMain.handle('openalice:client-updates:check', () => clientUpdates.check())
  ipcMain.handle('openalice:client-updates:activate', () => clientUpdates.activate())
  ipcMain.handle('openalice:client-updates:preferences', (_event, input: unknown) => clientUpdates.savePreferences(input))
  app.once('before-quit', () => clientUpdates.stop())
  ipcMain.handle('openalice:updater:open-release', () => { throw new Error('Unavailable in demo mode') })
  protocol.handle('app', request => fetchAliceWebRequest(request, backend))
  Menu.setApplicationMenu(process.platform === 'darwin'
    ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null)
  const { window: win, companion } = createAppWindow(join(root, 'dist/electron/preload.js'), 'OpenAlice — Demo')
  registerNativeMenuLocale(win)
  companion?.configureActivity({ identity: () => 'isolated-demo', read: async query => {
    const response = await fetchAliceWebRequest(new Request(`app://openalice/api/agent-runtime${query}`), backend)
    if (!response.ok) throw new Error('Demo activity unavailable')
    return response.json()
  } })
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) console.error(`[demo renderer] ${message}`)
  })
  await win.loadURL('app://openalice/inbox')
  console.log(`[electron-demo] ready app://openalice/inbox; isolated state: ${demoRoot}`)
  if (process.argv.includes('--demo-smoke')) {
    await runDemoSmoke(win)
    app.quit()
  }
}).catch(error => { console.error(error); app.exit(1) })
