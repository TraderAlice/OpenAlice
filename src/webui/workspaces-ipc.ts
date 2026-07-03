/**
 * Electron IPC transport for workspace PTY sessions.
 *
 * Browser/dev/Docker keep using `/api/workspaces/pty` WebSocket. In Electron,
 * the renderer talks to Electron main through a MessagePort, and Electron main
 * talks to this Alice child process over Node child_process IPC. This keeps
 * the PersistentSession byte semantics in one place while removing the
 * renderer → localhost WebSocket hop in app mode.
 */

import { EventEmitter } from 'node:events'
import type { WebSocket } from 'ws'

import { logger as launcherLogger } from '../workspaces/logger.js'
import type { WorkspaceService } from '../workspaces/service.js'

const MSG_CONNECT = 'openalice:pty:connect'
const MSG_CLIENT = 'openalice:pty:client-message'
const MSG_CLIENT_CLOSE = 'openalice:pty:client-close'
const MSG_SERVER = 'openalice:pty:server-message'
const MSG_SERVER_CLOSE = 'openalice:pty:server-close'

type BridgeMessage =
  | {
      type: typeof MSG_CONNECT
      connectionId: string
      sessionId: string
      cols: number
      rows: number
      since?: number
      controllerId?: string
      controllerKind?: string
      takeover?: boolean
    }
  | { type: typeof MSG_CLIENT; connectionId: string; binary: boolean; data: unknown }
  | { type: typeof MSG_CLIENT_CLOSE; connectionId: string }

class IpcPtySocket extends EventEmitter {
  readonly OPEN = 1
  readyState = 1
  bufferedAmount = 0

  constructor(readonly connectionId: string) {
    super()
  }

  send(data: string | Buffer, opts?: { binary?: boolean }, cb?: (err?: Error) => void): void {
    if (!process.send || this.readyState !== this.OPEN) {
      cb?.(new Error('IPC PTY socket is closed'))
      return
    }
    const binary = opts?.binary ?? Buffer.isBuffer(data)
    process.send({ type: MSG_SERVER, connectionId: this.connectionId, binary, data }, (err) => cb?.(err ?? undefined))
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState !== this.OPEN) return
    this.readyState = 3
    try {
      process.send?.({ type: MSG_SERVER_CLOSE, connectionId: this.connectionId, code, reason })
    } catch {
      // Parent may already be gone.
    }
    this.emit('close', code, reason)
  }

  receive(raw: unknown, isBinary: boolean): void {
    if (this.readyState !== this.OPEN) return
    this.emit('message', coerceBuffer(raw), isBinary)
  }

  clientClosed(): void {
    if (this.readyState !== this.OPEN) return
    this.readyState = 3
    this.emit('close', 1000, 'client closed')
  }
}

export interface AttachedWorkspaceIpc {
  dispose(): void
}

export function attachWorkspacesIpc(svc: WorkspaceService): AttachedWorkspaceIpc {
  if (!process.send || process.env['OPENALICE_LAUNCHER'] !== 'electron') {
    return { dispose: () => {} }
  }

  const sockets = new Map<string, IpcPtySocket>()

  const close = (connectionId: string, code: number, reason: string): void => {
    try {
      process.send?.({ type: MSG_SERVER_CLOSE, connectionId, code, reason })
    } catch {
      // Parent may already be gone.
    }
  }

  const onMessage = (raw: unknown): void => {
    const msg = raw && typeof raw === 'object' ? raw as BridgeMessage : null
    if (!msg || typeof msg.type !== 'string') return

    if (msg.type === MSG_CONNECT) {
      const connectionId = typeof msg.connectionId === 'string' ? msg.connectionId : ''
      const sessionId = typeof msg.sessionId === 'string' ? msg.sessionId.slice(0, 64) : ''
      if (!connectionId || !sessionId) {
        if (connectionId) close(connectionId, 4000, 'session id required')
        return
      }
      if (!svc.pool.get(sessionId)) {
        close(connectionId, 4404, 'session not found')
        return
      }
      const socket = new IpcPtySocket(connectionId)
      sockets.set(connectionId, socket)
      socket.once('close', () => sockets.delete(connectionId))
      const cols = clamp(msg.cols, 80, 1, 1000)
      const rows = clamp(msg.rows, 24, 1, 1000)
      const since = typeof msg.since === 'number' && Number.isFinite(msg.since) && msg.since >= 0 ? msg.since : undefined
      const controllerId = typeof msg.controllerId === 'string' ? msg.controllerId.slice(0, 128) : ''
      const controllerKind = typeof msg.controllerKind === 'string' ? msg.controllerKind.slice(0, 32) : 'electron'
      const result = svc.pool.attachById(
        sessionId,
        socket as unknown as WebSocket,
        cols,
        rows,
        since,
        controllerId ? { controllerId, controllerKind, takeover: msg.takeover === true } : undefined,
      )
      if (!result.ok && result.reason === 'missing') socket.close(4404, 'session not found')
      launcherLogger.event('ipc_pty.attached', { connectionId, sessionId, cols, rows })
      console.log(`ipc pty attached: session=${sessionId} connection=${connectionId} size=${cols}x${rows}`)
      return
    }

    if (msg.type === MSG_CLIENT) {
      const socket = sockets.get(typeof msg.connectionId === 'string' ? msg.connectionId : '')
      if (!socket) return
      socket.receive(msg.data, msg.binary === true)
      return
    }

    if (msg.type === MSG_CLIENT_CLOSE) {
      const socket = sockets.get(typeof msg.connectionId === 'string' ? msg.connectionId : '')
      socket?.clientClosed()
    }
  }

  process.on('message', onMessage)
  return {
    dispose: () => {
      process.off('message', onMessage)
      for (const socket of sockets.values()) socket.close(1000, 'ipc bridge disposed')
      sockets.clear()
    },
  }
}

function coerceBuffer(raw: unknown): Buffer {
  if (Buffer.isBuffer(raw)) return raw
  if (raw instanceof Uint8Array) return Buffer.from(raw)
  if (raw instanceof ArrayBuffer) return Buffer.from(raw)
  if (typeof raw === 'string') return Buffer.from(raw, 'utf8')
  return Buffer.alloc(0)
}

function clamp(raw: unknown, fallback: number, lo: number, hi: number): number {
  const n = typeof raw === 'number' ? Math.floor(raw) : Number.NaN
  if (!Number.isFinite(n)) return fallback
  return Math.max(lo, Math.min(hi, n))
}
