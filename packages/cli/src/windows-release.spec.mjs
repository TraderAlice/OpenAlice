import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkForUpdate, downloadAndRunInstaller, runUpdateCommand } from './update.mjs'
import { parseInstallSource } from './install-source.mjs'
import { CLI_RELEASE_TARGETS, cliArchiveName } from './release-targets.mjs'
import { resolveCurrentRelease, resolveInstalledLayout } from './install-layout.mjs'
import { activateRelease } from './rollback.mjs'

const roots = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
const installer = { url: 'https://download.openalice.ai/install', versionedUrl: 'https://download.openalice.ai/frozen/install', sha256: 'a'.repeat(64) }
const windowsInstaller = { ...installer, versionedUrl: 'https://download.openalice.ai/frozen/install.ps1', sha256: 'b'.repeat(64) }
const source = {
  schemaVersion: 3, repository: 'TraderAlice/OpenAlice', cliVersion: '0.91.0-beta.4',
  selector: { kind: 'branch', value: 'dev' }, installerUrl: windowsInstaller.url,
  updateChannel: 'development', method: 'direct', installedAt: '2026-09-04T00:00:00Z',
  artifact: { platform: 'win32', arch: 'arm64', sha256: '1'.repeat(64) },
}
function devManifest() {
  const targets = CLI_RELEASE_TARGETS.map(([platform, arch]) => ({
    platform, arch, archive: cliArchiveName('dev', platform, arch),
    sha256: '2'.repeat(64), contentIdentity: '2'.repeat(16),
  }))
  return {
    schemaVersion: 1, repository: 'TraderAlice/OpenAlice', channel: 'dev',
    version: source.cliVersion, commit: 'a'.repeat(40), installer, windowsInstaller,
    targets: targets.filter(t => t.platform !== 'win32'), additionalTargets: targets.filter(t => t.platform === 'win32'),
  }
}
function fetchDocument(document) { return async () => ({ ok: true, json: async () => document }) }

describe('Windows unified release system', () => {
  it('gives manager-owned Windows installs PowerShell channel-switch guidance', async () => {
    let output = ''
    expect(await runUpdateCommand(['--channel', 'dev', '--yes'], {
      platform: 'win32', stdout: { write: value => { output += value } },
      readInstallSourceImpl: async () => ({ ...source, method: 'npm', updateChannel: 'stable' }),
    })).toBe(0)
    expect(output).toContain('Invoke-RestMethod')
    expect(output).toContain('/dev/install.ps1')
    expect(output).toContain('-Channel dev')
    expect(output).not.toContain('curl ')
    expect(output).toContain('did not modify')
  })
  it.each(['arm64', 'x64'])('accepts schema 3 Windows %s provenance', (arch) => {
    expect(parseInstallSource({ ...source, artifact: { ...source.artifact, arch } })).toMatchObject({ method: 'direct', artifact: { platform: 'win32', arch } })
    expect(cliArchiveName('0.91.0-beta.4', 'win32', arch)).toBe(`openalice-cli-0.91.0-beta.4-win32-${arch}.tar.gz`)
  })

  it('compares dev archive identity, not equal package versions, and selects PowerShell', async () => {
    const document = devManifest()
    const result = await checkForUpdate({ currentVersion: source.cliVersion, installSource: source, platform: 'win32', arch: 'arm64' }, { fetchImpl: fetchDocument(document) })
    expect(result).toMatchObject({ status: 'available', latestVersion: source.cliVersion, latestCommit: document.commit, latestArtifactSha256: '2'.repeat(64), installer: windowsInstaller })
    expect(await checkForUpdate({ installSource: { ...source, artifact: { ...source.artifact, sha256: '2'.repeat(64) } }, platform: 'win32', arch: 'arm64' }, { fetchImpl: fetchDocument(document) })).toMatchObject({ status: 'current' })
  })

  it('keeps the four-entry legacy dev field and rejects incomplete Windows extensions', async () => {
    const document = devManifest()
    expect(document.targets).toHaveLength(4)
    document.additionalTargets.pop()
    await expect(checkForUpdate({ installSource: source, platform: 'win32', arch: 'arm64' }, { fetchImpl: fetchDocument(document) })).rejects.toThrow('incomplete')
  })

  it.each([['stable', '0.91.0'], ['beta', '0.91.0-beta.5']])('uses the existing %s version comparison with a platform installer', async (channel, version) => {
    const document = { channel, version, releaseNotesUrl: 'https://github.com/TraderAlice/OpenAlice/releases', installer, windowsInstaller }
    expect(await checkForUpdate({ currentVersion: source.cliVersion, installSource: source, channel, platform: 'win32' }, { fetchImpl: fetchDocument(document) })).toMatchObject({ status: 'available', latestVersion: version, installer: windowsInstaller })
    delete document.windowsInstaller
    await expect(checkForUpdate({ installSource: source, channel, platform: 'win32' }, { fetchImpl: fetchDocument(document) })).rejects.toThrow('not published a Windows')
  })

  it('checks immutable PowerShell bytes and uses only a process-scoped local-script policy', async () => {
    const bytes = Buffer.from('# OpenAlice Windows CLI installer\nparam()\n')
    const spawnImpl = vi.fn(() => {
      const child = new EventEmitter()
      queueMicrotask(() => child.emit('exit', 0, null))
      return child
    })
    await downloadAndRunInstaller({
      channel: 'dev', latestVersion: source.cliVersion, latestCommit: 'a'.repeat(40),
      latestArtifactSha256: '2'.repeat(64), latestContentIdentity: '2'.repeat(16),
      installer: { ...windowsInstaller, sha256: createHash('sha256').update(bytes).digest('hex') },
    }, {
      platform: 'win32', layout: { installRoot: 'C:\\Users\\Alice Test\\.openalice' }, yes: true,
      env: { SystemRoot: 'C:\\Windows', PSModulePath: 'PowerShell7-only' },
      fetchImpl: async () => ({ ok: true, arrayBuffer: async () => bytes }), spawnImpl,
    })
    const [command, args, options] = spawnImpl.mock.calls[0]
    expect(command).toContain('powershell.exe')
    expect(args).toEqual(expect.arrayContaining(['-File', '-Channel', 'dev', '-InstallDir', 'C:\\Users\\Alice Test\\.openalice', '-Yes']))
    expect(args).toEqual(expect.arrayContaining(['-ExecutionPolicy', 'RemoteSigned']))
    expect(args).not.toContain('Bypass')
    expect(options.env.PSModulePath).toBeUndefined()
    expect(options.env.OPENALICE_EXPECTED_DEV_COMMIT).toBe('a'.repeat(40))
  })

  it('atomically switches a file pointer, leaving both immutable releases untouched', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-windows-pointer-'))
    roots.push(root)
    const releases = join(root, 'cli/releases')
    await mkdir(join(releases, 'old'), { recursive: true })
    await mkdir(join(releases, 'new'))
    const layout = resolveInstalledLayout(import.meta.url, { platform: 'win32', env: { OPENALICE_INSTALL_ROOT: root, OPENALICE_RELEASE_DIR: join(releases, 'old') } })
    await writeFile(layout.currentPath, 'old\n')
    expect(await resolveCurrentRelease(layout)).toBe(await realpath(join(releases, 'old')))
    await activateRelease(layout, 'new')
    expect(await readFile(layout.currentPath, 'utf8')).toBe('new\n')
    expect(await resolveCurrentRelease(layout)).toBe(await realpath(join(releases, 'new')))
    await writeFile(layout.currentPath, '../outside\n')
    await expect(resolveCurrentRelease(layout)).rejects.toThrow('invalid')
  })
})
