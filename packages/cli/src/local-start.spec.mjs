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
