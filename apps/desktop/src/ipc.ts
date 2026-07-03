import { ipcMain, type WebContents } from 'electron'
import type { ChildProcess, Serializable } from 'node:child_process'
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, normalize, resolve, sep } from 'node:path'

interface WorkspaceMeta {
  readonly id: string
  readonly dir: string
}

interface FileEntry {
  readonly name: string
  readonly kind: 'file' | 'dir' | 'symlink' | 'other'
  readonly sizeBytes: number | null
  readonly mtime: string
}

export interface OpenAliceIpcOptions {
  readonly mode: 'electron-dev' | 'electron-packaged'
  readonly userDataHome: string
  readonly appHome: string
  readonly webPort: number | null
  readonly mcpPort: number | null
  readonly utaPort: number
  readonly getAliceProcess: () => ChildProcess | null
}

const MSG_WEB_REQUEST = 'openalice:web:request'
const MSG_WEB_RESPONSE = 'openalice:web:response'
const MSG_PTY_CONNECT = 'openalice:pty:connect'
const MSG_PTY_CLIENT = 'openalice:pty:client-message'
const MSG_PTY_CLIENT_CLOSE = 'openalice:pty:client-close'
const MSG_PTY_SERVER = 'openalice:pty:server-message'
const MSG_PTY_SERVER_CLOSE = 'openalice:pty:server-close'

interface PtyConnection {
  readonly sender: WebContents
}

const ptyConnections = new Map<string, PtyConnection>()
const pendingWebRequests = new Map<string, {
  readonly resolve: (res: Response) => void
  readonly reject: (err: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}>()

class WorkspacePathTraversal extends Error {
  constructor(readonly attempted: string) {
    super(`refused to escape workspace: ${attempted}`)
    this.name = 'WorkspacePathTraversal'
  }
}

function workspaceLauncherRoot(): string {
  return resolve(process.env['AQ_LAUNCHER_ROOT'] ?? join(homedir(), '.openalice', 'workspaces'))
}

function validWorkspaceId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 128
}

function validRelPath(path: unknown): path is string {
  return typeof path === 'string' && path.length <= 4096
}

async function readWorkspaceMeta(id: string): Promise<WorkspaceMeta | null> {
  const registryPath = resolve(workspaceLauncherRoot(), 'workspaces.json')
  const raw = await readFile(registryPath, 'utf8')
  const parsed = JSON.parse(raw) as { workspaces?: unknown[] }
  const rows = Array.isArray(parsed.workspaces) ? parsed.workspaces : []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const rec = row as Record<string, unknown>
    if (rec['id'] === id && typeof rec['dir'] === 'string') {
      return { id, dir: rec['dir'] }
    }
  }
  return null
}

function resolveInsideWorkspace(workspaceDir: string, relPath: string): string {
  const cleanRel = normalize(relPath || '.')
  if (isAbsolute(cleanRel) || cleanRel === '..' || cleanRel.startsWith(`..${sep}`)) {
    throw new WorkspacePathTraversal(relPath)
  }
  const abs = resolve(workspaceDir, cleanRel)
  const workspaceAbs = resolve(workspaceDir)
  if (abs !== workspaceAbs && !abs.startsWith(workspaceAbs + sep)) {
    throw new WorkspacePathTraversal(relPath)
  }
  return abs
}

async function assertRealPathInsideWorkspace(workspaceDir: string, abs: string, relPath: string): Promise<void> {
  const [workspaceReal, targetReal] = await Promise.all([
    realpath(workspaceDir),
    realpath(abs),
  ])
  if (targetReal !== workspaceReal && !targetReal.startsWith(workspaceReal + sep)) {
    throw new WorkspacePathTraversal(relPath)
  }
}

async function listWorkspaceDir(workspaceDir: string, relPath: string): Promise<{ path: string; entries: FileEntry[] }> {
  const cleanRel = normalize(relPath || '.')
  const abs = resolveInsideWorkspace(workspaceDir, relPath)
  await assertRealPathInsideWorkspace(workspaceDir, abs, relPath)
  const dirStat = await stat(abs)
  if (!dirStat.isDirectory()) throw new Error(`not a directory: ${cleanRel}`)
  const names = await readdir(abs)
  const entries: FileEntry[] = []
  for (const name of names) {
    try {
      const ls = await lstat(resolve(abs, name))
      const kind: FileEntry['kind'] = ls.isSymbolicLink()
        ? 'symlink'
        : ls.isDirectory()
          ? 'dir'
          : ls.isFile()
            ? 'file'
            : 'other'
      entries.push({
        name,
        kind,
        sizeBytes: ls.isFile() ? ls.size : null,
        mtime: ls.mtime.toISOString(),
      })
    } catch {
      // Skip entries that disappear or become unreadable mid-list.
    }
  }
  entries.sort((a, b) => {
    if (a.kind === 'dir' && b.kind !== 'dir') return -1
    if (a.kind !== 'dir' && b.kind === 'dir') return 1
    return a.name.localeCompare(b.name)
  })
  return { path: cleanRel === '.' ? '' : cleanRel, entries }
}

function isENOENT(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'ENOENT'
}

/**
 * Register Electron-only transports exposed through preload.ts.
 *
 * The HTTP/WS backend remains the compatibility plane for dev, Docker,
 * self-hosted browsers, and future remote clients. IPC is the app-mode fast
 * path for machine-local capabilities. This module owns the Electron-main side
 * of workspace file read/list and PTY streaming; preload.ts keeps the renderer
 * surface intentionally narrower than raw ipcRenderer.
 */
export function registerOpenAliceIpc(opts: OpenAliceIpcOptions): void {
  ipcMain.handle('openalice:runtime:info', () => ({
    mode: opts.mode,
    transport: 'electron-ipc',
    ports: { web: opts.webPort, mcp: opts.mcpPort, uta: opts.utaPort },
    userDataHome: opts.userDataHome,
    appHome: opts.appHome,
  }))

  ipcMain.handle('openalice:workspace:list-files', async (_event, input: unknown) => {
    const body = input && typeof input === 'object' ? input as Record<string, unknown> : {}
    if (!validWorkspaceId(body['id']) || !validRelPath(body['path'])) {
      throw new Error('invalid workspace file request')
    }
    const meta = await readWorkspaceMeta(body['id'])
    if (!meta) throw new Error('workspace_not_found')
    return listWorkspaceDir(meta.dir, body['path'])
  })

  ipcMain.handle('openalice:workspace:read-file', async (_event, input: unknown) => {
    const body = input && typeof input === 'object' ? input as Record<string, unknown> : {}
    if (!validWorkspaceId(body['id']) || !validRelPath(body['path']) || body['path'].length === 0) {
      return { kind: 'invalid_path' }
    }
    let meta: WorkspaceMeta | null
    try {
      meta = await readWorkspaceMeta(body['id'])
    } catch (err) {
      if (isENOENT(err)) return { kind: 'workspace_missing' }
      return { kind: 'error', message: err instanceof Error ? err.message : String(err) }
    }
    if (!meta) return { kind: 'workspace_missing' }
    try {
      const abs = resolveInsideWorkspace(meta.dir, body['path'])
      await assertRealPathInsideWorkspace(meta.dir, abs, body['path'])
      const fileStat = await stat(abs)
      if (fileStat.size > 1024 * 1024) return { kind: 'too_large', sizeBytes: fileStat.size }
      const content = await readFile(abs, 'utf8')
      return { kind: 'ok', content }
    } catch (err) {
      if (err instanceof WorkspacePathTraversal) return { kind: 'invalid_path' }
      if (isENOENT(err)) return { kind: 'file_missing' }
      return { kind: 'error', message: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.on('openalice:pty:connect', (event, input: unknown) => {
    const body = input && typeof input === 'object' ? input as Record<string, unknown> : {}
    const connectionId = typeof body['connectionId'] === 'string' ? body['connectionId'] : ''
    const sessionId = typeof body['sessionId'] === 'string' ? body['sessionId'] : ''
    if (!connectionId || !sessionId) {
      event.sender.send('openalice:pty:server-event', {
        connectionId,
        event: 'close',
        code: 4000,
        reason: 'session id required',
      })
      return
    }
    console.log(`[guardian] PTY bridge connect session=${sessionId} connection=${connectionId}`)
    ptyConnections.set(connectionId, { sender: event.sender })

    const sendToAlice = (msg: Serializable): void => {
      const child = opts.getAliceProcess()
      if (!child || !child.connected) {
        event.sender.send('openalice:pty:server-event', {
          connectionId,
          event: 'close',
          code: 1011,
          reason: 'Alice IPC unavailable',
        })
        ptyConnections.delete(connectionId)
        return
      }
      child.send(msg)
    }

    event.sender.once('destroyed', () => {
      ptyConnections.delete(connectionId)
      const child = opts.getAliceProcess()
      if (child?.connected) child.send({ type: MSG_PTY_CLIENT_CLOSE, connectionId })
    })

    sendToAlice({
      type: MSG_PTY_CONNECT,
      connectionId,
      sessionId,
      cols: typeof body['cols'] === 'number' ? body['cols'] : 80,
      rows: typeof body['rows'] === 'number' ? body['rows'] : 24,
      since: typeof body['since'] === 'number' ? body['since'] : undefined,
      controllerId: typeof body['controllerId'] === 'string' ? body['controllerId'] : undefined,
      controllerKind: typeof body['controllerKind'] === 'string' ? body['controllerKind'] : 'electron',
      takeover: body['takeover'] === true,
    })
  })

  ipcMain.on('openalice:pty:client-message', (event, input: unknown) => {
    const body = input && typeof input === 'object' ? input as Record<string, unknown> : {}
    const connectionId = typeof body['connectionId'] === 'string' ? body['connectionId'] : ''
    const conn = connectionId ? ptyConnections.get(connectionId) : undefined
    if (!conn || conn.sender !== event.sender) return
    const child = opts.getAliceProcess()
    if (!child?.connected) {
      ptyConnections.delete(connectionId)
      return
    }
    if (body['type'] === 'data') {
      child.send({
        type: MSG_PTY_CLIENT,
        connectionId,
        binary: true,
        data: body['data'] as Serializable,
      })
    } else if (body['type'] === 'resize') {
      child.send({
        type: MSG_PTY_CLIENT,
        connectionId,
        binary: false,
        data: JSON.stringify({ type: 'resize', cols: body['cols'], rows: body['rows'] }),
      })
    }
  })

  ipcMain.on('openalice:pty:client-close', (event, input: unknown) => {
    const body = input && typeof input === 'object' ? input as Record<string, unknown> : {}
    const connectionId = typeof body['connectionId'] === 'string' ? body['connectionId'] : ''
    if (!connectionId) return
    const conn = ptyConnections.get(connectionId)
    if (conn && conn.sender !== event.sender) return
    ptyConnections.delete(connectionId)
    const child = opts.getAliceProcess()
    if (child?.connected) child.send({ type: MSG_PTY_CLIENT_CLOSE, connectionId })
  })
}

export async function fetchAliceWebRequest(request: Request, child: ChildProcess | null, timeoutMs = 30_000): Promise<Response> {
  if (!child || !child.connected) {
    return new Response('Alice IPC unavailable', { status: 503 })
  }
  const id = randomId()
  const method = request.method.toUpperCase()
  const body = method === 'GET' || method === 'HEAD'
    ? undefined
    : Buffer.from(await request.arrayBuffer())

  return new Promise<Response>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      pendingWebRequests.delete(id)
      rejectPromise(new Error(`Alice IPC request timed out: ${method} ${request.url}`))
    }, timeoutMs)
    pendingWebRequests.set(id, { resolve: resolvePromise, reject: rejectPromise, timer })
    child.send({
      type: MSG_WEB_REQUEST,
      id,
      method,
      url: request.url,
      headers: [...request.headers.entries()],
      ...(body ? { body } : {}),
    })
  })
}

export function handleOpenAliceIpcMessage(raw: unknown): boolean {
  const msg = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
  if (!msg || typeof msg['type'] !== 'string') return false
  if (msg['type'] === MSG_WEB_RESPONSE) {
    const id = typeof msg['id'] === 'string' ? msg['id'] : ''
    const pending = pendingWebRequests.get(id)
    if (!pending) return true
    pendingWebRequests.delete(id)
    clearTimeout(pending.timer)
    const headers = Array.isArray(msg['headers']) ? msg['headers'] as [string, string][] : []
    const status = typeof msg['status'] === 'number' ? msg['status'] : 500
    pending.resolve(new Response(coerceResponseBody(msg['body']), {
      status,
      statusText: typeof msg['statusText'] === 'string' ? msg['statusText'] : undefined,
      headers,
    }))
    return true
  }
  if (msg['type'] === MSG_PTY_SERVER) {
    const connectionId = typeof msg['connectionId'] === 'string' ? msg['connectionId'] : ''
    const conn = ptyConnections.get(connectionId)
    if (!conn) return true
    if (conn.sender.isDestroyed()) {
      ptyConnections.delete(connectionId)
      return true
    }
    conn.sender.send('openalice:pty:server-event', {
      connectionId,
      event: msg['binary'] === true ? 'data' : 'control',
      data: msg['data'],
    })
    if (msg['binary'] !== true && typeof msg['data'] === 'string' && msg['data'].includes('"type":"attached"')) {
      console.log(`[guardian] PTY bridge attached connection=${connectionId}`)
    }
    return true
  }
  if (msg['type'] === MSG_PTY_SERVER_CLOSE) {
    const connectionId = typeof msg['connectionId'] === 'string' ? msg['connectionId'] : ''
    const conn = ptyConnections.get(connectionId)
    if (!conn) return true
    if (!conn.sender.isDestroyed()) {
      conn.sender.send('openalice:pty:server-event', {
        connectionId,
        event: 'close',
        code: typeof msg['code'] === 'number' ? msg['code'] : 1000,
        reason: typeof msg['reason'] === 'string' ? msg['reason'] : '',
      })
    }
    ptyConnections.delete(connectionId)
    return true
  }
  return false
}

function coerceResponseBody(raw: unknown): BodyInit | null {
  if (raw === undefined || raw === null) return null
  if (Buffer.isBuffer(raw)) return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
  if (raw instanceof Uint8Array) return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
  if (raw instanceof ArrayBuffer) return raw
  if (typeof raw === 'string') return raw
  return new ArrayBuffer(0)
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}
