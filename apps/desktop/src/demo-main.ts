/** Development-only entry. Deliberately does not import the production Guardian. */
import { app, ipcMain, Menu, protocol } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  ipcMain.handle('openalice:updater:get-status', () => null)
  ipcMain.handle('openalice:updater:check-for-updates', () => ({ supported: false, reason: 'not-packaged' }))
  for (const action of ['install-and-restart', 'open-release']) {
    ipcMain.handle(`openalice:updater:${action}`, () => { throw new Error('Unavailable in demo mode') })
  }
  protocol.handle('app', request => fetchAliceWebRequest(request, backend))
  Menu.setApplicationMenu(process.platform === 'darwin'
    ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null)
  const win = createAppWindow(join(root, 'dist/electron/preload.js'), 'OpenAlice — Demo')
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
