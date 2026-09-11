import type { IncomingMessage, Server as HttpServer } from 'node:http'
import type { Socket } from 'node:net'

import { WebSocket, WebSocketServer } from 'ws'

import type { HarnessSurfaceManager, HarnessSurfaceTarget } from '../workspaces/harness-surface-manager.js'

const REQUEST_DENY = new Set([
  'authorization',
  'cookie',
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'x-csrf-token',
  'x-openalice-token',
])

const RESPONSE_DENY = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

export async function proxyHarnessSurface(request: Request, target: HarnessSurfaceTarget): Promise<Response> {
  const incomingUrl = new URL(request.url)
  const upstreamOrigin = `http://${target.host}:${target.port}`
  const upstreamUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, upstreamOrigin)
  const headers = new Headers()
  request.headers.forEach((value, name) => {
    if (!REQUEST_DENY.has(name.toLowerCase())) headers.set(name, value)
  })
  headers.set('host', upstreamUrl.host)
  if (headers.has('origin')) headers.set('origin', upstreamOrigin)
  if (headers.has('referer')) headers.set('referer', `${upstreamOrigin}/`)

  let upstream: Response
  try {
    upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: hasBody(request.method) ? request.body : null,
      ...(hasBody(request.method) ? { duplex: 'half' } : {}),
      redirect: 'manual',
      signal: request.signal,
    } as RequestInit)
  } catch (err) {
    return new Response(err instanceof Error ? err.message : String(err), {
      status: 502,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }

  const responseHeaders = new Headers()
  upstream.headers.forEach((value, name) => {
    if (!RESPONSE_DENY.has(name.toLowerCase())) responseHeaders.set(name, value)
  })
  const location = responseHeaders.get('location')
  if (location) {
    try {
      const resolved = new URL(location, upstreamOrigin)
      if (resolved.origin === upstreamOrigin) {
        responseHeaders.set('location', `${incomingUrl.origin}${resolved.pathname}${resolved.search}${resolved.hash}`)
      }
    } catch {
      // Preserve malformed/relative locations; the browser applies its normal rules.
    }
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  })
}

export interface AttachedHarnessSurfaceWS {
  dispose(): void
}

export function attachHarnessSurfaceWS(
  server: HttpServer,
  manager: HarnessSurfaceManager,
): AttachedHarnessSurfaceWS {
  const wss = new WebSocketServer({ noServer: true })
  const onUpgrade = (req: IncomingMessage, socket: Socket, head: Buffer): void => {
    const target = manager.resolveHost(req.headers.host)
    if (!target) return
    wss.handleUpgrade(req, socket, head, (client) => {
      const path = req.url?.startsWith('/') ? req.url : '/'
      const protocols = parseProtocols(req.headers['sec-websocket-protocol'])
      const upstream = new WebSocket(`ws://${target.host}:${target.port}${path}`, protocols, {
        headers: {
          ...(req.headers['user-agent'] ? { 'user-agent': req.headers['user-agent'] } : {}),
          ...(req.headers['origin'] ? { origin: `http://${target.host}:${target.port}` } : {}),
        },
      })
      let upstreamOpen = false
      const pending: Array<{ data: Buffer; binary: boolean }> = []

      client.on('message', (data, binary) => {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
        if (!upstreamOpen) {
          if (pending.length < 64) pending.push({ data: buffer, binary })
          return
        }
        if (upstream.readyState === WebSocket.OPEN) upstream.send(buffer, { binary })
      })
      upstream.on('open', () => {
        upstreamOpen = true
        for (const message of pending.splice(0)) upstream.send(message.data, { binary: message.binary })
      })
      upstream.on('message', (data, binary) => {
        if (client.readyState === WebSocket.OPEN) client.send(data, { binary })
      })
      client.on('close', (code, reason) => {
        if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
          closeWebSocket(upstream, code, reason)
        }
      })
      upstream.on('close', (code, reason) => {
        if (client.readyState === WebSocket.OPEN) closeWebSocket(client, code, reason)
      })
      upstream.on('error', () => {
        if (client.readyState === WebSocket.OPEN) client.close(1011, 'Studio WebSocket unavailable')
      })
    })
  }
  server.on('upgrade', onUpgrade)
  return {
    dispose: () => {
      server.off('upgrade', onUpgrade)
      wss.close()
    },
  }
}

function parseProtocols(raw: string | string[] | undefined): string[] | undefined {
  if (Array.isArray(raw)) raw = raw.join(',')
  const values = raw?.split(',').map((value) => value.trim()).filter(Boolean)
  return values && values.length > 0 ? values : undefined
}

function hasBody(method: string): boolean {
  const normalized = method.toUpperCase()
  return normalized !== 'GET' && normalized !== 'HEAD'
}

function closeWebSocket(socket: WebSocket, code: number, reason: Buffer): void {
  // ws reports 1005 when a peer closes without a status. That value, along
  // with the other reserved close codes, may not be sent on the wire again.
  if (isSendableCloseCode(code)) {
    socket.close(code, reason.subarray(0, 123).toString())
    return
  }
  socket.close()
}

function isSendableCloseCode(code: number): boolean {
  return (
    (code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006)
    || (code >= 3000 && code <= 4999)
  )
}
