import { createHash } from 'node:crypto'
import { spawnSync as realSpawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  detectLocalTarget,
  parseTargetProbe,
  posixTargetProbeCommand,
  windowsTargetProbeCommand,
} from './bootstrap-service.mjs'
import {
  deployNativeArchive,
  parseNativeBootstrapArgs,
  verifyActiveLauncher,
  verifyReleaseDirectory,
} from './native-bootstrap.mjs'

const temporaryRoots = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('native bootstrap target detection', () => {
  it('normalizes PowerShell-free Windows and POSIX probe output', () => {
    expect(windowsTargetProbeCommand()).toContain('cmd.exe /d /s /c')
    expect(windowsTargetProbeCommand()).not.toMatch(/powershell/i)
    expect(posixTargetProbeCommand()).toContain('/bin/sh')
    expect(parseTargetProbe('__OA_OS__=windows\r\n__OA_ARCH__=x86\r\n__OA_ARCH6432__=AMD64\r\n')).toEqual({
      platform: 'win32',
      arch: 'x64',
    })
    expect(parseTargetProbe('__OA_OS__=Linux\n__OA_ARCH__=aarch64\n')).toEqual({
      platform: 'linux',
      arch: 'arm64',
    })
  })

  it('uses the native process target without shell discovery', () => {
    expect(detectLocalTarget({ platform: 'win32', arch: 'x64', env: {} })).toEqual({ platform: 'win32', arch: 'x64' })
    expect(() => detectLocalTarget({ platform: 'freebsd', arch: 'x64', env: {} })).toThrow('Unsupported OpenAlice platform')
  })
})

describe('native bootstrap transaction', () => {
  it('requires explicit apply consent but allows a read-only plan', () => {
    const shared = ['deploy', '--archive', 'release.tar.gz', '--sha256', 'a'.repeat(64)]
    expect(() => parseNativeBootstrapArgs(shared, { homedirImpl: () => 'C:\\Users\\test' })).toThrow('requires --yes')
    expect(parseNativeBootstrapArgs([...shared, '--plan'], { homedirImpl: () => 'C:\\Users\\test' })).toMatchObject({
      plan: true,
      yes: false,
    })
  })
  it.runIf(process.platform === 'win32')('executes the active Windows launcher from a metacharacter path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice launcher &% test-'))
    temporaryRoots.push(root)
    const launcher = join(root, 'openalice.cmd')
    await writeFile(launcher, '@echo off\r\necho 9.8.7-beta\r\n')

    expect(() => verifyActiveLauncher(launcher, '9.8.7-beta', 'win32')).not.toThrow()
  })

  it('verifies every payload file before trusting release metadata', async () => {
    const fixture = await releaseFixture()
    await expect(verifyReleaseDirectory(fixture.releaseRoot, fixture.expectations, {
      spawnSyncImpl: fixture.spawnSync,
    })).resolves.toMatchObject({ metadata: { version: fixture.version } })
    await writeFile(join(fixture.releaseRoot, 'payload.txt'), 'tampered')
    await expect(verifyReleaseDirectory(fixture.releaseRoot, fixture.expectations, {
      spawnSyncImpl: fixture.spawnSync,
    })).rejects.toThrow('digest does not match')
  })

  it('plans without touching the install root and converges repeated apply', async () => {
    const fixture = await releaseFixture({ archive: true })
    const installRoot = join(fixture.root, 'installed')
    const base = {
      archive: fixture.archive,
      sha256: fixture.archiveSha256,
      expectedVersion: fixture.version,
      expectedContentIdentity: fixture.contentIdentity,
      channel: 'custom',
      installerUrl: 'https://openalice.ai/install',
      installRoot,
      service: 'none',
      port: 47332,
      waitSeconds: 5,
      yes: true,
      json: true,
    }
    const dependencies = {
      target: fixture.expectations.target,
      tarCommand: 'C:\\Windows\\System32\\tar.exe',
      spawnSyncImpl: fixture.spawnSync,
    }

    await expect(deployNativeArchive({ ...base, plan: true }, dependencies)).resolves.toMatchObject({
      action: 'plan',
      mutations: false,
      artifact: { sha256: fixture.archiveSha256 },
    })
    await expect(stat(installRoot)).rejects.toMatchObject({ code: 'ENOENT' })

    const first = await deployNativeArchive({ ...base, plan: false }, dependencies)
    expect(first).toMatchObject({
      status: 'installed',
      artifact: { version: fixture.version, contentIdentity: fixture.contentIdentity },
      service: { manager: 'none', state: 'disabled' },
    })
    const provenancePath = join(installRoot, 'cli', 'provenance', `${first.install.release}.json`)
    const installedAt = JSON.parse(await readFile(provenancePath, 'utf8')).installedAt

    const second = await deployNativeArchive({ ...base, plan: false }, dependencies)
    expect(second.status).toBe('unchanged')
    expect(JSON.parse(await readFile(provenancePath, 'utf8')).installedAt).toBe(installedAt)
    expect(JSON.parse(await readFile(join(installRoot, 'deployment', 'latest.json'), 'utf8'))).toMatchObject({
      status: 'unchanged',
      install: { release: first.install.release },
    })
  })
})

async function releaseFixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'openalice-native-bootstrap-test-'))
  temporaryRoots.push(root)
  const version = '9.8.7-beta'
  const contentIdentity = '0123456789abcdef'
  const topLevel = `openalice-cli-${version}-win32-x64`
  const releaseRoot = join(root, topLevel)
  await mkdir(join(releaseRoot, 'bin'), { recursive: true })
  await writeFile(join(releaseRoot, 'bin', 'openalice.exe'), 'fixture executable')
  await writeFile(join(releaseRoot, 'payload.txt'), 'verified payload')
  const files = []
  for (const path of ['bin/openalice.exe', 'payload.txt']) {
    const bytes = await readFile(join(releaseRoot, ...path.split('/')))
    files.push({ path, type: 'file', bytes: bytes.length, mode: 0o644, sha256: sha256(bytes) })
  }
  await writeFile(join(releaseRoot, 'release.json'), `${JSON.stringify({
    schemaVersion: 1,
    product: 'OpenAlice CLI',
    version,
    platform: 'win32',
    arch: 'x64',
    files,
    contentIdentity,
  }, null, 2)}\n`)
  const expectations = {
    target: { platform: 'win32', arch: 'x64' },
    topLevel,
    expectedVersion: version,
    expectedContentIdentity: contentIdentity,
  }
  const spawnSync = (command, args, spawnOptions) => {
    if (String(command).toLowerCase().endsWith('tar.exe')) return realSpawnSync(command, args, spawnOptions)
    return { status: 0, stdout: `${version}\n`, stderr: '' }
  }
  if (!options.archive) return { root, releaseRoot, version, contentIdentity, expectations, spawnSync }
  const archive = join(root, `${topLevel}.tar.gz`)
  const archived = realSpawnSync('C:\\Windows\\System32\\tar.exe', ['-czf', archive, '-C', root, topLevel], { encoding: 'utf8' })
  if (archived.status !== 0) throw new Error(archived.stderr)
  const archiveSha256 = sha256(await readFile(archive))
  return { root, releaseRoot, version, contentIdentity, expectations, spawnSync, archive, archiveSha256 }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}
