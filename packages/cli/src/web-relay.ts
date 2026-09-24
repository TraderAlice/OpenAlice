/** One local browser relay owns exactly one active Machine/AliceProject. */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { extname, join, resolve, sep } from 'node:path'

import { isBunStandalone, resolveBunResourceRoot } from './bun-standalone.mjs'
import { inspectMachineFleet, inspectRegisteredMachine, inspectLocalMachine, type MachineInventory } from './machine-inventory.ts'
import { MachineManagement } from './machine-management.ts'
import { readMachineRegistrySummary, requireMachineEnabled } from './machine-registry.ts'
import { connectSsh, openBrowser, waitForOpenAlice } from './ssh-connect.mjs'

type ActiveTarget = {
  machine: string
  machineName: string
  project: string
  projectName: string
  endpoint: string
  inventory: { machine: MachineInventory; project: MachineInventory['projects'][number] }
  abort?: AbortController
}

const LOOPBACK = '127.0.0.1'
const MAX_BODY = 16_384
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.json': 'application/json',
}

export interface WebRelayOptions {
  port?: number
  open?: boolean
  uiRoot?: string
  inspectFleet?: typeof inspectMachineFleet
  inspectLocal?: typeof inspectLocalMachine
  inspectRegistered?: typeof inspectRegisteredMachine
  readRegistry?: typeof readMachineRegistrySummary
  connect?: typeof connectSsh
  waitReady?: typeof waitForOpenAlice
  machineManagement?: MachineManagement
}

export class WebRelay {
  private target: ActiveTarget | null = null
  private generation = 0
  private switching = false
  private readonly subscribers = new Set<ServerResponse>()
  private readonly listeners = new Set<() => void>()
  private readonly sockets = new Set<Duplex>()
  private readonly server = createServer((req, res) => void this.handle(req, res))
  private readonly options: WebRelayOptions
  private readonly machines: MachineManagement
  private origin = ''

  constructor(options: WebRelayOptions = {}) {
    this.options = options
    this.machines = options.machineManagement ?? new MachineManagement()
    this.server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head))
  }

  get status() {
    return {
      schemaVersion: 1,
      generation: this.generation,
      target: this.target && { machine: this.target.machine, machineName: this.target.machineName, project: this.target.project, projectName: this.target.projectName },
      switching: this.switching,
    }
  }

  get originUrl(): string { return this.origin }

  get machineOperationBusy(): boolean { return this.machines.busy }
  get machineOperation() { return this.machines.currentOperation }

  planMachine(input: Parameters<MachineManagement['plan']>[0]) { return this.machines.plan(input) }

  async applyMachine(id: string) {
    if (this.switching) throw new Error('Wait for the location switch to finish before applying a Machine plan.')
    const selected = this.target
    return this.machines.apply(id, async ({ machineKey }) => {
      if (!selected || this.target !== selected || selected.machine !== machineKey) return
      // A remote restart can leave an SSH forward accepting local connections
      // without forwarding them. Rebuild and verify the active transport before
      // reporting the operation complete to the browser.
      let lastError: unknown
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await this.connectTarget(selected.machine, selected.project, true)
          return
        } catch (error) {
          lastError = error
        }
      }
      if (this.target === selected) this.disconnect()
      throw new Error(`The backend updated, but this relay could not reconnect: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
    })
  }

  /** Internal selection for local presenters; never serialized to the browser. */
  get activeSelection() {
    const target = this.target
    return target && { ...target.inventory, endpoint: target.endpoint }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async listen(): Promise<string> {
    await new Promise<void>((done, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.options.port ?? 0, LOOPBACK, () => {
        this.server.off('error', reject)
        done()
      })
    })
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('Relay could not bind loopback')
    this.origin = `http://${LOOPBACK}:${address.port}`
    return this.origin
  }

  async close(): Promise<void> {
    this.target?.abort?.abort()
    for (const socket of this.sockets) socket.destroy()
    for (const response of this.subscribers) response.end()
    await new Promise<void>((done) => {
      this.server.close(() => done())
      this.server.closeAllConnections()
    })
  }

  private announce(): void {
    const message = `data: ${JSON.stringify(this.status)}\n\n`
    for (const response of this.subscribers) response.write(message)
    for (const listener of this.listeners) listener()
  }

  disconnect(): void {
    const previous = this.target
    if (!previous) return
    this.target = null
    this.generation += 1
    this.announce()
    for (const socket of this.sockets) socket.destroy()
    previous.abort?.abort()
  }

  async connect(machineKey: string, projectKey: string): Promise<void> {
    return this.connectTarget(machineKey, projectKey, false)
  }

  private async connectTarget(machineKey: string, projectKey: string, duringMachineOperation: boolean): Promise<void> {
    if (this.machines.busy && !duringMachineOperation) throw new Error('Wait for the Machine operation to finish before switching locations.')
    if (this.switching) throw new Error('Another connection switch is in progress.')
    this.switching = true
    this.announce()
    let candidateAbort: AbortController | undefined
    try {
      const machine = await this.inspectSelection(machineKey)
      const project = machine.projects.find((entry) => entry.key === projectKey)
      if (!project) throw new Error(`AliceProject "${projectKey}" is not registered on ${machine.displayName}.`)
      if (!project.available || !project.runtime.webEndpoint) {
        throw new Error(`AliceProject "${project.displayName}" is not running with a Web endpoint. Start it on that Machine first.`)
      }
      const port = loopbackPort(project.runtime.webEndpoint)
      if (port === null) throw new Error('The selected Runtime did not advertise a loopback Web endpoint.')
      let endpoint = `http://${LOOPBACK}:${port}`
      if (machineKey !== 'local') {
        if (!machine.capabilities.openTunnel || machine.connection !== 'online') throw new Error('This Machine cannot open an SSH tunnel.')
        const registry = await (this.options.readRegistry ?? readMachineRegistrySummary)()
        const saved = registry.machines.find((entry) => entry.key === machineKey)
        if (!saved) throw new Error('The Machine was removed during selection.')
        requireMachineEnabled(saved)
        candidateAbort = new AbortController()
        const controller = candidateAbort
        endpoint = await new Promise<string>((done, reject) => {
          let ready = false
          void (this.options.connect ?? connectSsh)({
            destination: saved.sshTarget,
            localPort: 0,
            remotePort: port,
            sshPort: saved.sshPort ?? null,
            identityFile: saved.identityFile ?? null,
            batchMode: true,
            openBrowser: false,
            waitMs: 15_000,
            signal: controller.signal,
            onReady: ({ localUrl }: { localUrl: string }) => { ready = true; done(localUrl) },
          }, { stdout: { write: () => undefined } }).then(() => {
            if (!ready) reject(new Error('SSH tunnel closed before connection.'))
            else if (this.target?.abort === controller) this.dropTarget()
          }, (error: unknown) => {
            if (!ready) reject(error)
            else if (this.target?.abort === controller) this.dropTarget()
          })
        })
      }
      await (this.options.waitReady ?? waitForOpenAlice)(endpoint, { timeoutMs: 5_000 })
      const identityResponse = await fetch(`${endpoint}/api/alice-project`, { signal: AbortSignal.timeout(5_000) })
      if (identityResponse.status === 401) {
        // A login-gated Runtime can still be selected. Reconfirm ownership
        // through the authenticated SSH inventory; the browser then logs in.
        const refreshed = await this.inspectSelection(machineKey)
        const matching = refreshed.projects.find((entry) => entry.key === projectKey)
        if (matching?.id !== project.id || loopbackPort(matching.runtime.webEndpoint) !== port) {
          throw new Error('The selected Runtime changed while opening the connection.')
        }
      } else {
        if (!identityResponse.ok) throw new Error('Could not verify the selected AliceProject identity.')
        const identity = await identityResponse.json() as { project?: { id?: string } }
        if (identity.project?.id !== project.id) throw new Error('The Runtime answered for a different AliceProject; connection was not switched.')
      }
      const previous = this.target
      this.target = { machine: machineKey, machineName: machine.displayName, project: projectKey, projectName: project.displayName, endpoint, inventory: { machine, project }, abort: candidateAbort }
      this.generation += 1
      this.announce()
      for (const socket of this.sockets) socket.destroy()
      previous?.abort?.abort()
    } catch (error) {
      candidateAbort?.abort()
      throw error
    } finally {
      this.switching = false
      this.announce()
    }
  }

  private dropTarget(): void {
    this.disconnect()
  }

  private async inspectSelection(key: string): Promise<MachineInventory> {
    if (key === 'local') return (await (this.options.inspectLocal ?? inspectLocalMachine)()).machine
    const registry = await (this.options.readRegistry ?? readMachineRegistrySummary)()
    const saved = registry.machines.find((entry) => entry.key === key)
    if (!saved) throw new Error(`Machine "${key}" is not registered.`)
    requireMachineEnabled(saved)
    const inspected = await (this.options.inspectRegistered ?? inspectRegisteredMachine)(saved)
    if (inspected.connection !== 'online') throw new Error(inspected.issue?.message ?? 'Machine is unavailable.')
    return inspected
  }

  private surfaceOrigin(req: IncomingMessage): string | null {
    if (!this.origin) return null
    const port = new URL(this.origin).port
    const host = req.headers.host ?? ''
    return new RegExp(`^oa-surface-[a-f0-9]{24}\\.localhost:${port}$`, 'i').test(host) ? `http://${host}` : null
  }

  private validRequest(req: IncomingMessage, mutation = false, expectedOrigin = this.origin): boolean {
    if (!expectedOrigin || req.headers.host !== new URL(expectedOrigin).host) return false
    const origin = req.headers.origin
    if (origin && origin !== expectedOrigin) return false
    if (mutation && origin !== expectedOrigin) return false
    if (mutation && req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin' && req.headers['sec-fetch-site'] !== 'none') return false
    return true
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', this.origin)
      const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? '')
      const surfaceOrigin = this.surfaceOrigin(req)
      if (surfaceOrigin) {
        if (!this.validRequest(req, mutation, surfaceOrigin)) return json(res, 403, { error: 'Surface origin rejected.' })
        return this.proxy(req, res, true)
      }
      if (!this.validRequest(req, mutation)) return json(res, 403, { error: 'Relay origin rejected.' })
      res.setHeader('cache-control', 'no-store')
      if (url.pathname === '/relay/v1/status' && req.method === 'GET') return json(res, 200, this.status)
      if (url.pathname === '/relay/v1/fleet' && req.method === 'GET') {
        return json(res, 200, await (this.options.inspectFleet ?? inspectMachineFleet)())
      }
      if (url.pathname === '/relay/v1/machines/plan' && req.method === 'POST') {
        const input = await readJsonBody(req) as Parameters<MachineManagement['plan']>[0]
        return json(res, 200, await this.planMachine(input))
      }
      if (url.pathname === '/relay/v1/machines/operation' && req.method === 'GET') {
        return json(res, 200, this.machineOperation)
      }
      if (url.pathname === '/relay/v1/machines/apply' && req.method === 'POST') {
        const input = await readJsonBody(req) as { id?: unknown }
        if (typeof input.id !== 'string') return json(res, 400, { error: 'A reviewed Machine plan is required.' })
        return json(res, 200, await this.applyMachine(input.id))
      }
      if (url.pathname === '/relay/v1/events' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
        res.write(`data: ${JSON.stringify(this.status)}\n\n`)
        this.subscribers.add(res)
        req.on('close', () => this.subscribers.delete(res))
        return
      }
      if (url.pathname === '/relay/v1/connect' && req.method === 'POST') {
        const input = await readJsonBody(req) as { machine?: unknown; project?: unknown }
        if (typeof input.machine !== 'string' || typeof input.project !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(input.machine) || !/^[a-z][a-z0-9_-]{0,63}$/.test(input.project)) {
          return json(res, 400, { error: 'Select a registered Machine and AliceProject.' })
        }
        await this.connect(input.machine, input.project)
        return json(res, 200, this.status)
      }
      if (url.pathname.startsWith('/relay/')) return json(res, 404, { error: 'Unknown relay route.' })
      if (url.pathname.startsWith('/api/') || url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
        return this.proxy(req, res)
      }
      return this.staticFile(url.pathname, res)
    } catch (error) {
      json(res, 502, { error: error instanceof Error ? error.message : String(error) })
    }
  }

  private proxy(req: IncomingMessage, res: ServerResponse, surface = false): void {
    const target = this.target
    if (!target) return json(res, 503, { error: 'No running AliceProject is connected to this relay.' })
    const generation = this.generation
    const endpoint = new URL(target.endpoint)
    const headers = upstreamHeaders(req, endpoint, target, surface)
    const upstream = httpRequest({ hostname: LOOPBACK, port: endpoint.port, method: req.method, path: req.url, headers }, (response) => {
      if (this.generation !== generation) { response.destroy(); return json(res, 409, { error: 'Relay target changed during request.' }) }
      const responseHeaders = { ...response.headers }
      delete responseHeaders['set-cookie']
      const cookies = response.headers['set-cookie']?.map((cookie) => namespaceCookie(cookie, target))
      if (cookies?.length) responseHeaders['set-cookie'] = cookies
      res.writeHead(response.statusCode ?? 502, responseHeaders)
      response.pipe(res)
    })
    upstream.on('error', (error) => { if (!res.headersSent) json(res, 502, { error: error.message }); else res.destroy(error) })
    req.pipe(upstream)
  }

  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const surfaceOrigin = this.surfaceOrigin(req)
    if (!this.validRequest(req, false, surfaceOrigin ?? this.origin) || (!surfaceOrigin && !req.url?.startsWith('/api/'))) { socket.destroy(); return }
    const target = this.target
    if (!target) { socket.destroy(); return }
    const endpoint = new URL(target.endpoint)
    const headers = upstreamHeaders(req, endpoint, target, !!surfaceOrigin)
    headers['connection'] = 'Upgrade'
    const upstream = httpRequest({ hostname: LOOPBACK, port: endpoint.port, method: 'GET', path: req.url, headers })
    upstream.on('upgrade', (response, peer, peerHead) => {
      const lines = [`HTTP/1.1 ${response.statusCode ?? 101} Switching Protocols`, ...Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`), '', '']
      socket.write(lines.join('\r\n'))
      if (peerHead.length) socket.write(peerHead)
      if (head.length) peer.write(head)
      this.sockets.add(socket)
      socket.on('close', () => { this.sockets.delete(socket); peer.destroy() })
      peer.on('close', () => socket.destroy())
      socket.pipe(peer).pipe(socket)
    })
    upstream.on('error', () => socket.destroy())
    upstream.end()
  }

  private async staticFile(pathname: string, res: ServerResponse): Promise<void> {
    const root = this.options.uiRoot ?? (isBunStandalone()
      ? join(resolveBunResourceRoot(), 'ui', 'dist')
      : resolve(import.meta.dirname, '../../../ui/dist'))
    const path = pathname.startsWith('/assets/') || /\.[a-z0-9]+$/i.test(pathname) ? resolve(root, `.${pathname}`) : join(root, 'index.html')
    if (path !== root && !path.startsWith(`${root}${sep}`)) return json(res, 404, { error: 'Not found' })
    try {
      const file = await stat(path)
      if (!file.isFile()) throw new Error('Not a file')
      res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream', 'content-length': file.size, 'cache-control': 'no-store' })
      createReadStream(path).pipe(res)
    } catch { json(res, 404, { error: 'UI bundle unavailable; build ui/dist first.' }) }
  }
}

function loopbackPort(value: string | null): number | null {
  if (!value) return null
  try {
    const url = new URL(value)
    const port = Number(url.port || '80')
    return url.protocol === 'http:' && url.hostname === LOOPBACK && Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null
  } catch { return null }
}

function namespace(target: ActiveTarget): string {
  return `alice_${target.machine.length}_${target.machine}_${target.project.length}_${target.project}_`
}

function namespaceCookie(cookie: string, target: ActiveTarget): string {
  const prefix = namespace(target)
  return cookie.replace(/^([^=;]+)=/, (_, name: string) => `${prefix}${name}=`)
}

function upstreamHeaders(req: IncomingMessage, endpoint: URL, target: ActiveTarget, surface = false): Record<string, string | string[] | undefined> {
  const headers = { ...req.headers }
  delete headers['connection']
  delete headers['proxy-connection']
  delete headers['forwarded']
  delete headers['x-forwarded-for']
  delete headers['x-forwarded-host']
  delete headers['x-forwarded-proto']
  delete headers['cookie']
  headers['host'] = surface ? req.headers.host : endpoint.host
  if (req.headers.origin && !surface) headers['origin'] = endpoint.origin
  const prefix = namespace(target)
  const cookies = (req.headers.cookie ?? '').split(';').map((part) => part.trim()).filter((part) => part.startsWith(prefix))
    .map((part) => part.slice(prefix.length))
  if (cookies.length) headers['cookie'] = cookies.join('; ')
  return headers
}

function json(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  let text = ''
  for await (const chunk of req) {
    text += String(chunk)
    if (text.length > MAX_BODY) throw new Error('Request body is too large.')
  }
  return JSON.parse(text)
}

export async function runWebRelay(args: string[]): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write('Usage: openalice relay [--port <port>] [--no-open]\nServe the local Web GUI and switch its one active Machine/AliceProject.\n')
    return 0
  }
  let port = 0
  let open = true
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--no-open') open = false
    else if (args[index] === '--port') {
      const value = Number(args[++index])
      if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new Error('--port requires a TCP port from 1 to 65535')
      port = value
    } else throw new Error(`Unknown relay option: ${args[index]}`)
  }
  const relay = new WebRelay({ port })
  const origin = await relay.listen()
  const local = (await inspectLocalMachine()).machine
  const first = local?.projects.find((project) => project.key === local.defaultProject && project.runtime.webEndpoint)
    ?? local?.projects.find((project) => project.runtime.webEndpoint)
  if (first) await relay.connect('local', first.key).catch((error: unknown) => process.stderr.write(`Local Runtime unavailable: ${String(error)}\n`))
  process.stdout.write(`OpenAlice relay: ${origin}\n`)
  if (open) await openBrowser(`${origin}/settings`)
  await new Promise<void>((done) => {
    const stop = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); void relay.close().then(done) }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
  return 0
}
