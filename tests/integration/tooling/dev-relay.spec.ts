import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveAliceProjectIdentity } from '../../../packages/cli/src/alice-project.ts'
import { registerMachine } from '../../../packages/cli/src/machine-registry.ts'
import { WebRelay, readStartupTarget } from '../../../packages/cli/src/web-relay.ts'
import { createDevRelay } from '../../../scripts/guardian/dev-relay.ts'

const remoteState = vi.hoisted(() => ({
  runSshCommand: vi.fn<(...args: unknown[]) => Promise<string>>(),
  connectSsh: vi.fn<(...args: unknown[]) => Promise<number>>(),
}))

vi.mock('../../../packages/cli/src/remote.mjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../packages/cli/src/remote.mjs')>()
  return {
    ...actual,
    runSshCommand: (...args: unknown[]) => remoteState.runSshCommand(...args),
  }
})

vi.mock('../../../packages/cli/src/ssh-connect.mjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../packages/cli/src/ssh-connect.mjs')>()
  return {
    ...actual,
    connectSsh: (...args: unknown[]) => remoteState.connectSsh(...args),
  }
})

// Never consult the developer's installed Desktop preferences during integration tests.
vi.mock('../../../packages/cli/src/supervisor-default-migration.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../packages/cli/src/supervisor-default-migration.ts')>()
  return {
    ...actual,
    migrateSupervisorDefault: (
      root: string,
      config: Parameters<typeof actual.migrateSupervisorDefault>[1],
      save: Parameters<typeof actual.migrateSupervisorDefault>[2],
      desktopPath?: string,
    ) => actual.migrateSupervisorDefault(root, config, save, desktopPath ?? join(root, 'fixture-desktop-preferences.json')),
  }
})

interface BackendFixture {
  server: Server
  port: number
  id: string
}

const openedRelays: WebRelay[] = []
const openedServers: Server[] = []
const tempDirs: string[] = []
const previousSupervisorHome = process.env['OPENALICE_SUPERVISOR_HOME']

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function startBackend(id: string, label: string): Promise<BackendFixture> {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/auth/status') {
      res.end(JSON.stringify({ authed: true, tokenConfigured: false }))
    } else if (req.url === '/api/alice-project') {
      res.end(JSON.stringify({ project: { id } }))
    } else if (req.url === '/api/who') {
      res.end(JSON.stringify({ label }))
    } else {
      res.end('{}')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  openedServers.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing backend port')
  return { server, port: address.port, id }
}

function remoteInventoryEnvelope(remoteId: string, remotePort: number): string {
  return JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    machine: {
      key: 'cloud',
      displayName: 'Cloud Host',
      registered: true,
      connection: 'online',
      sshTarget: 'cloud-host',
      platform: 'linux',
      arch: 'x64',
      hostname: 'cloud.example',
      cliVersion: '0.95.0',
      defaultProject: 'research',
      projects: [{
        key: 'research',
        id: remoteId,
        displayName: 'Research',
        home: '/srv/openalice/research',
        port: remotePort,
        portAutomatic: false,
        product: 'trader',
        isDefault: true,
        available: true,
        runtime: {
          class: 'running',
          state: 'running',
          ownerSurface: 'cli-server',
          uptimeSeconds: 12,
          webEndpoint: `http://127.0.0.1:${remotePort}`,
          components: {},
        },
      }],
      capabilities: {
        inspect: true,
        lifecycle: true,
        openTunnel: true,
        transferReceive: true,
        credentialReseal: true,
      },
      issue: null,
    },
  })
}

function mockOnlineRemote(remoteId: string, remotePort: number): void {
  remoteState.runSshCommand.mockImplementation(async () => remoteInventoryEnvelope(remoteId, remotePort))
  remoteState.connectSsh.mockImplementation(async (options) => {
    const opts = options as {
      signal?: AbortSignal
      onReady?: (value: { localUrl: string }) => void
    }
    opts.onReady?.({ localUrl: `http://127.0.0.1:${remotePort}` })
    await new Promise<void>((resolve) => {
      if (opts.signal?.aborted) {
        resolve()
        return
      }
      opts.signal?.addEventListener('abort', () => resolve(), { once: true })
    })
    return 0
  })
}

async function writeSupervisorConfig(
  supervisorRoot: string,
  defaultTarget: { machine: string; project: string } | null,
  localHome: string,
): Promise<void> {
  await writeFile(
    join(supervisorRoot, 'config.json'),
    `${JSON.stringify({
      schemaVersion: 3,
      defaultTarget,
      defaults: { home: localHome },
    }, null, 2)}\n`,
    'utf8',
  )
}

async function setupFixture() {
  const supervisorRoot = await createTempDir('dev-relay-supervisor-')
  const localHome = await createTempDir('dev-relay-local-home-')
  process.env['OPENALICE_SUPERVISOR_HOME'] = supervisorRoot

  const localId = resolveAliceProjectIdentity({ home: localHome, key: 'default' }).id
  const remoteId = resolveAliceProjectIdentity({ home: '/srv/openalice/research', key: 'research' }).id
  const localBackend = await startBackend(localId, 'local-dev')
  const remoteBackend = await startBackend(remoteId, 'remote-research')

  await registerMachine({ key: 'cloud', displayName: 'Cloud Host', sshTarget: 'cloud-host' }, { supervisorRoot })

  return {
    supervisorRoot,
    localHome,
    localId,
    remoteId,
    localBackend,
    remoteBackend,
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  remoteState.runSshCommand.mockReset()
  remoteState.connectSsh.mockReset()
})

afterEach(async () => {
  await Promise.all(openedRelays.splice(0).map((relay) => relay.close()))
  await Promise.all(openedServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  if (previousSupervisorHome === undefined) delete process.env['OPENALICE_SUPERVISOR_HOME']
  else process.env['OPENALICE_SUPERVISOR_HOME'] = previousSupervisorHome
})

describe('createDevRelay startup target persistence', () => {
  it('connects to a saved remote target with remember: false and leaves saved startup target untouched', async () => {
    const { supervisorRoot, localHome, localId, remoteId, localBackend, remoteBackend } = await setupFixture()
    const savedTarget = { machine: 'cloud', project: 'research' }
    await writeSupervisorConfig(supervisorRoot, savedTarget, localHome)
    mockOnlineRemote(remoteId, remoteBackend.port)

    const connectSpy = vi.spyOn(WebRelay.prototype, 'connect')
    const beforeConfig = await readFile(join(supervisorRoot, 'config.json'), 'utf8')

    const relay = await createDevRelay({
      home: localHome,
      projectId: localId,
      projectName: 'Default AliceProject',
      backendPort: localBackend.port,
      uiPort: 0,
      vitePort: 5174,
    })
    openedRelays.push(relay)

    expect(connectSpy).toHaveBeenCalledTimes(1)
    expect(connectSpy).toHaveBeenCalledWith('cloud', 'research', { remember: false })
    expect(relay.status.target).toMatchObject({ machine: 'cloud', project: 'research' })
    expect(relay.status.defaultSaveError).toBeNull()
    expect(await (await fetch(`${relay.originUrl}/api/who`)).json()).toEqual({ label: 'remote-research' })
    expect(await readStartupTarget({ supervisorRoot })).toEqual(savedTarget)
    expect(await readFile(join(supervisorRoot, 'config.json'), 'utf8')).toBe(beforeConfig)
  })

  it('calls setStartupError and falls back to local with remember: false when saved remote target is unreachable', async () => {
    const { supervisorRoot, localHome, localId, localBackend } = await setupFixture()
    const savedTarget = { machine: 'cloud', project: 'research' }
    await writeSupervisorConfig(supervisorRoot, savedTarget, localHome)
    remoteState.runSshCommand.mockRejectedValue(new Error('ssh: connect to host cloud-host port 22: Connection refused'))

    const connectSpy = vi.spyOn(WebRelay.prototype, 'connect')
    const setStartupErrorSpy = vi.spyOn(WebRelay.prototype, 'setStartupError')

    const relay = await createDevRelay({
      home: localHome,
      projectId: localId,
      projectName: 'Default AliceProject',
      backendPort: localBackend.port,
      uiPort: 0,
      vitePort: 5174,
    })
    openedRelays.push(relay)

    expect(connectSpy).toHaveBeenNthCalledWith(1, 'cloud', 'research', { remember: false })
    expect(setStartupErrorSpy).toHaveBeenCalledOnce()
    expect(connectSpy).toHaveBeenNthCalledWith(2, 'local', 'default', { remember: false })
    expect(relay.status.target).toMatchObject({ machine: 'local', project: 'default' })
    expect(relay.status.defaultSaveError).toBeTruthy()
    expect(await relay.startupPreference()).toEqual({
      target: savedTarget,
      error: relay.status.defaultSaveError,
    })
    expect(await (await fetch(`${relay.originUrl}/api/who`)).json()).toEqual({ label: 'local-dev' })
    expect(await readStartupTarget({ supervisorRoot })).toEqual(savedTarget)
  })

  it('connects to local with remember: false when explicitLocalTarget is true without overwriting a saved remote target', async () => {
    const { supervisorRoot, localHome, localId, localBackend } = await setupFixture()
    const savedTarget = { machine: 'cloud', project: 'research' }
    await writeSupervisorConfig(supervisorRoot, savedTarget, localHome)

    const isolatedHome = await createTempDir('dev-relay-isolated-')
    const isolatedId = resolveAliceProjectIdentity({ home: isolatedHome, key: 'default' }).id
    const isolatedBackend = await startBackend(isolatedId, 'isolated-dev')

    const connectSpy = vi.spyOn(WebRelay.prototype, 'connect')

    const isolatedRelay = await createDevRelay({
      home: isolatedHome,
      projectId: isolatedId,
      projectName: 'Isolated AliceProject',
      backendPort: isolatedBackend.port,
      uiPort: 0,
      vitePort: 5174,
      explicitLocalTarget: true,
    })
    openedRelays.push(isolatedRelay)

    expect(remoteState.runSshCommand).not.toHaveBeenCalled()
    expect(connectSpy).toHaveBeenCalledWith('local', expect.stringMatching(/^dev_[a-f0-9]{8}$/), { remember: false })
    expect(isolatedRelay.status.target?.machine).toBe('local')
    expect(isolatedRelay.status.target?.project).toMatch(/^dev_[a-f0-9]{8}$/)
    expect(await (await fetch(`${isolatedRelay.originUrl}/api/who`)).json()).toEqual({ label: 'isolated-dev' })
    expect(await readStartupTarget({ supervisorRoot })).toEqual(savedTarget)

    // Also covers explicit OPENALICE_PROJECT targeting an existing registered local project.
    connectSpy.mockClear()
    const explicitProjectRelay = await createDevRelay({
      home: localHome,
      projectId: localId,
      projectName: 'Default AliceProject',
      backendPort: localBackend.port,
      uiPort: 0,
      vitePort: 5174,
      explicitLocalTarget: true,
    })
    openedRelays.push(explicitProjectRelay)

    expect(remoteState.runSshCommand).not.toHaveBeenCalled()
    expect(connectSpy).toHaveBeenCalledWith('local', 'default', { remember: false })
    expect(explicitProjectRelay.status.target).toMatchObject({ machine: 'local', project: 'default' })
    expect(await readStartupTarget({ supervisorRoot })).toEqual(savedTarget)
  })

  it('connects to local with remember: false when no saved target exists', async () => {
    const { supervisorRoot, localHome, localId, localBackend } = await setupFixture()
    await writeSupervisorConfig(supervisorRoot, null, localHome)

    const connectSpy = vi.spyOn(WebRelay.prototype, 'connect')

    const relay = await createDevRelay({
      home: localHome,
      projectId: localId,
      projectName: 'Default AliceProject',
      backendPort: localBackend.port,
      uiPort: 0,
      vitePort: 5174,
    })
    openedRelays.push(relay)

    expect(connectSpy).toHaveBeenCalledTimes(1)
    expect(connectSpy).toHaveBeenCalledWith('local', 'default', { remember: false })
    expect(relay.status.target).toMatchObject({ machine: 'local', project: 'default' })
    expect(relay.status.defaultSaveError).toBeNull()
    expect(await (await fetch(`${relay.originUrl}/api/who`)).json()).toEqual({ label: 'local-dev' })
    expect(await readStartupTarget({ supervisorRoot })).toBeNull()
  })

  it('connects directly when saved target matches local devKey without rewriting config', async () => {
    const { supervisorRoot, localHome, localId, localBackend } = await setupFixture()
    const savedTarget = { machine: 'local', project: 'default' }
    await writeSupervisorConfig(supervisorRoot, savedTarget, localHome)

    const connectSpy = vi.spyOn(WebRelay.prototype, 'connect')
    const setStartupErrorSpy = vi.spyOn(WebRelay.prototype, 'setStartupError')
    const beforeConfig = await readFile(join(supervisorRoot, 'config.json'), 'utf8')

    const relay = await createDevRelay({
      home: localHome,
      projectId: localId,
      projectName: 'Default AliceProject',
      backendPort: localBackend.port,
      uiPort: 0,
      vitePort: 5174,
    })
    openedRelays.push(relay)

    expect(connectSpy).toHaveBeenCalledTimes(1)
    expect(connectSpy).toHaveBeenCalledWith('local', 'default', { remember: false })
    expect(setStartupErrorSpy).not.toHaveBeenCalled()
    expect(relay.status.target).toMatchObject({ machine: 'local', project: 'default' })
    expect(relay.status.defaultSaveError).toBeNull()
    expect(await readFile(join(supervisorRoot, 'config.json'), 'utf8')).toBe(beforeConfig)
  })

  it('persists explicit POST /relay/v1/connect switches to remote and existing local projects', async () => {
    const { supervisorRoot, localHome, localId, remoteId, localBackend, remoteBackend } = await setupFixture()
    await writeSupervisorConfig(supervisorRoot, null, localHome)
    mockOnlineRemote(remoteId, remoteBackend.port)

    const relay = await createDevRelay({
      home: localHome,
      projectId: localId,
      projectName: 'Default AliceProject',
      backendPort: localBackend.port,
      uiPort: 0,
      vitePort: 5174,
    })
    openedRelays.push(relay)

    expect(await readStartupTarget({ supervisorRoot })).toBeNull()

    const switchToRemote = await fetch(`${relay.originUrl}/relay/v1/connect`, {
      method: 'POST',
      headers: {
        origin: relay.originUrl,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ machine: 'cloud', project: 'research' }),
    })
    expect(switchToRemote.status).toBe(200)
    expect(relay.status.target).toMatchObject({ machine: 'cloud', project: 'research' })
    expect(await readStartupTarget({ supervisorRoot })).toEqual({ machine: 'cloud', project: 'research' })

    const switchToLocal = await fetch(`${relay.originUrl}/relay/v1/connect`, {
      method: 'POST',
      headers: {
        origin: relay.originUrl,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ machine: 'local', project: 'default' }),
    })
    expect(switchToLocal.status).toBe(200)
    expect(relay.status.target).toMatchObject({ machine: 'local', project: 'default' })
    expect(await readStartupTarget({ supervisorRoot })).toEqual({ machine: 'local', project: 'default' })

    // Ephemeral --home targets still never overwrite saved Default when re-selected.
    const isolatedHome = await createTempDir('dev-relay-ephemeral-')
    await mkdir(isolatedHome, { recursive: true })
    const isolatedId = resolveAliceProjectIdentity({ home: isolatedHome, key: 'default' }).id
    const isolatedBackend = await startBackend(isolatedId, 'ephemeral-dev')
    const isolatedRelay = await createDevRelay({
      home: isolatedHome,
      projectId: isolatedId,
      projectName: 'Isolated AliceProject',
      backendPort: isolatedBackend.port,
      uiPort: 0,
      vitePort: 5174,
      explicitLocalTarget: true,
    })
    openedRelays.push(isolatedRelay)

    const ephemeralKey = isolatedRelay.status.target!.project
    const switchEphemeralLocal = await fetch(`${isolatedRelay.originUrl}/relay/v1/connect`, {
      method: 'POST',
      headers: {
        origin: isolatedRelay.originUrl,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ machine: 'local', project: ephemeralKey }),
    })
    expect(switchEphemeralLocal.status).toBe(200)
    expect(await readStartupTarget({ supervisorRoot })).toEqual({ machine: 'local', project: 'default' })
  })
})
