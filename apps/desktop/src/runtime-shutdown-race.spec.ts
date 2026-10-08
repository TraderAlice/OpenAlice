import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  listeners: new Map<string, (...args: any[]) => void>(),
  handlers: new Map<string, (...args: any[]) => any>(),
  spawn: vi.fn(),
  children: new Map<number, { kill(signal: NodeJS.Signals): boolean }>(),
  acquire: vi.fn(),
  release: vi.fn(async () => {}),
  exit: vi.fn(),
  bootstrap: null as Promise<void> | null,
  flagWaiting: null as (() => void) | null,
  nextFlag: null as ((event: { value: { filename: string }; done: false }) => void) | null,
  activeOwner: false,
  url: 'app://openalice/',
  relay: {
    originUrl: 'http://127.0.0.1:47400',
    status: { target: { machine: 'remote', project: 'demo' }, generation: 1, switching: false },
    listen: vi.fn(async () => {}),
    connect: vi.fn(async (_machine: string, _project: string, options: { present?: () => Promise<void> }) => { await options.present?.() }),
    disconnect: vi.fn(),
    close: vi.fn(async () => {}),
  },
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    whenReady: () => ({ then: (start: () => Promise<void>) => {
      harness.bootstrap = Promise.resolve().then(start)
      return harness.bootstrap
    } }),
    on: (name: string, listener: (...args: any[]) => void) => { harness.listeners.set(name, listener) },
    getPath: (name: string) => '/test/' + name,
    commandLine: { removeSwitch: vi.fn() },
    exit: vi.fn(), quit: vi.fn(),
  },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  ipcMain: {
    handle: (name: string, handler: (...args: any[]) => any) => { harness.handlers.set(name, handler) },
    removeHandler: (name: string) => { harness.handlers.delete(name) },
  },
  dialog: { showErrorBox: vi.fn() },
  session: { defaultSession: { resolveProxy: vi.fn(async () => 'DIRECT') } },
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn(() => ({})) },
  nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
  Tray: class { on() {} setToolTip() {} },
  shell: { openExternal: vi.fn() },
  Notification: { isSupported: () => false },
  BrowserWindow: class {},
}))

vi.mock('node:child_process', () => ({
  spawn: harness.spawn,
  spawnSync: vi.fn((_command: string, args: string[]) => {
    harness.children.get(Number(args[1]))?.kill('SIGTERM') // Windows taskkill /T /F terminates the selected tree.
  }),
}))
vi.mock('node:fs', () => ({ existsSync: () => true }))
vi.mock('node:fs/promises', () => ({
  readFile: async (path: string) => {
    if (path.endsWith('connector-service.json')) return '{"enabled":true}'
    throw new Error('ENOENT')
  },
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  watch: () => ({
    [Symbol.asyncIterator]() { return this },
    next: () => new Promise((resolve) => { harness.nextFlag = resolve; harness.flagWaiting?.() }),
  }),
}))
vi.mock('@traderalice/guardian-runtime', () => ({
  acquireGuardianRuntime: harness.acquire,
  currentProcessStartedAt: () => 1,
  resolveGuardianTradingMode: vi.fn(async () => ({ mode: 'full', source: 'test', envLocked: false })),
  takeoverRequested: () => false,
  proxyEnvFromRules: () => ({}),
  requestAliceShutdown: (child: { kill(signal: NodeJS.Signals): boolean }) => { child.kill('SIGTERM') },
  resolveAliceProjectIdentity: () => ({ id: 'test', key: 'test', displayName: 'Test' }),
}))
vi.mock('./credential-pi-smoke.js', () => ({ runRendererCredentialPiSmoke: vi.fn() }))
vi.mock('./trading-mode-smoke.js', () => ({ runRendererTradingModeSmoke: vi.fn() }))
vi.mock('./data-home-smoke.js', () => ({ runRendererDataHomeSmoke: vi.fn() }))
vi.mock('./workspace-acceptance-smoke.js', () => ({ runRendererWorkspaceAcceptanceSmoke: vi.fn() }))
vi.mock('./probe-port.js', () => ({ probeFreePort: async (port: number) => port }))
vi.mock('./relocate-data.js', () => ({ relocateLegacyData: vi.fn() }))
vi.mock('./auto-update.js', () => ({ configureAutoUpdate: () => ({ downloaded: () => null, install: vi.fn(), discover: vi.fn() }) }))
vi.mock('./desktop-diagnostics.js', () => ({
  BoundedTextTail: class { append() {} text() { return '' } },
  conciseDiagnosticTail: () => '',
  DesktopDiagnostics: class { path = '/test/desktop.log'; write() {} },
}))
vi.mock('./ipc.js', () => ({
  registerOpenAliceIpc: vi.fn(),
  cancelOpenAliceWebRequests: vi.fn(),
  fetchAliceWebRequest: vi.fn(async () => new Response('{}', { status: 200 })),
  handleOpenAliceIpcMessage: vi.fn(() => true),
}))
vi.mock('./managed-runtime.js', () => ({ resolveManagedRuntimeEnv: () => ({}) }))
vi.mock('./data-home.js', () => ({ defaultDataHomePreferences: () => ({}) }))
vi.mock('./data-home-desktop.js', () => ({
  resolveDesktopDataHome: async () => ({ home: '/test/home', source: 'explicit', preferences: {}, selectedDefault: false, selectionLock: null }),
  createDesktopDataHomeController: () => ({}),
  dataHomeErrorDetail: String,
}))
vi.mock('./existing-owner-startup.js', () => ({
  existingOwnerSmokeMode: () => false,
  resolveExistingOwnerStartup: async () => ({ action: 'continue', takeover: false }),
}))
vi.mock('./update-lifecycle.js', () => ({ DesktopUpdateLifecycle: class {} }))
vi.mock('./update-attempt.js', () => ({ inspectPreviousUpdateAttempt: async () => ({ kind: 'none' }), recordUpdateAttempt: vi.fn() }))
vi.mock('./app-exit.js', () => ({ exitDesktopProcess: harness.exit }))
vi.mock('./app-window.js', () => ({ createAppWindow: () => ({
  window: {
    on: vi.fn(), once: vi.fn(), isDestroyed: () => false,
    loadURL: async (url: string) => { harness.url = url },
    webContents: {
      id: 7, on: vi.fn(), isDestroyed: () => false,
      getURL: () => harness.url, setWindowOpenHandler: vi.fn(),
    },
  },
  companion: null,
}) }))
vi.mock('./window-lifecycle.js', () => ({ configureWindowLifecycle: vi.fn(), showAppWindow: vi.fn() }))
vi.mock('./web-relay.js', () => ({
  CLI_VERSION: '0.95.0',
  WebRelay: class { constructor() { return harness.relay } },
  UpdateControlService: class { status() { return Promise.resolve(null) } },
  ClientUpdateService: class { stop() {} },
  readStartupTarget: vi.fn(async () => null),
  writeStartupTarget: vi.fn(async () => {}),
  resolveLocalStartupHome: vi.fn(async () => '/test/home'),
  inspectLocalMachine: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

class ManagedChild extends EventEmitter {
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  pid: number
  connected = true
  stderr = new EventEmitter()
  hold = false
  signalReceived = deferred<void>()

  constructor(pid: number) { super(); this.pid = pid }
  kill(signal: NodeJS.Signals) {
    this.signalReceived.resolve()
    if (!this.hold) queueMicrotask(() => this.finish(signal))
    return true
  }
  finish(signal: NodeJS.Signals = 'SIGTERM') {
    if (this.signalCode) return
    this.signalCode = signal
    this.emit('exit', null, signal)
  }
}

const originalProfile = process.env.OPENALICE_RUNTIME_PROFILE
const originalExitCode = process.exitCode
const originalHome = process.env.OPENALICE_HOME
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  process.env.OPENALICE_HOME = '/test/home'
  harness.listeners.clear()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
  harness.handlers.clear()
  harness.bootstrap = null
  harness.nextFlag = null
  harness.flagWaiting = null
  harness.activeOwner = false
  harness.children.clear()
  harness.url = 'app://openalice/'
  harness.acquire.mockImplementation(async () => {
    harness.activeOwner = true
    return { release: async () => { harness.activeOwner = false; await harness.release() } }
  })
  harness.spawn.mockImplementation(() => {
    const child = new ManagedChild(100 + harness.spawn.mock.calls.length)
    harness.children.set(child.pid, child)
    return child as unknown as ChildProcess
  })
})
afterEach(() => {
  if (originalHome === undefined) delete process.env.OPENALICE_HOME
  else process.env.OPENALICE_HOME = originalHome
  vi.unstubAllGlobals()
  if (originalProfile === undefined) delete process.env.OPENALICE_RUNTIME_PROFILE
  else process.env.OPENALICE_RUNTIME_PROFILE = originalProfile
  process.exitCode = originalExitCode
})

async function startDesktop() {
  await import('./main.js')
  expect(harness.listeners.has('before-quit')).toBe(true)
  expect(harness.bootstrap).not.toBeNull()
}
function quitDesktop() {
  const event = { preventDefault: vi.fn() }
  harness.listeners.get('before-quit')!(event)
  expect(event.preventDefault).toHaveBeenCalledOnce()
}

// The real main module owns all continuations. The doubles end at Electron, disk, ownership, and OS spawn.
describe('desktop shutdown races', () => {
  it('releases ownership acquired after quit and does not spawn UTA, Connector, or Alice', async () => {
    const entered = deferred<void>()
    const acquired = deferred<{ release: () => Promise<void> }>()
    harness.acquire.mockImplementationOnce(() => { entered.resolve(); return acquired.promise })
    await startDesktop()
    await entered.promise
    quitDesktop()
    acquired.resolve({ release: async () => { harness.activeOwner = false; await harness.release() } })
    harness.activeOwner = true
    await harness.bootstrap

    expect(harness.spawn).not.toHaveBeenCalled()
    expect(harness.activeOwner).toBe(false)
    expect(harness.release).toHaveBeenCalledOnce()
  })

  it.each(['restart-uta.flag', 'restart-connector.flag'])('does not respawn %s after an in-flight reconcile stops during quit', async (flag: string) => {
    const watching = deferred<void>()
    harness.flagWaiting = watching.resolve
    await startDesktop()
    await harness.bootstrap
    expect(harness.spawn).toHaveBeenCalledTimes(3)
    const child = harness.spawn.mock.results[flag === 'restart-uta.flag' ? 0 : 1]!.value as ManagedChild
    child.hold = true
    await watching.promise
    harness.nextFlag!({ value: { filename: flag }, done: false })
    await child.signalReceived.promise // the real reconciler is now waiting for its old child to exit
    quitDesktop()
    child.finish()
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(harness.spawn).toHaveBeenCalledTimes(3)
    expect(harness.activeOwner).toBe(false)
  })
  it('cannot reacquire local ownership or spawn children after return-integrated races quit', async () => {
    await startDesktop()
    await harness.bootstrap
    const connect = harness.handlers.get('openalice:desktop-connection:connect')!
    await connect({ sender: { id: 7 } }, 'remote', 'demo')
    expect(harness.activeOwner).toBe(false)
    const entered = deferred<void>()
    const reacquired = deferred<{ release: () => Promise<void> }>()
    harness.acquire.mockImplementationOnce(() => { entered.resolve(); return reacquired.promise })
    const returning = harness.handlers.get('openalice:desktop-connection:return-integrated')!({ sender: { id: 7 } }) as Promise<void>
    await entered.promise
    const spawnCount = harness.spawn.mock.calls.length
    quitDesktop()
    reacquired.resolve({ release: async () => { harness.activeOwner = false; await harness.release() } })
    harness.activeOwner = true
    await returning.catch(() => undefined)

    expect(harness.spawn).toHaveBeenCalledTimes(spawnCount)
    expect(harness.activeOwner).toBe(false)
  })
})
