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

const ptyListeners = new Map<string, PtyListeners>()

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

const api = {
  runtime: {
    info: () => ipcRenderer.invoke('openalice:runtime:info'),
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

contextBridge.exposeInMainWorld('openAlice', api)
