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
const newerStableVersion = `${currentMajor}.${Number(currentMinor) + 1}.0`
const newerBetaVersion = `${currentMajor}.${Number(currentMinor) + 1}.0-beta.1`

const stableSource = {
  schemaVersion: 2,
  repository: 'TraderAlice/OpenAlice',
  cliVersion: currentCliVersion,
  selector: { kind: 'version', value: `v${currentCliVersion}` },
  installerUrl: `https://raw.githubusercontent.com/TraderAlice/OpenAlice/v${currentCliVersion}/install`,
  updateChannel: 'stable',
}

const betaSource = {
  ...stableSource,
  cliVersion: `${currentMajor}.${currentMinor}.0-beta.1`,
  selector: { kind: 'version', value: `v${currentMajor}.${currentMinor}.0-beta.1` },
  installerUrl: 'https://openalice.ai/install',
  updateChannel: 'beta',
}

const devSource = {
  ...stableSource,
  schemaVersion: 3,
  selector: { kind: 'branch', value: 'dev' },
  installerUrl: 'https://openalice.ai/install',
  updateChannel: 'development',
  method: 'direct',
  artifact: { platform: 'linux', arch: 'x64', sha256: 'd'.repeat(64) },
  installedAt: '2026-08-30T00:00:00Z',
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
      currentVersion: '0.87.0',
      installSource: stableSource,
    }, {
      fetchImpl: manifestFetch(newerStableVersion),
      env: {},
    })
    expect(result).toMatchObject({
      status: 'available',
      currentVersion: '0.87.0',
      latestVersion: newerStableVersion,
      channel: 'stable',
    })
  })

  it('keeps beta installs on the beta manifest and beta versions', async () => {
    const fetchImpl = manifestFetch(newerBetaVersion)
    await expect(checkForUpdate({
      currentVersion: `${currentMajor}.${currentMinor}.0-beta.1`,
      installSource: betaSource,
    }, { fetchImpl, env: {} })).resolves.toMatchObject({
      status: 'available',
      latestVersion: newerBetaVersion,
      channel: 'beta',
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://download.openalice.ai/beta/manifest.json',
      expect.any(Object),
    )
  })

  it('rejects manifests that cross the selected release channel', async () => {
    await expect(checkForUpdate({
      installSource: stableSource,
    }, { fetchImpl: manifestFetch(newerBetaVersion), env: {} }))
      .rejects.toThrow('stable update manifest advertises out-of-channel version')
    await expect(checkForUpdate({
      installSource: betaSource,
    }, { fetchImpl: manifestFetch(newerStableVersion), env: {} }))
      .rejects.toThrow('beta update manifest advertises out-of-channel version')
  })

  it('keeps exact refs and custom installers outside implicit channel updates', async () => {
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
        selector: { kind: 'branch', value: 'master' },
        installerUrl: 'https://mirror.example.test/install',
        updateChannel: 'custom',
      },
    })).resolves.toMatchObject({ status: 'unsupported', channel: 'custom' })
  })

  it('checks dev by whole-archive identity instead of package version', async () => {
    const fetchImpl = devManifestFetch({
      version: currentCliVersion,
      commit: '0123456789abcdef0123456789abcdef01234567',
      sha256: 'e'.repeat(64),
      contentIdentity: '1'.repeat(16),
    })
    await expect(checkForUpdate({ installSource: devSource, platform: 'linux', arch: 'x64' }, {
      fetchImpl,
      env: {},
    })).resolves.toMatchObject({
      status: 'available',
      channel: 'dev',
      latestArtifactSha256: 'e'.repeat(64),
      latestCommit: '0123456789abcdef0123456789abcdef01234567',
    })
    await expect(checkForUpdate({
      installSource: devSource,
      currentArtifactSha256: 'e'.repeat(64),
      platform: 'linux',
      arch: 'x64',
    }, { fetchImpl, env: {} })).resolves.toMatchObject({
      status: 'current',
      channel: 'dev',
    })

    await expect(checkForUpdate({
      installSource: {
        ...devSource,
        schemaVersion: 2,
        artifact: undefined,
        method: undefined,
        installedAt: undefined,
      },
      platform: 'linux',
      arch: 'x64',
    }, {
      fetchImpl,
      installedContentIdentityImpl: () => '1'.repeat(16),
      env: {},
    })).resolves.toMatchObject({
      status: 'available',
      channel: 'dev',
    })
  })

  it('rejects a dev target whose archive name does not match its platform', async () => {
    await expect(checkForUpdate({
      installSource: devSource,
      platform: 'linux',
      arch: 'x64',
    }, {
      fetchImpl: devManifestFetch({
        version: currentCliVersion,
        commit: '0123456789abcdef0123456789abcdef01234567',
        sha256: 'e'.repeat(64),
        contentIdentity: '1'.repeat(16),
        archive: 'openalice-cli-dev-darwin-arm64.tar.gz',
      }),
      env: {},
    })).rejects.toThrow('invalid linux-x64 target')
  })

  it('rejects a dev manifest that is not the complete four-target receipt', async () => {
    await expect(checkForUpdate({
      installSource: devSource,
      platform: 'linux',
      arch: 'x64',
    }, {
      fetchImpl: devManifestFetch({
        version: currentCliVersion,
        commit: '0123456789abcdef0123456789abcdef01234567',
        sha256: 'e'.repeat(64),
        contentIdentity: '1'.repeat(16),
        missingTarget: 'darwin-x64',
      }),
      env: {},
    })).rejects.toThrow('dev manifest is invalid')
  })

  it('treats an explicit cross-channel selection as an installable switch', async () => {
    await expect(checkForUpdate({
      currentVersion: newerStableVersion,
      installSource: stableSource,
      channel: 'beta',
    }, { fetchImpl: manifestFetch(newerBetaVersion), env: {} })).resolves.toMatchObject({
      status: 'available',
      channel: 'beta',
      sourceChannel: 'stable',
    })
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
      fetchImpl: manifestFetch(newerStableVersion),
      env: {},
    })).resolves.toMatchObject({ status: 'available', channel: 'stable' })
  })

  it('rejects a release manifest without an explicit channel', async () => {
    await expect(checkForUpdate({
      currentVersion: '0.90.1',
      installSource: stableSource,
    }, {
      fetchImpl: manifestFetch(newerStableVersion, { omitChannel: true }),
      env: {},
    })).rejects.toThrow('release manifest does not contain a valid CLI installer')
  })

  it('uses the ordinary installer only after an explicit update command', async () => {
    const applyUpdate = vi.fn(async () => 0)
    const stdout = { write: vi.fn() }
    await expect(runUpdateCommand(['--yes'], {
      applyUpdate,
      fetchImpl: manifestFetch(newerStableVersion),
      layout: { installRoot: '/tmp/.openalice' },
      readInstallSourceImpl: async () => stableSource,
      stdout,
      env: {},
    })).resolves.toBe(0)
    expect(applyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ latestVersion: newerStableVersion }),
      expect.objectContaining({
        layout: { installRoot: '/tmp/.openalice' },
        yes: true,
      }),
    )
  })

  it('leaves Railway release selection to service variables', async () => {
    const applyUpdate = vi.fn(async () => 0)
    const readInstallSourceImpl = vi.fn(async () => stableSource)
    const stdout = { write: vi.fn() }

    await expect(runUpdateCommand(['--channel', 'stable', '--yes'], {
      applyUpdate,
      readInstallSourceImpl,
      stdout,
      env: { OPENALICE_SERVICE_MANAGER: 'railway' },
    })).resolves.toBe(0)

    expect(readInstallSourceImpl).not.toHaveBeenCalled()
    expect(applyUpdate).not.toHaveBeenCalled()
    expect(stdout.write.mock.calls.flat().join('')).toContain('OPENALICE_RAILWAY_CHANNEL')
    expect(stdout.write.mock.calls.flat().join('')).toContain('did not modify')
  })

  it('routes package-managed updates back to the owner without invoking the installer', async () => {
    const applyUpdate = vi.fn(async () => 0)
    const fetchImpl = vi.fn(async () => { throw new Error('offline') })
    const stdout = { write: vi.fn() }
    await expect(runUpdateCommand([], {
      applyUpdate,
      fetchImpl,
      layout: null,
      readInstallSourceImpl: async () => ({
        ...stableSource,
        schemaVersion: 3,
        method: 'bun',
        artifact: { platform: 'darwin', arch: 'arm64', sha256: 'a'.repeat(64) },
        installedAt: '2026-08-30T00:00:00Z',
      }),
      stdout,
      env: {},
    })).resolves.toBe(0)
    expect(applyUpdate).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(stdout.write.mock.calls.flat().join('')).toContain('bun add -g --trust openalice@latest')
    expect(stdout.write.mock.calls.flat().join('')).toContain('did not modify')
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
      channel: 'beta',
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
        '--channel', 'beta', '--version', '0.88.0-beta',
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

  it('refuses a native-to-legacy stable channel switch during the 0.90.1 transition', async () => {
    await expect(checkForUpdate({
      currentVersion: '0.90.1',
      installSource: devSource,
      channel: 'stable',
    }, {
      fetchImpl: manifestFetch('0.90.1'),
      env: {},
    })).resolves.toMatchObject({
      status: 'unsupported',
      channel: 'stable',
      sourceChannel: 'dev',
      latestVersion: '0.90.1',
      message: expect.stringContaining('cannot safely replace a native CLI installation'),
    })
  })

  it('defensively refuses to execute the legacy stable installer for a native update', async () => {
    const fetchImpl = vi.fn()
    await expect(downloadAndRunInstaller({
      latestVersion: '0.90.1',
      channel: 'stable',
      installer: {
        versionedUrl: 'https://download.openalice.ai/OpenAlice-0.90.1-install',
        sha256: 'a'.repeat(64),
      },
    }, {
      layout: { installRoot: '/tmp/.openalice' },
      yes: true,
      env: { PATH: '/bin' },
      fetchImpl,
      spawnImpl: vi.fn(),
    })).rejects.toThrow('cannot safely replace a native CLI installation')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('never executes an installer whose release checksum differs', async () => {
    const spawnImpl = vi.fn()
    await expect(downloadAndRunInstaller({
      latestVersion: '0.88.0-beta',
      channel: 'beta',
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

  it('requires complete dev artifact identity before executing its installer', async () => {
    const bytes = Buffer.from('#!/usr/bin/env bash\nexit 0\n')
    const spawnImpl = vi.fn()
    await expect(downloadAndRunInstaller({
      latestVersion: currentCliVersion,
      latestCommit: '0123456789abcdef0123456789abcdef01234567',
      channel: 'dev',
      installer: {
        versionedUrl: 'https://download.openalice.ai/cli/dev/releases/0123456789abcdef/install',
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    }, {
      layout: { installRoot: '/tmp/.openalice' },
      yes: true,
      env: {},
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes,
      }),
      spawnImpl,
    })).rejects.toThrow('missing verified artifact identity')
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
      fetchImpl: manifestFetch(newerStableVersion),
      stderr,
      env: {},
      now: () => Date.parse('2026-07-29T00:00:00.000Z'),
    }
    await maybeNotifyUpdate({}, dependencies)
    await maybeNotifyUpdate({}, dependencies)
    expect(stderr.write).toHaveBeenCalledTimes(1)
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('openalice update'))
  })

  it('invalidates the startup cache when the installed artifact changes', async () => {
    let cache = null
    let source = stableSource
    const fetchImpl = manifestFetch(newerStableVersion)
    const dependencies = {
      interactive: true,
      layout: { updateCachePath: '/tmp/update-cache.json' },
      readFileImpl: async () => {
        if (cache == null) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        return cache
      },
      writeFileImpl: async (_path, value) => { cache = value },
      readInstallSourceImpl: async () => source,
      fetchImpl,
      stderr: { isTTY: true, write: vi.fn() },
      env: {},
      now: () => Date.parse('2026-07-29T00:00:00.000Z'),
    }
    await maybeNotifyUpdate({}, dependencies)
    source = {
      ...stableSource,
      schemaVersion: 3,
      cliVersion: newerStableVersion,
      selector: { kind: 'version', value: `v${newerStableVersion}` },
      method: 'direct',
      artifact: { platform: 'linux', arch: 'x64', sha256: 'f'.repeat(64) },
      installedAt: '2026-07-29T00:01:00.000Z',
    }
    await maybeNotifyUpdate({}, dependencies)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
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

function manifestFetch(version, options = {}) {
  const installer = '#!/usr/bin/env bash\n'
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ...(!options.omitChannel
        ? { channel: version.includes('-beta') ? 'beta' : 'stable' }
        : {}),
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

function devManifestFetch({
  version,
  commit,
  sha256,
  contentIdentity,
  archive = 'openalice-cli-dev-linux-x64.tar.gz',
  missingTarget = '',
}) {
  const installer = '#!/usr/bin/env bash\n'
  const targets = [
    {
      platform: 'darwin',
      arch: 'arm64',
      archive: 'openalice-cli-dev-darwin-arm64.tar.gz',
      sha256: 'a'.repeat(64),
      contentIdentity: 'aaaaaaaaaaaaaaaa',
    },
    {
      platform: 'darwin',
      arch: 'x64',
      archive: 'openalice-cli-dev-darwin-x64.tar.gz',
      sha256: 'b'.repeat(64),
      contentIdentity: 'bbbbbbbbbbbbbbbb',
    },
    {
      platform: 'linux',
      arch: 'arm64',
      archive: 'openalice-cli-dev-linux-arm64.tar.gz',
      sha256: 'c'.repeat(64),
      contentIdentity: 'cccccccccccccccc',
    },
    {
      platform: 'linux',
      arch: 'x64',
      archive,
      sha256,
      contentIdentity,
    },
  ].filter((target) => `${target.platform}-${target.arch}` !== missingTarget)
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      schemaVersion: 1,
      channel: 'dev',
      repository: 'TraderAlice/OpenAlice',
      version,
      commit,
      installer: {
        url: 'https://download.openalice.ai/install',
        versionedUrl: `https://download.openalice.ai/cli/dev/releases/${commit}/install`,
        sha256: createHash('sha256').update(installer).digest('hex'),
      },
      targets,
    }),
  }))
}
