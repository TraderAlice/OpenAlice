import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildLocalRuntimeEnv,
  findOpenAliceRoot,
  parseLocalStartArgs,
  prepareSourceCheckout,
  readHomeWebPort,
  startLocal,
} from './local-start.mjs'

const temporaryPaths = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('OpenAlice local Runtime launcher', () => {
  it('parses the source path and explicit local-runtime controls', () => {
    expect(parseLocalStartArgs([
      '/tmp/OpenAlice',
      '--home', '/tmp/alice-home',
      '--port', '41000',
      '--wait', '15',
      '--rebuild',
      '--takeover',
      '--no-open',
    ])).toEqual({
      appDir: '/tmp/OpenAlice',
      homeRoot: '/tmp/alice-home',
      port: 41000,
      openBrowser: false,
      prepare: true,
      rebuild: true,
      takeover: true,
      checkUpdates: true,
      waitMs: 15_000,
    })
  })

  it('finds the repository from a nested working directory', async () => {
    const root = await makeTempDir()
    const nested = join(root, 'packages', 'example')
    await mkdir(nested, { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: 'open-alice',
      scripts: { 'build:server': 'example' },
    }))

    await expect(findOpenAliceRoot(nested)).resolves.toBe(root)
  })

  it('reuses an already-running local Runtime without spawning a second owner', async () => {
    const resolveRoot = vi.fn()
    const launchBrowser = vi.fn(async () => undefined)
    const stdout = { write: vi.fn() }

    await expect(startLocal(parseLocalStartArgs([]), {
      probeRuntime: async () => true,
      resolveRoot,
      launchBrowser,
      stdout,
    })).resolves.toBe(0)

    expect(resolveRoot).not.toHaveBeenCalled()
    expect(launchBrowser).toHaveBeenCalledWith('http://127.0.0.1:47331')
    expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining('already running'))
  })

  it('reuses a healthy same-home dev Runtime on its configured nonstandard port', async () => {
    const resolveRoot = vi.fn()
    const launchBrowser = vi.fn(async () => undefined)
    const stdout = { write: vi.fn() }
    const probeRuntime = vi.fn(async (url) => url === 'http://127.0.0.1:3002')

    await expect(startLocal(parseLocalStartArgs([]), {
      env: {},
      homeDir: '/tmp/user',
      probeRuntime,
      readRuntimeStatus: async () => ({
        class: 'owned_elsewhere',
        owner: { surface: 'dev', pid: 123 },
        endpoints: {},
      }),
      readConfiguredWebPort: async () => 3002,
      resolveRoot,
      launchBrowser,
      stdout,
    })).resolves.toBe(0)

    expect(probeRuntime).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:47331')
    expect(probeRuntime).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:3002')
    expect(resolveRoot).not.toHaveBeenCalled()
    expect(launchBrowser).toHaveBeenCalledWith('http://127.0.0.1:3002')
    expect(stdout.write).toHaveBeenCalledWith(
      expect.stringContaining(resolve('/tmp/user', '.openalice')),
    )
  })

  it('prefers an owner-advertised web endpoint over persisted port configuration', async () => {
    const launchBrowser = vi.fn(async () => undefined)
    const readConfiguredWebPort = vi.fn()

    await expect(startLocal(parseLocalStartArgs([]), {
      probeRuntime: async (url) => url === 'http://127.0.0.1:41000',
      readRuntimeStatus: async () => ({
        class: 'owned_elsewhere',
        endpoints: { web: 'http://127.0.0.1:41000' },
      }),
      readConfiguredWebPort,
      launchBrowser,
      stdout: { write: vi.fn() },
    })).resolves.toBe(0)

    expect(readConfiguredWebPort).not.toHaveBeenCalled()
    expect(launchBrowser).toHaveBeenCalledWith('http://127.0.0.1:41000')
  })

  it('reads only a valid web port from the selected home', async () => {
    await expect(readHomeWebPort('/tmp/home', {
      readFileImpl: async () => '{"web":3002}',
    })).resolves.toBe(3002)
    await expect(readHomeWebPort('/tmp/home', {
      readFileImpl: async () => '{"web":70000}',
    })).resolves.toBeNull()
  })

  it('does not inherit auth bypass or takeover into an ordinary local launch', () => {
    const runtimeEnv = buildLocalRuntimeEnv({
      OPENALICE_DISABLE_AUTH: '1',
      OPENALICE_TAKEOVER: '1',
      PATH: '/bin',
    }, {
      appDir: '/tmp/OpenAlice',
      homeRoot: '/tmp/alice-home',
      nodeBinary: '/test/node',
      port: 41000,
      takeover: false,
    })

    expect(runtimeEnv).toEqual(expect.objectContaining({
      PATH: '/bin',
      OPENALICE_BIND_HOST: '127.0.0.1',
      OPENALICE_LAUNCHER: 'cli',
    }))
    expect(runtimeEnv).not.toHaveProperty('OPENALICE_DISABLE_AUTH')
    expect(runtimeEnv).not.toHaveProperty('OPENALICE_TAKEOVER')
  })

  it('leaves the Web port unpinned when the Supervisor selected an automatic port', () => {
    const runtimeEnv = buildLocalRuntimeEnv({
      OPENALICE_WEB_PORT: '41000',
    }, {
      appDir: '/tmp/OpenAlice',
      homeRoot: '/tmp/alice-home',
      nodeBinary: '/test/node',
      port: undefined,
      takeover: false,
    })

    expect(runtimeEnv).not.toHaveProperty('OPENALICE_WEB_PORT')
  })

  it('isolates managed Pi for every local Guardian launch path', () => {
    const runtimeEnv = buildLocalRuntimeEnv({
      OPENALICE_MANAGED_PI_PATH: '/managed/pi/cli.js',
      PI_CODING_AGENT_DIR: '/native/pi',
    }, {
      appDir: '/tmp/OpenAlice',
      homeRoot: '/tmp/alice-home',
      nodeBinary: '/test/node',
      port: 41_000,
      takeover: false,
    })

    expect(runtimeEnv).toEqual(expect.objectContaining({
      PI_CODING_AGENT_DIR: join('/tmp/alice-home', 'runtime', 'pi'),
      PI_CODING_AGENT_SESSION_DIR: join('/tmp/alice-home', 'runtime', 'pi', 'sessions'),
    }))
  })

  it('starts the built Guardian on loopback and preserves explicit takeover', async () => {
    const child = new FakeChild()
    const spawnProcess = vi.fn(() => child)
    const launchBrowser = vi.fn(async () => {
      setTimeout(() => child.finish(0), 0)
    })
    const prepareSource = vi.fn(async () => ({ prepared: false }))
    const options = parseLocalStartArgs([
      '--app-dir', '/tmp/OpenAlice',
      '--home', '/tmp/alice-home',
      '--port', '41000',
      '--takeover',
    ])

    await expect(startLocal(options, {
      env: { PATH: '/bin' },
      nodeBinary: '/test/node',
      probeRuntime: async () => false,
      resolveRoot: async (path) => path,
      prepareSource,
      spawnProcess,
      waitForRuntime: async () => ({ authed: true, tokenConfigured: false }),
      launchBrowser,
      stdout: { write: vi.fn() },
    })).resolves.toBe(0)

    expect(prepareSource).toHaveBeenCalledWith('/tmp/OpenAlice', options, expect.objectContaining({
      env: { PATH: '/bin' },
    }))
    expect(spawnProcess).toHaveBeenCalledWith('/test/node', ['scripts/guardian/prod.mjs'], expect.objectContaining({
      cwd: '/tmp/OpenAlice',
      env: expect.objectContaining({
        OPENALICE_HOME: resolve('/tmp/alice-home'),
        OPENALICE_APP_HOME: '/tmp/OpenAlice',
        OPENALICE_BIND_HOST: '127.0.0.1',
        OPENALICE_WEB_PORT: '41000',
        OPENALICE_LAUNCHER: 'cli',
        OPENALICE_TAKEOVER: '1',
      }),
    }))
    expect(launchBrowser).toHaveBeenCalledWith('http://127.0.0.1:41000')
  })

  it('uses Corepack when pnpm is not installed', async () => {
    const commands = []
    let artifactsReady = false
    const missing = new Error('missing')
    missing.code = 'ENOENT'
    const runCommand = vi.fn(async (command, args) => {
      commands.push([command, args])
      if (command === 'pnpm') throw missing
      if (args.at(-1) === 'build:server') artifactsReady = true
    })

    await expect(prepareSourceCheckout('/tmp/OpenAlice', {
      prepare: true,
      rebuild: false,
    }, {
      artifactsReady: async () => artifactsReady,
      inspectBuildTools: async () => ({ platform: 'linux', supported: true, missing: [] }),
      platform: 'linux',
      runCommand,
      stdout: { write: vi.fn() },
      env: {},
    })).resolves.toEqual({ prepared: true })

    expect(commands).toEqual([
      ['pnpm', ['install', '--frozen-lockfile', '--filter=!@traderalice/desktop']],
      ['corepack', ['pnpm', 'install', '--frozen-lockfile', '--filter=!@traderalice/desktop']],
      ['corepack', ['pnpm', 'build:server']],
    ])
  })

  it('uses compact phase output and captures successful remote build noise', async () => {
    let artifactsReady = false
    const runCommand = vi.fn(async (_command, args) => {
      if (args.at(-1) === 'build:server') artifactsReady = true
    })
    const stdout = { write: vi.fn() }

    await expect(prepareSourceCheckout('/tmp/OpenAlice', {
      prepare: true,
      rebuild: false,
    }, {
      artifactsReady: async () => artifactsReady,
      inspectBuildTools: async () => ({ platform: 'linux', supported: true, missing: [] }),
      platform: 'linux',
      runCommand,
      stdout,
      env: { OPENALICE_PREPARE_OUTPUT: 'compact' },
    })).resolves.toEqual({ prepared: true })

    expect(runCommand).toHaveBeenCalledTimes(2)
    expect(runCommand.mock.calls[0][2]).toEqual(expect.objectContaining({ output: 'capture' }))
    expect(stdout.write).toHaveBeenCalledWith('Preparing the OpenAlice Server...\n')
    expect(stdout.write).toHaveBeenCalledWith('  Installing source dependencies...\n')
    expect(stdout.write).toHaveBeenCalledWith('  Building source Runtime...\n')
  })

  it('fails before pnpm with an actionable native build-tool error', async () => {
    const runCommand = vi.fn()
    await expect(prepareSourceCheckout('/tmp/OpenAlice', {
      prepare: true,
      rebuild: false,
    }, {
      artifactsReady: async () => false,
      inspectBuildTools: async () => ({
        platform: 'linux',
        supported: true,
        missing: ['python3', 'cxx'],
      }),
      platform: 'linux',
      runCommand,
      stdout: { write: vi.fn() },
      env: {},
    })).rejects.toThrow('installer with --with-runtime-deps')
    expect(runCommand).not.toHaveBeenCalled()
  })
})

async function makeTempDir() {
  const path = await mkdtemp(join(tmpdir(), 'openalice-cli-test-'))
  temporaryPaths.push(path)
  return path
}

class FakeChild extends EventEmitter {
  exitCode = null
  signalCode = null
  kill = vi.fn()

  finish(code) {
    this.exitCode = code
    this.emit('exit', code, null)
  }
}
