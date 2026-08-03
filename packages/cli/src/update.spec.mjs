import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import {
  checkForUpdate,
  compareVersions,
  downloadAndRunInstaller,
  maybeNotifyUpdate,
  parseUpdateArgs,
  runUpdateCommand,
} from './update.mjs'

const currentCliVersion = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version
const [currentMajor = '0', currentMinor = '0'] = currentCliVersion.split('.')
const newerCliVersion = `${currentMajor}.${Number(currentMinor) + 1}.0-beta`

const stableSource = {
  schemaVersion: 2,
  repository: 'TraderAlice/OpenAlice',
  cliVersion: currentCliVersion,
  selector: { kind: 'version', value: `v${currentCliVersion}` },
  installerUrl: `https://raw.githubusercontent.com/TraderAlice/OpenAlice/v${currentCliVersion}/install`,
  updateChannel: 'stable',
}

describe('OpenAlice CLI updates', () => {
  it('compares product release and prerelease versions', () => {
    expect(compareVersions('0.88.0-beta', '0.87.0-beta')).toBe(1)
    expect(compareVersions('0.87.0', '0.87.0-beta')).toBe(1)
    expect(compareVersions('0.87.0-beta.2', '0.87.0-beta.1')).toBe(1)
    expect(compareVersions('0.87.0-beta', '0.87.0-beta')).toBe(0)
    expect(compareVersions('0.86.0', '0.87.0-beta')).toBe(-1)
  })

  it('requires JSON update output to be a read-only check', () => {
    expect(parseUpdateArgs(['--check', '--json'])).toEqual({
      checkOnly: true,
      yes: false,
      json: true,
    })
    expect(() => parseUpdateArgs(['--json'])).toThrow('--json requires --check')
  })

  it('reports a newer stable product release from the download manifest', async () => {
    const result = await checkForUpdate({
      currentVersion: '0.87.0-beta',
      installSource: stableSource,
    }, {
      fetchImpl: manifestFetch(newerCliVersion),
      env: {},
    })
    expect(result).toMatchObject({
      status: 'available',
      currentVersion: '0.87.0-beta',
      latestVersion: newerCliVersion,
      channel: 'stable',
    })
  })

  it('keeps exact refs and development branches outside stable auto-update', async () => {
    await expect(checkForUpdate({
      installSource: {
        ...stableSource,
        selector: { kind: 'version', value: 'v0.87.0-beta' },
        updateChannel: 'pinned',
      },
    })).resolves.toMatchObject({ status: 'unsupported', channel: 'pinned' })
    await expect(checkForUpdate({
      installSource: {
        ...stableSource,
        selector: { kind: 'branch', value: 'dev' },
        updateChannel: 'development',
      },
    })).resolves.toMatchObject({ status: 'unsupported', channel: 'development' })
    await expect(checkForUpdate({
      installSource: {
        ...stableSource,
        selector: { kind: 'branch', value: 'master' },
        installerUrl: 'https://mirror.example.test/install',
        updateChannel: 'custom',
      },
    })).resolves.toMatchObject({ status: 'unsupported', channel: 'custom' })
  })

  it('continues to recognize legacy public-master metadata as stable', async () => {
    await expect(checkForUpdate({
      currentVersion: '0.87.0-beta',
      installSource: {
        schemaVersion: 1,
        repository: 'TraderAlice/OpenAlice',
        cliVersion: '0.87.0-beta',
        selector: { kind: 'branch', value: 'master' },
        installerUrl: 'https://openalice.ai/install',
      },
    }, {
      fetchImpl: manifestFetch(newerCliVersion),
      env: {},
    })).resolves.toMatchObject({ status: 'available', channel: 'stable' })
  })

  it('uses the ordinary installer only after an explicit update command', async () => {
    const applyUpdate = vi.fn(async () => 0)
    const stdout = { write: vi.fn() }
    await expect(runUpdateCommand(['--yes'], {
      applyUpdate,
      fetchImpl: manifestFetch(newerCliVersion),
      layout: { installRoot: '/tmp/.openalice' },
      readInstallSourceImpl: async () => stableSource,
      stdout,
      env: {},
    })).resolves.toBe(0)
    expect(applyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ latestVersion: newerCliVersion }),
      expect.objectContaining({
        layout: { installRoot: '/tmp/.openalice' },
        yes: true,
      }),
    )
  })

  it('verifies the versioned installer and binds it to the manifest version', async () => {
    const bytes = Buffer.from('#!/usr/bin/env bash\nexit 0\n')
    let invocation
    const spawnImpl = (command, args, options) => {
      invocation = { command, args, options }
      const child = new EventEmitter()
      queueMicrotask(() => child.emit('exit', 0, null))
      return child
    }
    await expect(downloadAndRunInstaller({
      latestVersion: '0.88.0-beta',
      installer: {
        versionedUrl: 'https://download.openalice.ai/OpenAlice-0.88.0-beta-install',
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    }, {
      layout: { installRoot: '/tmp/.openalice' },
      yes: true,
      env: { PATH: '/bin' },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes,
      }),
      spawnImpl,
    })).resolves.toBe(0)
    expect(invocation).toMatchObject({
      command: 'bash',
      args: expect.arrayContaining([
        '--install-dir', '/tmp/.openalice', '--no-modify-path', '--yes',
      ]),
      options: {
        stdio: 'inherit',
        env: expect.objectContaining({
          OPENALICE_EXPECTED_CLI_VERSION: '0.88.0-beta',
        }),
      },
    })
  })

  it('never executes an installer whose release checksum differs', async () => {
    const spawnImpl = vi.fn()
    await expect(downloadAndRunInstaller({
      latestVersion: '0.88.0-beta',
      installer: {
        versionedUrl: 'https://download.openalice.ai/OpenAlice-0.88.0-beta-install',
        sha256: '0'.repeat(64),
      },
    }, {
      layout: { installRoot: '/tmp/.openalice' },
      yes: false,
      env: {},
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => Buffer.from('#!/usr/bin/env bash\n'),
      }),
      spawnImpl,
    })).rejects.toThrow('SHA-256')
    expect(spawnImpl).not.toHaveBeenCalled()
  })

  it('checks silently on startup and emits at most one notice per day', async () => {
    let cache = null
    const stderr = { isTTY: true, write: vi.fn() }
    const dependencies = {
      interactive: true,
      layout: { updateCachePath: '/tmp/update-cache.json' },
      readFileImpl: async () => {
        if (cache == null) {
          const error = new Error('missing')
          error.code = 'ENOENT'
          throw error
        }
        return cache
      },
      writeFileImpl: async (_path, value) => { cache = value },
      readInstallSourceImpl: async () => stableSource,
      fetchImpl: manifestFetch(newerCliVersion),
      stderr,
      env: {},
      now: () => Date.parse('2026-07-29T00:00:00.000Z'),
    }
    await maybeNotifyUpdate({}, dependencies)
    await maybeNotifyUpdate({}, dependencies)
    expect(stderr.write).toHaveBeenCalledTimes(1)
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('openalice update'))
  })

  it('does not make startup depend on release-check availability', async () => {
    const stderr = { isTTY: true, write: vi.fn() }
    await expect(maybeNotifyUpdate({}, {
      interactive: true,
      layout: { updateCachePath: '/tmp/update-cache.json' },
      readFileImpl: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) },
      writeFileImpl: async () => undefined,
      readInstallSourceImpl: async () => stableSource,
      fetchImpl: async () => { throw new Error('offline') },
      stderr,
      env: {},
    })).resolves.toBeNull()
    expect(stderr.write).not.toHaveBeenCalled()
  })
})

function manifestFetch(version) {
  const installer = '#!/usr/bin/env bash\n'
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      version,
      releaseNotesUrl: `https://github.com/TraderAlice/OpenAlice/releases/tag/v${version}`,
      installer: {
        url: 'https://download.openalice.ai/install',
        versionedUrl: `https://download.openalice.ai/OpenAlice-${version}-install`,
        sha256: createHash('sha256').update(installer).digest('hex'),
      },
    }),
  }))
}
