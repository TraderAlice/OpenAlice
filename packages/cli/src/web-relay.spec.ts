import { createServer, request as httpRequest, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'

import { WebRelay } from './web-relay.ts'
import type { MachineManagement } from './machine-management.ts'

const openedRelays: WebRelay[] = []
const openedBackends: Server[] = []
afterEach(async () => {
  await Promise.all(openedRelays.splice(0).map((relay) => relay.close()))
  await Promise.all(openedBackends.splice(0).map((backend) => new Promise<void>((done) => backend.close(() => done()))))
})

async function backend(id: string, label: string, protectedIdentity = false): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/alice-project') {
      if (protectedIdentity) res.statusCode = 401
      res.end(protectedIdentity ? '{}' : JSON.stringify({ project: { id } }))
    }
    else if (req.url === '/api/auth/status') res.end(JSON.stringify({ authed: true, tokenConfigured: false }))
    else if (req.url === '/api/who') res.end(JSON.stringify({ label, cookie: req.headers.cookie ?? null }))
    else if (req.url === '/surface-check') res.end(JSON.stringify({ host: req.headers.host }))
    else if (req.url === '/api/login-mock') { res.setHeader('set-cookie', 'alice_session=secret; HttpOnly; Path=/'); res.end('{}') }
    else res.end('{}')
  })
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/api/echo')) { socket.destroy(); return }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', (message) => ws.send(message))
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  return { server, port: address.port }
}

async function withHost(origin: string, path: string, host: string): Promise<{ status: number; body: unknown }> {
  const url = new URL(origin)
  return new Promise((done, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port: Number(url.port), path, headers: { host } }, (response) => {
      let text = ''
      response.on('data', (chunk) => { text += String(chunk) })
      response.on('end', () => done({ status: response.statusCode ?? 0, body: JSON.parse(text) }))
    })
    request.on('error', reject)
    request.end()
  })
}

describe('WebRelay', () => {
  it('serves Vite assets and HMR through the relay while APIs follow its selected Runtime', async () => {
    const runtime = await backend('dev-id', 'development')
    openedBackends.push(runtime.server)
    const ui = createServer((req, res) => {
      res.setHeader('content-type', 'text/plain')
      res.end(`vite:${req.url}`)
    })
    const hmr = new WebSocketServer({ noServer: true })
    ui.on('upgrade', (req, socket, head) => hmr.handleUpgrade(req, socket, head, (ws) => {
      ws.send(JSON.stringify({ type: 'connected' }))
    }))
    await new Promise<void>((done) => ui.listen(0, '127.0.0.1', done))
    openedBackends.push(ui)
    const address = ui.address()
    if (!address || typeof address === 'string') throw new Error('Missing Vite fixture port')
    const relay = new WebRelay({
      uiOrigin: `http://127.0.0.1:${address.port}`,
      inspectLocal: async () => ({ machine: { key: 'local', displayName: 'This computer', projects: [{
        key: 'dev', id: 'dev-id', displayName: 'Development', available: true,
        runtime: { webEndpoint: `http://127.0.0.1:${runtime.port}` },
      }] } }) as never,
      waitReady: async () => undefined,
    })
    const origin = await relay.listen()
    openedRelays.push(relay)
    await relay.connect('local', 'dev')
    expect(await (await fetch(`${origin}/settings`)).text()).toBe('vite:/settings')
    expect(await (await fetch(`${origin}/@vite/client`)).text()).toBe('vite:/@vite/client')
    expect(await (await fetch(`${origin}/api/who`)).json()).toMatchObject({ label: 'development' })
    const message = await new Promise<string>((done, reject) => {
      const ws = new WebSocket(origin.replace('http:', 'ws:') + '/?token=test', 'vite-hmr', { headers: { origin } })
      ws.once('message', (data) => { done(String(data)); ws.close() })
      ws.once('error', reject)
    })
    expect(JSON.parse(message)).toEqual({ type: 'connected' })
  })

  it('rebuilds the selected SSH forward before a backend upgrade reports success', async () => {
    const before = await backend('cloud-id', 'before')
    const after = await backend('cloud-id', 'after')
    openedBackends.push(before.server, after.server)
    let forwardPort = before.port
    let busy = false
    let oldForwardClosed = false
    const machineManagement = {
      get busy() { return busy },
      get currentOperation() { return null },
      async apply(_id: string, afterApply: (result: { machineKey: string; inventory: unknown }) => Promise<void>) {
        busy = true
        forwardPort = after.port
        try {
          await afterApply({ machineKey: 'cloud', inventory: {} })
          return { machineKey: 'cloud', inventory: {} }
        } finally { busy = false }
      },
    } as unknown as MachineManagement
    const relay = new WebRelay({
      machineManagement,
      readRegistry: async () => ({ defaultMachine: 'local', machines: [{ key: 'cloud', sshTarget: 'cloud-host', enabled: true }] }) as never,
      inspectRegistered: async () => ({
        key: 'cloud', displayName: 'Cloud', connection: 'online', capabilities: { openTunnel: true },
        projects: [{ key: 'main', id: 'cloud-id', displayName: 'Main', available: true, runtime: { webEndpoint: 'http://127.0.0.1:47331' } }],
      }) as never,
      connect: (async (options: { signal: AbortSignal; onReady: (value: { localUrl: string }) => void }) => {
        const port = forwardPort
        options.onReady({ localUrl: `http://127.0.0.1:${port}` })
        await new Promise<void>((resolve) => options.signal.addEventListener('abort', () => {
          if (port === before.port) oldForwardClosed = true
          resolve()
        }, { once: true }))
        return 0
      }) as never,
      waitReady: async () => undefined,
    })
    const origin = await relay.listen()
    openedRelays.push(relay)
    await relay.connect('cloud', 'main')
    expect(await (await fetch(`${origin}/api/who`)).json()).toMatchObject({ label: 'before' })

    await relay.applyMachine('reviewed-plan')

    expect(relay.status.generation).toBe(2)
    expect(oldForwardClosed).toBe(true)
    expect(await (await fetch(`${origin}/api/who`)).json()).toMatchObject({ label: 'after' })
  })

  it('rebuilds a stale SSH forward after proxied requests fail while the remote Runtime is healthy', async () => {
    const before = await backend('cloud-id', 'stale forward')
    const after = await backend('cloud-id', 'healthy forward')
    openedBackends.push(after.server)
    let attempts = 0
    const relay = new WebRelay({
      readRegistry: async () => ({ defaultMachine: 'local', machines: [{ key: 'cloud', sshTarget: 'cloud-host', enabled: true }] }) as never,
      inspectRegistered: async () => ({
        key: 'cloud', displayName: 'Cloud', connection: 'online', capabilities: { openTunnel: true },
        projects: [{ key: 'main', id: 'cloud-id', displayName: 'Main', available: true, runtime: { webEndpoint: 'http://127.0.0.1:47331' } }],
      }) as never,
      connect: (async (options: { signal: AbortSignal; onReady: (value: { localUrl: string }) => void }) => {
        const port = ++attempts === 1 ? before.port : after.port
        options.onReady({ localUrl: `http://127.0.0.1:${port}` })
        await new Promise<void>((resolve) => options.signal.addEventListener('abort', () => resolve(), { once: true }))
        return 0
      }) as never,
      waitReady: async () => undefined,
    })
    const origin = await relay.listen()
    openedRelays.push(relay)
    await relay.connect('cloud', 'main')
    await new Promise<void>((done) => before.server.close(() => done()))

    expect((await fetch(`${origin}/api/who`)).status).toBe(502)
    await vi.waitFor(() => expect(relay.status.generation).toBe(2))
    expect(relay.status.targetConnection).toBe('healthy')
    expect(await (await fetch(`${origin}/api/who`)).json()).toMatchObject({ label: 'healthy forward' })
  })

  it('keeps the selected location and reconnects when its SSH process exits', async () => {
    const runtime = await backend('cloud-id', 'healthy')
    openedBackends.push(runtime.server)
    let attempts = 0
    let exitFirstTunnel: (() => void) | null = null
    const relay = new WebRelay({
      readRegistry: async () => ({ defaultMachine: 'local', machines: [{ key: 'cloud', sshTarget: 'cloud-host', enabled: true }] }) as never,
      inspectRegistered: async () => ({
        key: 'cloud', displayName: 'Cloud', connection: 'online', capabilities: { openTunnel: true },
        projects: [{ key: 'main', id: 'cloud-id', displayName: 'Main', available: true, runtime: { webEndpoint: 'http://127.0.0.1:47331' } }],
      }) as never,
      connect: (async (options: { signal: AbortSignal; onReady: (value: { localUrl: string }) => void }) => {
        const first = ++attempts === 1
        options.onReady({ localUrl: `http://127.0.0.1:${runtime.port}` })
        await new Promise<void>((resolve) => {
          if (first) exitFirstTunnel = resolve
          options.signal.addEventListener('abort', () => resolve(), { once: true })
        })
        return 0
      }) as never,
      waitReady: async () => undefined,
    })
    await relay.listen()
    openedRelays.push(relay)
    await relay.connect('cloud', 'main')
    expect(exitFirstTunnel).toBeTypeOf('function')
    exitFirstTunnel!()

    await vi.waitFor(() => expect(relay.status.generation).toBe(2))
    expect(relay.status.target).toMatchObject({ machine: 'cloud', project: 'main' })
    expect(relay.status.targetConnection).toBe('healthy')
  })

  it('shares the selected target and disconnection events with a local presenter', async () => {
    const a = await backend('a-id', 'A')
    const relay = new WebRelay({ inspectLocal: async () => ({ machine: {
      key: 'local', displayName: 'This computer', projects: [{
        key: 'a', id: 'a-id', displayName: 'A', available: true,
        runtime: { webEndpoint: `http://127.0.0.1:${a.port}` },
      }],
    } }) as never })
    await relay.listen()
    openedRelays.push(relay)
    openedBackends.push(a.server)
    const generations: number[] = []
    const unsubscribe = relay.subscribe(() => generations.push(relay.status.generation))
    await relay.connect('local', 'a')
    expect(relay.activeSelection).toMatchObject({ machine: { key: 'local' }, project: { key: 'a' } })
    relay.disconnect()
    expect(relay.status.target).toBeNull()
    expect(generations).toContain(1)
    expect(generations).toContain(2)
    unsubscribe()
  })

  it('switches one local target after identity verification and refuses cross-origin mutation', async () => {
    const a = await backend('a-id', 'A')
    const b = await backend('b-id', 'B')
    const ports = { a: a.port, b: b.port }
    const relay = new WebRelay({
      inspectLocal: async () => ({ machine: {
        key: 'local', displayName: 'This computer', projects: Object.entries(ports).map(([key, port]) => ({
          key, id: `${key}-id`, displayName: key, available: true,
          runtime: { webEndpoint: `http://127.0.0.1:${port}` },
        })),
      } }) as never,
    })
    const origin = await relay.listen()
    openedRelays.push(relay)
    openedBackends.push(a.server, b.server)
    const forbidden = await fetch(`${origin}/relay/v1/connect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ machine: 'local', project: 'a' }) })
    expect(forbidden.status).toBe(403)
    await relay.connect('local', 'a')
    expect(await (await fetch(`${origin}/api/who`)).json()).toEqual({ label: 'A', cookie: null })
    await relay.connect('local', 'b')
    expect(relay.status.generation).toBe(2)
    expect(await (await fetch(`${origin}/api/who`)).json()).toEqual({ label: 'B', cookie: null })
    const attack = await fetch(`${origin}/relay/v1/connect`, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ machine: 'local', project: 'a' }) })
    expect(attack.status).toBe(403)
    const reconnectAttack = await fetch(`${origin}/relay/v1/reconnect`, { method: 'POST', headers: { origin: 'https://evil.example' } })
    expect(reconnectAttack.status).toBe(403)
    const machineAttack = await fetch(`${origin}/relay/v1/machines/apply`, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ id: 'stolen-plan' }) })
    expect(machineAttack.status).toBe(403)
    expect(relay.status.target).toMatchObject({ machine: 'local', project: 'b' })
  })

  it('keeps the active target when the candidate Runtime identity differs', async () => {
    const a = await backend('a-id', 'A')
    const b = await backend('wrong-id', 'B')
    const relay = new WebRelay({
      inspectLocal: async () => ({ machine: {
        key: 'local', displayName: 'This computer', projects: [
          { key: 'a', id: 'a-id', displayName: 'A', available: true, runtime: { webEndpoint: `http://127.0.0.1:${a.port}` } },
          { key: 'b', id: 'b-id', displayName: 'B', available: true, runtime: { webEndpoint: `http://127.0.0.1:${b.port}` } },
        ],
      } }) as never,
    })
    const origin = await relay.listen()
    openedRelays.push(relay)
    openedBackends.push(a.server, b.server)
    await relay.connect('local', 'a')
    await expect(relay.connect('local', 'b')).rejects.toThrow('different AliceProject')
    expect(relay.status.target).toMatchObject({ machine: 'local', project: 'a' })
    expect(await (await fetch(`${origin}/api/who`)).json()).toEqual({ label: 'A', cookie: null })
  })

  it('forwards WebSocket frames and closes the old socket on switch', async () => {
    const a = await backend('a-id', 'A')
    const b = await backend('b-id', 'B')
    const relay = new WebRelay({ inspectLocal: async () => ({ machine: {
      key: 'local', displayName: 'This computer', projects: [
        { key: 'a', id: 'a-id', displayName: 'A', available: true, runtime: { webEndpoint: `http://127.0.0.1:${a.port}` } },
        { key: 'b', id: 'b-id', displayName: 'B', available: true, runtime: { webEndpoint: `http://127.0.0.1:${b.port}` } },
      ],
    } }) as never })
    const origin = await relay.listen()
    openedRelays.push(relay)
    openedBackends.push(a.server, b.server)
    await relay.connect('local', 'a')
    const ws = new WebSocket(`${origin.replace('http:', 'ws:')}/api/echo`, { origin })
    await new Promise<void>((done, reject) => { ws.once('open', done); ws.once('error', reject) })
    const answer = new Promise<string>((done) => ws.once('message', (value) => done(String(value))))
    ws.send('hello')
    expect(await answer).toBe('hello')
    const closed = new Promise<void>((done) => ws.once('close', () => done()))
    await relay.connect('local', 'b')
    await closed
  })

  it('namespaces backend cookies so a session from one target is never sent to another', async () => {
    const a = await backend('a-id', 'A')
    const b = await backend('b-id', 'B')
    const relay = new WebRelay({ inspectLocal: async () => ({ machine: {
      key: 'local', displayName: 'This computer', projects: [
        { key: 'a', id: 'a-id', displayName: 'A', available: true, runtime: { webEndpoint: `http://127.0.0.1:${a.port}` } },
        { key: 'b', id: 'b-id', displayName: 'B', available: true, runtime: { webEndpoint: `http://127.0.0.1:${b.port}` } },
      ],
    } }) as never })
    const origin = await relay.listen()
    openedRelays.push(relay)
    openedBackends.push(a.server, b.server)
    await relay.connect('local', 'a')
    const cookie = (await fetch(`${origin}/api/login-mock`)).headers.get('set-cookie')?.split(';')[0]
    expect(cookie).toContain('alice_5_local_1_a_alice_session=secret')
    const aReply = await (await fetch(`${origin}/api/who`, { headers: { cookie: cookie! } })).json()
    expect(aReply.cookie).toBe('alice_session=secret')
    await relay.connect('local', 'b')
    const bReply = await (await fetch(`${origin}/api/who`, { headers: { cookie: cookie! } })).json()
    expect(bReply.cookie).toBeNull()
  })

  it('accepts a login-gated Runtime after SSH inventory reconfirms its owner', async () => {
    const a = await backend('a-id', 'A', true)
    let inspections = 0
    const relay = new WebRelay({ inspectLocal: async () => {
      inspections += 1
      return { machine: { key: 'local', displayName: 'This computer', projects: [{
        key: 'a', id: 'a-id', displayName: 'A', available: true,
        runtime: { webEndpoint: `http://127.0.0.1:${a.port}` },
      }] } } as never
    } })
    await relay.listen()
    openedRelays.push(relay)
    openedBackends.push(a.server)
    await relay.connect('local', 'a')
    expect(inspections).toBe(2)
    expect(relay.status.target).toMatchObject({ machine: 'local', project: 'a' })
  })

  it('forwards only opaque Surface hosts to the selected Runtime, not to relay controls', async () => {
    const a = await backend('a-id', 'A')
    const relay = new WebRelay({ inspectLocal: async () => ({ machine: { key: 'local', displayName: 'This computer', projects: [{
      key: 'a', id: 'a-id', displayName: 'A', available: true, runtime: { webEndpoint: `http://127.0.0.1:${a.port}` },
    }] } }) as never })
    const origin = await relay.listen()
    openedRelays.push(relay)
    openedBackends.push(a.server)
    await relay.connect('local', 'a')
    const surfaceHost = `oa-surface-${'a'.repeat(24)}.localhost:${new URL(origin).port}`
    expect(await withHost(origin, '/surface-check', surfaceHost)).toEqual({ status: 200, body: { host: surfaceHost } })
    expect(await withHost(origin, '/relay/v1/status', surfaceHost)).toEqual({ status: 200, body: {} })
    const bad = await withHost(origin, '/surface-check', `evil.localhost:${new URL(origin).port}`)
    expect(bad.status).toBe(403)
  })
})
