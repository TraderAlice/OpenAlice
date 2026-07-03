/**
 * Electron web transport for the Alice Hono app.
 *
 * In desktop mode the renderer loads `app://openalice/...`; Electron main
 * forwards those requests over child_process IPC and this module dispatches
 * them directly through `app.fetch()`. Dev/browser/Docker still use the HTTP
 * listener owned by WebPlugin.
 */

import type { Hono } from 'hono'

const MSG_WEB_REQUEST = 'openalice:web:request'
const MSG_WEB_RESPONSE = 'openalice:web:response'

interface WebRequestMessage {
  readonly type: typeof MSG_WEB_REQUEST
  readonly id: string
  readonly method: string
  readonly url: string
  readonly headers: readonly [string, string][]
  readonly body?: unknown
}

export interface AttachedWebIpc {
  dispose(): void
}

export function attachWebIpc(app: Hono): AttachedWebIpc {
  if (!process.send || process.env['OPENALICE_WEB_TRANSPORT'] !== 'ipc') {
    return { dispose: () => {} }
  }

  const onMessage = (raw: unknown): void => {
    const msg = raw && typeof raw === 'object' ? raw as WebRequestMessage : null
    if (!msg || msg.type !== MSG_WEB_REQUEST || typeof msg.id !== 'string') return

    void (async () => {
      try {
        const init: RequestInit = {
          method: msg.method,
          headers: new Headers(Array.isArray(msg.headers) ? msg.headers : []),
        }
        if (msg.method !== 'GET' && msg.method !== 'HEAD') {
          const body = coerceBody(msg.body)
          if (body) init.body = body
        }
        const req = new Request(msg.url, init)
        // Mirror loopback HTTP semantics for the auth middleware. The request
        // did not cross a network boundary; it came from Electron main over the
        // child IPC pipe.
        const res = await app.fetch(req, {
          incoming: { socket: { remoteAddress: '127.0.0.1' } },
        } as never)
        const body = Buffer.from(await res.arrayBuffer())
        process.send?.({
          type: MSG_WEB_RESPONSE,
          id: msg.id,
          status: res.status,
          statusText: res.statusText,
          headers: [...res.headers.entries()],
          body,
        })
      } catch (err) {
        process.send?.({
          type: MSG_WEB_RESPONSE,
          id: msg.id,
          status: 500,
          statusText: 'Internal Server Error',
          headers: [['content-type', 'text/plain; charset=utf-8']],
          body: Buffer.from(err instanceof Error ? err.message : String(err)),
        })
      }
    })()
  }

  process.on('message', onMessage)
  return {
    dispose: () => process.off('message', onMessage),
  }
}

function coerceBody(raw: unknown): BodyInit | undefined {
  if (raw === undefined || raw === null) return undefined
  if (Buffer.isBuffer(raw)) return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
  if (raw instanceof Uint8Array) return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
  if (raw instanceof ArrayBuffer) return raw
  if (typeof raw === 'string') return raw
  return new ArrayBuffer(0)
}
