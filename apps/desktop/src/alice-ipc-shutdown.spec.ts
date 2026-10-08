import { EventEmitter, once } from 'node:events'
import type { ChildProcess, spawn as Spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const previousHome = process.env.OPENALICE_HOME
const previousRuntimeProfile = process.env.OPENALICE_RUNTIME_PROFILE

const state = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>()
  return {
    child: null as ChildProcess | null,
    home: '',
    spawned: () => {},
    listeners,
    app: {
      isPackaged: false,
      whenReady: () => Promise.resolve(),
      getPath: (): string => state.home,
      commandLine: { removeSwitch: vi.fn(), appendSwitch: vi.fn() },
      disableHardwareAcceleration: vi.fn(),
      setPath: vi.fn(),
      on: vi.fn((name: string, listener: (...args: unknown[]) => void) => listeners.set(name, listener)),
      exit: vi.fn(),
      quit: vi.fn(),
    },
    taskkill: vi.fn(),
  }
})

vi.mock('electron', () => ({
  app: state.app,
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  session: { defaultSession: { resolveProxy: async () => '' } },
  dialog: { showErrorBox: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: vi.fn(), Menu: { setApplicationMenu: vi.fn() },
  nativeImage: {}, Notification: vi.fn(), shell: {}, Tray: vi.fn(),
}))
vi.mock('electron-updater', () => ({ default: { autoUpdater: {} } }))
vi.mock('./web-relay.js', () => ({
  CLI_VERSION: 'test', UpdateControlService: class {}, ClientUpdateService: class {},
  WebRelay: class {}, readStartupTarget: async () => null, writeStartupTarget: async () => {},
  resolveLocalStartupHome: async () => null, inspectLocalMachine: async () => ({}),
}))
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  spawn: vi.fn(() => {
    queueMicrotask(state.spawned)
    return state.child
  }),
  spawnSync: state.taskkill,
}))
vi.mock('@traderalice/guardian-runtime', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  acquireGuardianRuntime: async () => ({ release: async () => {} }),
  resolveGuardianTradingMode: async () => ({ mode: 'lite', source: 'env', envLocked: true }),
  takeoverRequested: () => false,
  proxyEnvFromRules: () => ({}),
}))
vi.mock('./desktop-diagnostics.js', () => ({
  DesktopDiagnostics: class { path = 'test.log'; write() {} },
  BoundedTextTail: class { append() {}; text() { return '' } },
  conciseDiagnosticTail: () => '',
}))
vi.mock('./data-home-desktop.js', () => ({
  resolveDesktopDataHome: async () => ({
    home: state.home, source: 'explicit', preferences: {},
    selectedDefault: false, selectionLock: 'explicit',
  }),
  createDesktopDataHomeController: () => ({}), dataHomeErrorDetail: String,
}))
vi.mock('./existing-owner-startup.js', () => ({
  existingOwnerSmokeMode: () => false,
  resolveExistingOwnerStartup: async () => ({ action: 'continue', takeover: false }),
}))
vi.mock('./update-attempt.js', () => ({ inspectPreviousUpdateAttempt: async () => ({ kind: 'none' }) }))
vi.mock('./managed-runtime.js', () => ({ resolveManagedRuntimeEnv: () => ({}) }))
vi.mock('./probe-port.js', () => ({ probeFreePort: async () => 47334 }))
vi.mock('./ipc.js', () => ({
  registerOpenAliceIpc: () => {}, handleOpenAliceIpcMessage: () => false,
  cancelOpenAliceWebRequests: () => {},
  fetchAliceWebRequest: () => new Promise(() => {}),
}))
vi.mock('./app-exit.js', () => ({
  exitDesktopProcess: (code: number, options: { appExit: (code: number) => void }) => options.appExit(code),
}))

class AliceChild extends EventEmitter {
  pid = 12345
  connected = true
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  stderr = new EventEmitter()
  signals: NodeJS.Signals[] = []
  send = vi.fn((_message: unknown, callback: (error?: Error) => void) => {
    queueMicrotask(() => callback(new Error('IPC channel closed')))
    return true
  })
  kill(signal: NodeJS.Signals) {
    this.signals.push(signal)
    if (signal === 'SIGKILL') this.finishForced()
    return true
  }
  finishForced() {
    this.signalCode = 'SIGKILL'
    this.connected = false
    this.emit('exit', null, 'SIGKILL')
  }
}

beforeEach(() => {
  state.home = mkdtempSync(join(tmpdir(), 'desktop-ipc-shutdown-'))
  process.env.OPENALICE_HOME = state.home
})

afterEach(() => {
  vi.useRealTimers()
  state.listeners.clear()
  state.child = null
  state.spawned = () => {}
  state.taskkill.mockReset()
  state.app.exit.mockReset()
  if (previousHome === undefined) delete process.env.OPENALICE_HOME
  else process.env.OPENALICE_HOME = previousHome
  if (previousRuntimeProfile === undefined) delete process.env.OPENALICE_RUNTIME_PROFILE
  else process.env.OPENALICE_RUNTIME_PROFILE = previousRuntimeProfile
  vi.resetModules()
  rmSync(state.home, { recursive: true, force: true })
})

async function launch(child: ChildProcess) {
  state.child = child
  const spawned = new Promise<void>((resolve) => { state.spawned = resolve })
  await import('./main.js')
  await spawned
}

describe('desktop main Alice IPC shutdown', () => {
  it('lets its IPC child finish asynchronous cleanup and exit naturally on before-quit', async () => {
    const { spawn: realSpawn } = await vi.importActual<{ spawn: typeof Spawn }>('node:child_process')
    const marker = join(state.home, 'cleanup.marker')
    const program = `
      const { writeFileSync } = require('node:fs')
      process.on('SIGTERM', () => {})
      const keepAlive = setInterval(() => {}, 1000)
      process.on('message', async (message) => {
        if (message?.type !== 'openalice:shutdown') return
        await new Promise((resolve) => setTimeout(resolve, 20))
        writeFileSync(process.argv[1], 'cleaned')
        clearInterval(keepAlive)
        process.disconnect()
      })
      process.send('ready')
    `
    const child = realSpawn(process.execPath, ['-e', program, marker], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    })
    const closed = once(child, 'close', { signal: AbortSignal.timeout(6000) })
    void closed.catch(() => {})
    try {
      const [ready] = await once(child, 'message', { signal: AbortSignal.timeout(3000) })
      expect(ready).toBe('ready')
      await launch(child)
      const exited = once(child, 'exit', { signal: AbortSignal.timeout(3000) })
      const preventDefault = vi.fn()
      state.listeners.get('before-quit')?.({ preventDefault })
      expect(preventDefault).toHaveBeenCalledOnce()
      expect(await exited).toEqual([0, null])
      await closed
      expect(readFileSync(marker, 'utf8')).toBe('cleaned')
      expect(child.signalCode).toBeNull()
      expect(state.taskkill).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(state.app.exit).toHaveBeenCalledWith(0))
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await closed
    }
  })

  for (const failure of ['disconnected', 'send callback error'] as const) {
    it(`keeps Alice alive until the 10-second force deadline after ${failure}`, async () => {
      const child = new AliceChild()
      child.connected = failure !== 'disconnected'
      state.taskkill.mockImplementation(() => { child.finishForced(); return { status: 0 } })
      await launch(child as unknown as ChildProcess)
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        const preventDefault = vi.fn()
        state.listeners.get('before-quit')?.({ preventDefault })
        expect(preventDefault).toHaveBeenCalledOnce()
        await vi.advanceTimersByTimeAsync(0)
        expect(child.exitCode).toBeNull()
        expect(child.signalCode).toBeNull()
        expect(state.taskkill).not.toHaveBeenCalled()
        expect(child.signals).not.toContain('SIGKILL')
        expect(state.app.exit).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(9_999)
        expect(child.exitCode).toBeNull()
        expect(child.signalCode).toBeNull()
        expect(state.taskkill).not.toHaveBeenCalled()
        expect(child.signals).not.toContain('SIGKILL')
        expect(state.app.exit).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(1)
        expect(child.signalCode).toBe('SIGKILL')
        if (process.platform === 'win32') {
          expect(child.signals).toEqual([])
        } else {
          expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
        }
        expect(state.app.exit).toHaveBeenCalledWith(0)
      } finally {
        vi.useRealTimers()
        if (child.exitCode === null && child.signalCode === null) child.finishForced()
      }
    })
  }
})
