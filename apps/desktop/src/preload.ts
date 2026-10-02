/**
 * Renderer preload bridge.
 *
 * Keep this surface narrow and explicit. The renderer stays sandboxed
 * (`nodeIntegration:false`, `contextIsolation:true`) and receives only the
 * Electron-native capabilities we intentionally expose. Browser/Docker/dev
 * builds do not have this object, so the web UI can choose:
 *
 *   Electron app → window.openAlice.* IPC transport
 *   Browser/dev/Docker → HTTP + WebSocket transport
 *
 * First app-mode slices: workspace file read/list and PTY streaming. The
 * backend still serves HTTP/WS for dev, Docker, and self-hosted browsers; the
 * preload bridge is the faster local capability surface for Electron.
 */

import { contextBridge, ipcRenderer } from 'electron'

interface PtyListeners {
  readonly message: Set<(msg: { type: 'data' | 'control'; data: unknown }) => void>
  readonly close: Set<(msg: { code: number; reason: string }) => void>
}

type UpdaterStatus = import('@traderalice/update-lifecycle').NativeUpdaterStatus

const ptyListeners = new Map<string, PtyListeners>()
const updaterListeners = new Set<(status: UpdaterStatus) => void>()

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function listenersFor(connectionId: string): PtyListeners {
  let listeners = ptyListeners.get(connectionId)
  if (!listeners) {
    listeners = { message: new Set(), close: new Set() }
    ptyListeners.set(connectionId, listeners)
  }
  return listeners
}

function cleanupPty(connectionId: string): void {
  ptyListeners.delete(connectionId)
}

ipcRenderer.on('openalice:pty:server-event', (_event, raw: unknown) => {
  const msg = raw && typeof raw === 'object'
    ? raw as { connectionId?: unknown; event?: unknown; data?: unknown; code?: unknown; reason?: unknown }
    : {}
  const connectionId = typeof msg.connectionId === 'string' ? msg.connectionId : ''
  if (!connectionId) return
  const listeners = ptyListeners.get(connectionId)
  if (!listeners) return
  if (msg.event === 'close') {
    for (const cb of listeners.close) {
      cb({
        code: typeof msg.code === 'number' ? msg.code : 1000,
        reason: typeof msg.reason === 'string' ? msg.reason : '',
      })
    }
    cleanupPty(connectionId)
    return
  }
  if (msg.event === 'data' || msg.event === 'control') {
    for (const cb of listeners.message) cb({ type: msg.event, data: msg.data })
  }
})

ipcRenderer.on('openalice:updater:status', (_event, raw: unknown) => {
  if (!raw || typeof raw !== 'object') return
  const rec = raw as Record<string, unknown>
  const phase = rec['phase']
  if (phase === 'downloaded') {
    const version = typeof rec['version'] === 'string' ? rec['version'] : ''
    const releaseUrl = typeof rec['releaseUrl'] === 'string' ? rec['releaseUrl'] : ''
    if (!version || !releaseUrl) return
    for (const cb of updaterListeners) cb({ phase, version, releaseUrl })
    return
  }
  if (phase === 'error') {
    const message = typeof rec['message'] === 'string' ? rec['message'] : 'Update check failed.'
    for (const cb of updaterListeners) cb({ phase, message })
    return
  }
  if (phase === 'installing') {
    const version = typeof rec['version'] === 'string' ? rec['version'] : ''
    const stage = rec['stage']
    if (
      !version ||
      (stage !== 'preparing' &&
        stage !== 'stopping-services' &&
        stage !== 'releasing-runtime' &&
        stage !== 'handing-off')
    ) return
    for (const cb of updaterListeners) cb({ phase, version, stage })
    return
  }
  if (phase === 'available') {
    for (const cb of updaterListeners) {
      cb({
        phase,
        ...(typeof rec['version'] === 'string' ? { version: rec['version'] } : {}),
        ...(typeof rec['releaseUrl'] === 'string' ? { releaseUrl: rec['releaseUrl'] } : {}),
      })
    }
    return
  }
  if (phase === 'downloading') {
    for (const cb of updaterListeners) {
      cb({
        phase,
        ...(typeof rec['version'] === 'string' ? { version: rec['version'] } : {}),
        ...(typeof rec['percent'] === 'number' ? { percent: rec['percent'] } : {}),
      })
    }
  }
})

const api = {
  setNativeMenuLocale: (locale: string): Promise<void> => ipcRenderer.invoke('openalice:native-menu:locale', locale),
  desktopConnection: {
    status: () => ipcRenderer.invoke('openalice:desktop-connection:status'),
    fleet: () => ipcRenderer.invoke('openalice:desktop-connection:fleet'),
    startupTarget: () => ipcRenderer.invoke('openalice:desktop-connection:startup-target'),
    connect: (machine: string, project: string) => ipcRenderer.invoke('openalice:desktop-connection:connect', machine, project),
    controlProject: (input: unknown) => ipcRenderer.invoke('openalice:desktop-connection:project-control', input),
    returnIntegrated: () => ipcRenderer.invoke('openalice:desktop-connection:return-integrated'),
  },
  desktopMachine: {
    plan: (input: unknown) => ipcRenderer.invoke('openalice:desktop-machine:plan', input),
    apply: (id: string) => ipcRenderer.invoke('openalice:desktop-machine:apply', id),
    abandon: () => ipcRenderer.invoke('openalice:updates:abandon'),
    operation: () => ipcRenderer.invoke('openalice:desktop-machine:operation'),
  },
  companion: {
    activity: {
      getSignals: () => ipcRenderer.invoke('openalice:activity:signals'),
      onSignals: (callback: (input: unknown) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, input: unknown) => callback(input)
        ipcRenderer.on('openalice:activity:signals', listener)
        return () => ipcRenderer.removeListener('openalice:activity:signals', listener)
      },
      getPreferences: () => ipcRenderer.invoke('openalice:activity:preferences'),
      updatePreferences: (input: unknown) => ipcRenderer.invoke('openalice:activity:update-preferences', input),
      resetPreferences: () => ipcRenderer.invoke('openalice:activity:reset-preferences'),
      open: (displayId: string) => ipcRenderer.invoke('openalice:activity:open', displayId),
      dismiss: (displayId: string) => ipcRenderer.invoke('openalice:activity:dismiss', displayId),
      onPreferences: (callback: (input: unknown) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, input: unknown) => callback(input)
        ipcRenderer.on('openalice:activity:preferences-changed', listener)
        return () => ipcRenderer.removeListener('openalice:activity:preferences-changed', listener)
      },
      onDisplay: (callback: (input: unknown) => void) => {
        let active = true
        const changed = new Set<string>()
        const listener = (_event: Electron.IpcRendererEvent, input: { displayId: string }) => { changed.add(input.displayId); callback(input) }
        ipcRenderer.on('openalice:activity:display', listener)
        // Fetch after listener registration to close initial-render delivery gaps.
        void ipcRenderer.invoke('openalice:activity:snapshot').then(events => { if (active) for (const event of events) if (!changed.has(event.displayId)) callback(event) }).catch(() => {})
        return () => { active = false; ipcRenderer.removeListener('openalice:activity:display', listener) }
      },
      onOpen: (callback: (context: string) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, context: string) => callback(context)
        ipcRenderer.on('openalice:activity:open', listener)
        return () => ipcRenderer.removeListener('openalice:activity:open', listener)
      },
    },
    getSound: () => ipcRenderer.invoke('openalice:companion:sound:get'),
    updateSound: (settings: unknown) => ipcRenderer.invoke('openalice:companion:sound:update', settings),
    resetSound: () => ipcRenderer.invoke('openalice:companion:sound:reset'),
    onSound: (callback: (settings: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, settings: unknown) => callback(settings)
      ipcRenderer.on('openalice:companion:sound:changed', listener)
      return () => ipcRenderer.removeListener('openalice:companion:sound:changed', listener)
    },
    getVisible: (): Promise<boolean> => ipcRenderer.invoke('openalice:companion:get-visible'),
    toggle: (): Promise<boolean> => ipcRenderer.invoke('openalice:companion:toggle'),
    onVisibility: (callback: (visible: boolean) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, visible: boolean) => callback(visible)
      ipcRenderer.on('openalice:companion:visibility', listener)
      return () => ipcRenderer.removeListener('openalice:companion:visibility', listener)
    },
  },
  windowChrome: {
    platform: process.platform,
    setTheme: (theme: { color: string; symbolColor: string }) =>
      process.platform === 'win32' ? ipcRenderer.invoke('openalice:window-chrome:theme', theme) : Promise.resolve(),
  },
  runtime: {
    info: () => ipcRenderer.invoke('openalice:runtime:info'),
  },
  keyboard: {
    getInputSourceId: () => ipcRenderer.invoke('openalice:keyboard:get-input-source-id'),
  },
  dataHome: {
    getStatus: () => ipcRenderer.invoke('openalice:data-home:get-status'),
    chooseAndRestart: () => ipcRenderer.invoke('openalice:data-home:choose-and-restart'),
    useRecentAndRestart: (path: string) =>
      ipcRenderer.invoke('openalice:data-home:use-recent-and-restart', path),
    setAskOnStartup: (enabled: boolean) =>
      ipcRenderer.invoke('openalice:data-home:set-ask-on-startup', enabled),
    openCurrent: () => ipcRenderer.invoke('openalice:data-home:open-current'),
  },
  clientUpdates: {
    abandon: () => ipcRenderer.invoke('openalice:updates:abandon'),
    operation: () => ipcRenderer.invoke('openalice:updates:status'),
    review: (selection: unknown) => ipcRenderer.invoke('openalice:updates:review', selection),
    approve: (plan: unknown, fingerprint: string) => ipcRenderer.invoke('openalice:updates:approve', plan, fingerprint),
    resume: () => ipcRenderer.invoke('openalice:updates:resume'),
    status: () => ipcRenderer.invoke('openalice:client-updates:status'),
    check: () => ipcRenderer.invoke('openalice:client-updates:check'),
    activate: () => ipcRenderer.invoke('openalice:client-updates:activate'),
    savePreferences: (input: { autoCheck: boolean }) => ipcRenderer.invoke('openalice:client-updates:preferences', input),
  },
  updater: {
    getStatus: () => ipcRenderer.invoke('openalice:updater:get-status'),
    onStatus: (cb: (status: UpdaterStatus) => void) => {
      updaterListeners.add(cb)
      return () => updaterListeners.delete(cb)
    },
    openRelease: (version?: string) => ipcRenderer.invoke('openalice:updater:open-release', version),
  },
  workspace: {
    listFiles: (input: { id: string; path: string }) =>
      ipcRenderer.invoke('openalice:workspace:list-files', input),
    readFile: (input: { id: string; path: string }) =>
      ipcRenderer.invoke('openalice:workspace:read-file', input),
  },
  pty: {
    connect: (input: {
      sessionId: string
      cols: number
      rows: number
      since?: number
      controllerId?: string
      controllerKind?: string
      takeover?: boolean
    }) => {
      const connectionId = randomId()
      listenersFor(connectionId)
      // Keep the Electron transport on ordinary ipcRenderer events instead of
      // transferring a MessagePort. Packaged app renderers run sandboxed under
      // app://, and avoiding a second port lifecycle makes PTY attach failures
      // visible instead of silently stranding the shell stream.
      ipcRenderer.send('openalice:pty:connect', { connectionId, ...input })
      return connectionId
    },
    send: (connectionId: string, data: Uint8Array) => {
      ipcRenderer.send('openalice:pty:client-message', { connectionId, type: 'data', data })
    },
    resize: (connectionId: string, cols: number, rows: number) => {
      ipcRenderer.send('openalice:pty:client-message', { connectionId, type: 'resize', cols, rows })
    },
    control: (connectionId: string, data: string) => {
      ipcRenderer.send('openalice:pty:client-message', { connectionId, type: 'control', data })
    },
    close: (connectionId: string) => {
      ipcRenderer.send('openalice:pty:client-close', { connectionId })
      cleanupPty(connectionId)
    },
    onMessage: (
      connectionId: string,
      cb: (msg: { type: 'data' | 'control'; data: unknown }) => void,
    ) => {
      listenersFor(connectionId).message.add(cb)
      return () => listenersFor(connectionId).message.delete(cb)
    },
    onClose: (
      connectionId: string,
      cb: (msg: { code: number; reason: string }) => void,
    ) => {
      listenersFor(connectionId).close.add(cb)
      return () => listenersFor(connectionId).close.delete(cb)
    },
  },
}

// A separated window must use the relay's HTTP/WS transport. It retains only
// desktop chrome, updates, and the explicit path back to local integration;
// backend-specific file and PTY IPC never reach a remote-connected renderer.
if (window.location.protocol === 'app:') {
  contextBridge.exposeInMainWorld('openAlice', api)
} else if (window.location.protocol === 'http:' && window.location.hostname === '127.0.0.1') {
  contextBridge.exposeInMainWorld('openAlice', {
    desktopConnection: api.desktopConnection,
    desktopMachine: api.desktopMachine,
    windowChrome: api.windowChrome,
    updater: api.updater,
    clientUpdates: api.clientUpdates,
  })
}
