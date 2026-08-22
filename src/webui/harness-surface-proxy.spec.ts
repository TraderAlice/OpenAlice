import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'

import { attachHarnessSurfaceWS, proxyHarnessSurface } from './harness-surface-proxy.js'
import type { HarnessSurfaceManager } from '../workspaces/harness-surface-manager.js'

const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

describe('proxyHarnessSurface', () => {
  it('streams the response while stripping OpenAlice credentials', async () => {
    const server = createServer((req, res) => {
      expect(req.headers.cookie).toBeUndefined()
      expect(req.headers.authorization).toBeUndefined()
      expect(req.headers['x-csrf-token']).toBeUndefined()
      expect(req.headers['x-test']).toBe('kept')
      res.setHeader('content-type', 'text/event-stream')
      res.write('data: one\n\n')
      setTimeout(() => res.end('data: two\n\n'), 10)
    })
    servers.push(server)
    const port = await listen(server)
    const response = await proxyHarnessSurface(new Request('http://oa-surface-aabbccddeeff001122334455.localhost/events', {
      headers: {
        cookie: 'openalice_session=secret',
        authorization: 'Bearer secret',
        'x-csrf-token': 'secret',
        'x-test': 'kept',
      },
    }), { host: '127.0.0.1', port, generation: 1 })
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    await expect(response.text()).resolves.toBe('data: one\n\ndata: two\n\n')
  })

  it('rewrites internal redirects to the opaque public origin', async () => {
    const server = createServer((_req, res) => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      res.statusCode = 302
      res.setHeader('location', `http://127.0.0.1:${port}/next?q=1`)
      res.end()
    })
    servers.push(server)
    const port = await listen(server)
    const response = await proxyHarnessSurface(
      new Request('http://oa-surface-aabbccddeeff001122334455.localhost/start'),
      { host: '127.0.0.1', port, generation: 1 },
    )
    expect(response.headers.get('location')).toBe('http://oa-surface-aabbccddeeff001122334455.localhost/next?q=1')
  })

  it('forwards WebSocket upgrades by opaque host without forwarding cookies', async () => {
    const upstreamServer = createServer()
    servers.push(upstreamServer)
    const upstreamWss = new WebSocketServer({ noServer: true })
    upstreamServer.on('upgrade', (request, socket, head) => {
      expect(request.headers.cookie).toBeUndefined()
      upstreamWss.handleUpgrade(request, socket, head, (ws) => upstreamWss.emit('connection', ws, request))
    })
    upstreamWss.on('connection', (ws) => ws.on('message', (data) => ws.send(data)))
    const upstreamPort = await listen(upstreamServer)

    const gateway = createServer()
    servers.push(gateway)
    const manager = {
      resolveHost: (host: string | undefined) => host?.startsWith('oa-surface-')
        ? { host: '127.0.0.1', port: upstreamPort, generation: 1 }
        : null,
    } as HarnessSurfaceManager
    const attached = attachHarnessSurfaceWS(gateway, manager)
    const gatewayPort = await listen(gateway)
    const client = new WebSocket(`ws://127.0.0.1:${gatewayPort}/events`, {
      headers: {
        host: `oa-surface-aabbccddeeff001122334455.localhost:${gatewayPort}`,
        cookie: 'openalice_session=secret',
      },
    })
    await new Promise<void>((resolve, reject) => {
      client.once('open', resolve)
      client.once('error', reject)
    })
    const reply = new Promise<string>((resolve) => client.once('message', (data) => resolve(data.toString())))
    client.send('hello')
    await expect(reply).resolves.toBe('hello')
    const closed = new Promise<void>((resolve) => client.once('close', () => resolve()))
    client.close()
    await closed
    attached.dispose()
    await new Promise<void>((resolve) => upstreamWss.close(() => resolve()))
  })
})

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })
}
