import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const installer = join(repositoryRoot, 'install')
const platform = process.platform === 'darwin' ? 'darwin' : 'linux'
const architecture = process.arch === 'arm64' ? 'arm64' : 'x64'
const temporaryPaths = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32')('OpenAlice native CLI installer', { timeout: 30_000 }, () => {
  it('shows a complete non-mutating plan and an explicit ownership boundary', async () => {
    const fixture = await makeReleaseArchive('0.91.0', '1'.repeat(16))
    const installRoot = join(fixture.root, 'install root')
    const result = await runInstaller(fixture, installRoot, ['--plan'])

    expect(result.stdout).toContain('OpenAlice CLI install plan')
    expect(result.stdout).toContain('OpenAlice does not manage: Agent Runtime executables')
    expect(result.stdout).toContain('Plan complete. No files were changed.')
    await expect(access(installRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('installs one native release, provenance, dynamic launchers, and no Agent Runtime', async () => {
    const fixture = await makeReleaseArchive('0.91.0', '2'.repeat(16))
    const installRoot = join(fixture.root, 'install root')
    const result = await runInstaller(fixture, installRoot, ['--yes'])
    const releaseName = `0.91.0-${platform}-${architecture}-${'2'.repeat(16)}`

    expect(result.stdout).toContain('Agent Runtimes remain user-owned')
    expect(await readlink(join(installRoot, 'cli', 'current'))).toBe(`releases/${releaseName}`)
    expect(JSON.parse(await readFile(join(installRoot, 'cli', 'activation.json'), 'utf8'))).toMatchObject({
      schemaVersion: 1,
      activeRelease: releaseName,
      previousRelease: null,
      productVersion: '0.91.0',
      state: 'pending',
    })
    const provenance = JSON.parse(await readFile(join(installRoot, 'cli', 'provenance', `${releaseName}.json`), 'utf8'))
    expect(provenance).toMatchObject({
      schemaVersion: 3,
      cliVersion: '0.91.0',
      method: 'direct',
      artifact: { platform, arch: architecture, sha256: fixture.sha256 },
    })
    const debug = await execFileAsync(join(installRoot, 'bin', 'openalice'), ['debug-env'])
    const canonicalInstallRoot = await realpath(installRoot)
    expect(debug.stdout.trim()).toBe([
      canonicalInstallRoot,
      join(canonicalInstallRoot, 'cli', 'releases', releaseName),
      join(canonicalInstallRoot, 'cli', 'provenance', `${releaseName}.json`),
      '2'.repeat(16),
      'direct',
    ].join('|'))
    for (const command of ['openalice', 'alice', 'alice-workspace', 'alice-uta', 'traderhub']) {
      await expect(access(join(installRoot, 'bin', command))).resolves.toBeUndefined()
    }
    await expect(access(join(installRoot, 'bin', 'pi'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reuses only a content-and-mode-identical installed release', async () => {
    const fixture = await makeReleaseArchive('0.91.0', 'a'.repeat(16))
    const installRoot = join(fixture.root, 'installed')
    const releaseName = `0.91.0-${platform}-${architecture}-${'a'.repeat(16)}`
    await runInstaller(fixture, installRoot, ['--yes'])

    const reused = await runInstaller(fixture, installRoot, ['--yes'])
    expect(reused.stdout).toContain(`Reusing verified release ${releaseName}.`)

    const installedIndex = join(
      installRoot,
      'cli',
      'releases',
      releaseName,
      'share',
      'openalice',
      'ui',
      'dist',
      'index.html',
    )
    await chmod(installedIndex, 0o600)
    await expect(runInstaller(fixture, installRoot, ['--yes']))
      .rejects.toMatchObject({ stderr: expect.stringContaining(`Existing release ${releaseName} is damaged`) })

    await chmod(installedIndex, 0o644)
    await writeFile(
      installedIndex,
      '<!doctype html><p>damaged</p>',
    )
    await expect(runInstaller(fixture, installRoot, ['--yes']))
      .rejects.toMatchObject({ stderr: expect.stringContaining(`Existing release ${releaseName} is damaged`) })
  })

  it('updates by activating a new immutable release while retaining rollback state', async () => {
    const first = await makeReleaseArchive('0.91.0', '3'.repeat(16))
    const second = await makeReleaseArchive('0.92.0', '4'.repeat(16))
    const installRoot = join(first.root, 'installed')
    await runInstaller(first, installRoot, ['--yes'])
    await runInstaller(second, installRoot, ['--yes'])

    expect(await readlink(join(installRoot, 'cli', 'current')))
      .toBe(`releases/0.92.0-${platform}-${architecture}-${'4'.repeat(16)}`)
    expect((await readdir(join(installRoot, 'cli', 'releases'))).sort()).toEqual([
      `0.91.0-${platform}-${architecture}-${'3'.repeat(16)}`,
      `0.92.0-${platform}-${architecture}-${'4'.repeat(16)}`,
    ])
    expect(JSON.parse(await readFile(join(installRoot, 'cli', 'activation.json'), 'utf8'))).toMatchObject({
      activeRelease: `0.92.0-${platform}-${architecture}-${'4'.repeat(16)}`,
      previousRelease: `0.91.0-${platform}-${architecture}-${'3'.repeat(16)}`,
      productVersion: '0.92.0',
      state: 'pending',
    })
    const debug = await execFileAsync(join(installRoot, 'bin', 'openalice'), ['debug-env'])
    expect(debug.stdout).toContain(`|${'4'.repeat(16)}|direct`)
  })

  it('cuts over a legacy installer only after the native launcher validates', async () => {
    const fixture = await makeReleaseArchive('0.91.0', '9'.repeat(16))
    const installRoot = join(fixture.root, 'installed')
    await mkdir(join(installRoot, 'cli-versions', 'legacy', 'managed', 'pi'), { recursive: true })
    await mkdir(join(installRoot, 'bin'), { recursive: true })
    await mkdir(join(installRoot, 'data'), { recursive: true })
    await writeFile(join(installRoot, 'bin', 'pi'), 'legacy managed Pi')
    await writeFile(join(installRoot, 'bin', 'pi.cmd'), 'legacy managed Pi')
    await writeFile(join(installRoot, 'bin', 'openalice.cmd'), 'legacy command')
    await writeFile(join(installRoot, 'data', 'preserved'), 'state')

    const result = await runInstaller(fixture, installRoot, ['--yes'])
    expect(result.stdout).toContain('Removed the validated legacy CLI release and managed-Pi launchers')
    await expect(access(join(installRoot, 'cli-versions'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(join(installRoot, 'bin', 'pi'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(installRoot, 'data', 'preserved'), 'utf8')).resolves.toBe('state')
    await expect(execFileAsync(join(installRoot, 'bin', 'openalice'), ['--version']))
      .resolves.toMatchObject({ stdout: '0.91.0\n' })
  })

  it('restores every legacy launcher when native validation fails after activation', async () => {
    const fixture = await makeReleaseArchive('0.91.0', 'b'.repeat(16), {
      failInstalledLauncher: true,
    })
    const installRoot = join(fixture.root, 'legacy rollback')
    const legacyLaunchers = {
      openalice: '#!/bin/sh\nprintf "legacy openalice\\n"\n',
      alice: 'legacy alice\n',
      'alice-workspace': 'legacy workspace\n',
      'alice-uta': 'legacy uta\n',
      traderhub: 'legacy traderhub\n',
      pi: 'legacy pi\n',
      'pi.cmd': 'legacy pi cmd\n',
      'openalice.cmd': 'legacy openalice cmd\n',
    }
    await mkdir(join(installRoot, 'cli-versions', 'legacy'), { recursive: true })
    await mkdir(join(installRoot, 'bin'), { recursive: true })
    for (const [name, contents] of Object.entries(legacyLaunchers)) {
      await writeFile(join(installRoot, 'bin', name), contents)
    }
    await chmod(join(installRoot, 'bin', 'openalice'), 0o755)

    await expect(runInstaller(fixture, installRoot, ['--yes'])).rejects.toBeTruthy()

    for (const [name, contents] of Object.entries(legacyLaunchers)) {
      await expect(readFile(join(installRoot, 'bin', name), 'utf8')).resolves.toBe(contents)
    }
    await expect(access(join(installRoot, 'cli-versions', 'legacy'))).resolves.toBeUndefined()
    await expect(access(join(installRoot, 'cli', 'current'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(JSON.parse(await readFile(join(installRoot, 'cli', 'activation.json'), 'utf8'))).toMatchObject({
      activeRelease: `0.91.0-${platform}-${architecture}-${'b'.repeat(16)}`,
      previousRelease: null,
      state: 'rolled_back',
      failureCode: 'EINSTALL',
    })
  })

  it('retains the exact pending rollback release even when retention is one', async () => {
    const first = await makeReleaseArchive('0.91.0', 'a'.repeat(16))
    const second = await makeReleaseArchive('0.92.0', 'b'.repeat(16))
    const installRoot = join(first.root, 'installed')
    await runInstaller(first, installRoot, ['--yes'], { OPENALICE_INSTALL_KEEP_RELEASES: '1' })
    await runInstaller(second, installRoot, ['--yes'], { OPENALICE_INSTALL_KEEP_RELEASES: '1' })

    expect((await readdir(join(installRoot, 'cli', 'releases'))).sort()).toEqual([
      `0.91.0-${platform}-${architecture}-${'a'.repeat(16)}`,
      `0.92.0-${platform}-${architecture}-${'b'.repeat(16)}`,
    ])
  })

  it('restores the exact previous pointer when installation fails after activation', async () => {
    const first = await makeReleaseArchive('0.91.0', 'c'.repeat(16))
    const second = await makeReleaseArchive('0.92.0', 'd'.repeat(16))
    const installRoot = join(first.root, 'installed')
    const previousName = `0.91.0-${platform}-${architecture}-${'c'.repeat(16)}`
    const failedName = `0.92.0-${platform}-${architecture}-${'d'.repeat(16)}`
    await runInstaller(first, installRoot, ['--yes'])
    await mkdir(join(installRoot, 'data'), { recursive: true })
    await writeFile(join(installRoot, 'data', 'preserved'), 'state')
    await rm(join(installRoot, 'bin', 'openalice'))
    await mkdir(join(installRoot, 'bin', 'openalice'))

    await expect(runInstaller(second, installRoot, ['--yes'])).rejects.toBeTruthy()
    expect(await readlink(join(installRoot, 'cli', 'current'))).toBe(`releases/${previousName}`)
    expect(JSON.parse(await readFile(join(installRoot, 'cli', 'activation.json'), 'utf8'))).toMatchObject({
      activeRelease: failedName,
      previousRelease: previousName,
      state: 'rolled_back',
      failureCode: 'EINSTALL',
    })
    await expect(readFile(join(installRoot, 'data', 'preserved'), 'utf8')).resolves.toBe('state')
  })

  it('rejects missing consent and a bad archive checksum before activation', async () => {
    const fixture = await makeReleaseArchive('0.91.0', '5'.repeat(16))
    const installRoot = join(fixture.root, 'installed')
    await expect(runInstaller(fixture, installRoot, [])).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining('No interactive terminal'),
    })
    await expect(runInstaller({ ...fixture, sha256: '0'.repeat(64) }, installRoot, ['--yes']))
      .rejects.toMatchObject({ stderr: expect.stringContaining('SHA-256 verification') })
    await expect(access(join(installRoot, 'cli', 'current'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('checks locking and release-comparison prerequisites before requesting consent', async () => {
    const fixture = await makeReleaseArchive('0.91.0', '5'.repeat(16))
    const lockCommand = platform === 'darwin' ? 'lockf' : 'flock'
    const cases = [
      {
        missing: lockCommand,
        message: platform === 'darwin'
          ? 'macOS lockf is required for safe concurrent installation'
          : 'Linux flock is required for safe concurrent installation',
      },
      { missing: 'diff', message: 'diff is required to verify the existing OpenAlice release' },
    ]

    for (const testCase of cases) {
      const installRoot = join(fixture.root, `missing-${testCase.missing}`)
      const path = await makeInstallerPathWithout(testCase.missing)
      await expect(runInstaller(fixture, installRoot, [], { PATH: path }))
        .rejects.toMatchObject({ stderr: expect.stringContaining(testCase.message) })
      await expect(access(installRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('recovers a stale lock and refuses to race a live installer', async () => {
    const fixture = await makeReleaseArchive('0.91.0', '6'.repeat(16))
    const installRoot = join(fixture.root, 'installed')
    const lockDir = join(installRoot, '.cli-install.lock')
    await mkdir(lockDir, { recursive: true })
    await writeFile(join(lockDir, 'pid'), '99999999\n')
    const recovered = await runInstaller(fixture, installRoot, ['--yes'])
    expect(recovered.stdout).toContain('Removing a stale CLI installer lock')

    await mkdir(lockDir)
    await writeFile(join(lockDir, 'pid'), `${process.pid}\n`)
    await expect(runInstaller(fixture, installRoot, ['--yes']))
      .rejects.toMatchObject({ stderr: expect.stringContaining('legacy lock cannot be verified') })
  })

  it('recovers an interrupted installer lock after its pid is reused by another process', async () => {
    const fixture = await makeReleaseArchive('0.91.0', '6'.repeat(16))
    const installRoot = join(fixture.root, 'installed')
    const lockDir = join(installRoot, '.cli-install.lock')
    await mkdir(lockDir, { recursive: true })
    await writeFile(join(lockDir, 'pid'), `${process.pid}\n`)
    await writeFile(join(lockDir, 'process-identity'), 'linux:stale-boot:1\n')

    const recovered = await runInstaller(fixture, installRoot, ['--yes'])

    expect(recovered.stdout).toContain('Removing a stale CLI installer lock')
  })

  it('recovers an installer lock interrupted before its owner pid was published', async () => {
    const fixture = await makeReleaseArchive('0.91.0', '6'.repeat(16))
    const installRoot = join(fixture.root, 'installed')
    const lockDir = join(installRoot, '.cli-install.lock')
    await mkdir(lockDir, { recursive: true })
    await writeFile(join(lockDir, 'process-identity'), 'linux:interrupted:1\n')
    const old = new Date(Date.now() - 5_000)
    await utimes(lockDir, old, old)

    const recovered = await runInstaller(fixture, installRoot, ['--yes'])

    expect(recovered.stdout).toContain('Removing a stale CLI installer lock')
  })

  it('recovers a legacy stale lock even when an interrupted reclaimer left its marker', async () => {
    const fixture = await makeReleaseArchive('0.91.0', '6'.repeat(16))
    const installRoot = join(fixture.root, 'installed')
    const lockDir = join(installRoot, '.cli-install.lock')
    await mkdir(join(lockDir, 'reclaiming'), { recursive: true })
    await writeFile(join(lockDir, 'pid'), '99999999\n')
    await writeFile(join(lockDir, 'process-identity'), 'linux:interrupted:1\n')

    const recovered = await runInstaller(fixture, installRoot, ['--yes'])

    expect(recovered.stdout).toContain('Removing a stale CLI installer lock')
  })

  it('serializes two installers with a kernel lock while recovering transaction markers', async () => {
    const fixture = await makeReleaseArchive('0.91.0', '6'.repeat(16), { versionDelaySeconds: 2 })
    const installRoot = join(fixture.root, 'installed')
    const lockDir = join(installRoot, '.cli-install.lock')
    const guard = join(installRoot, '.cli-install.lock.guard')
    const first = runInstaller(fixture, installRoot, ['--yes'])
    await waitForPath(lockDir)

    await expect(runInstaller(fixture, installRoot, ['--yes']))
      .rejects.toMatchObject({ stderr: expect.stringContaining('Another OpenAlice CLI installer is running') })
    await expect(first).resolves.toMatchObject({ stdout: expect.stringContaining('OpenAlice 0.91.0 is ready') })
    await expect(access(lockDir)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(guard)).resolves.toBeUndefined()
  })

  it('uses the fixed dev-channel archive and records dev provenance', async () => {
    const fixture = await makeReleaseArchive('0.92.0', '7'.repeat(16))
    const installRoot = join(fixture.root, 'installed')
    const server = createServer(async (request, response) => {
      if (request.url?.endsWith('.sha256')) {
        response.end(`${fixture.sha256}  archive.tar.gz\n`)
        return
      }
      response.end(await readFile(fixture.archive))
    })
    await new Promise((resolvePromise, rejectPromise) => {
      server.once('error', rejectPromise)
      server.listen(0, '127.0.0.1', resolvePromise)
    })
    try {
      const address = server.address()
      await execFileAsync('bash', [installer,
        '--branch', 'dev',
        '--install-dir', installRoot,
        '--no-modify-path',
        '--yes',
      ], {
        env: {
          ...process.env,
          HOME: fixture.root,
          OPENALICE_DOWNLOAD_BASE_URL: `http://127.0.0.1:${address.port}`,
        },
      })
      const [provenanceName] = await readdir(join(installRoot, 'cli', 'provenance'))
      const provenance = JSON.parse(await readFile(join(installRoot, 'cli', 'provenance', provenanceName), 'utf8'))
      expect(provenance).toMatchObject({
        selector: { kind: 'branch', value: 'dev' },
        updateChannel: 'development',
        installerUrl: 'https://raw.githubusercontent.com/TraderAlice/OpenAlice/dev/install',
      })
    } finally {
      await new Promise((resolvePromise) => server.close(resolvePromise))
    }
  })

  it('writes a sourceable PATH entry for install roots containing spaces and quotes', async () => {
    const fixture = await makeReleaseArchive('0.91.0', 'c'.repeat(16))
    const installRoot = join(fixture.root, "install root's")
    const home = join(fixture.root, 'profile home')
    await mkdir(home)

    await execFileAsync('bash', [installer,
      '--archive', fixture.archive,
      '--sha256', fixture.sha256,
      '--install-dir', installRoot,
      '--yes',
    ], {
      env: { ...process.env, HOME: home, SHELL: '/bin/bash' },
    })

    const profile = join(home, process.platform === 'darwin' ? '.bash_profile' : '.bashrc')
    const profileContents = await readFile(profile, 'utf8')
    expect(profileContents).toContain("export PATH='")
    expect(profileContents).toContain("'\\''")
    const sourced = await execFileAsync('bash', [
      '-c',
      '. "$1"; printf "%s\\n" "$PATH"',
      'openalice-path-test',
      profile,
    ], { env: { ...process.env, PATH: '/usr/bin:/bin' } })
    expect(sourced.stdout.trim().split(':')[0]).toBe(join(installRoot, 'bin'))
  })

  it.each([
    ['stable', '0.92.0'],
    ['beta', '0.92.0-beta.1'],
  ])('resolves and records the %s channel through the shared installer', async (channel, version) => {
    const fixture = await makeReleaseArchive(version, channel === 'stable' ? 'e'.repeat(16) : 'f'.repeat(16))
    const installRoot = join(fixture.root, 'installed')
    const server = createServer(async (request, response) => {
      if (request.url === '/manifest.json') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ channel: 'stable', version }))
        return
      }
      if (request.url === '/beta/manifest.json') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ channel: 'beta', version }))
        return
      }
      if (request.url?.endsWith('.sha256')) {
        response.end(`${fixture.sha256}  archive.tar.gz\n`)
        return
      }
      response.end(await readFile(fixture.archive))
    })
    await new Promise((resolvePromise, rejectPromise) => {
      server.once('error', rejectPromise)
      server.listen(0, '127.0.0.1', resolvePromise)
    })
    try {
      const address = server.address()
      const baseUrl = `http://127.0.0.1:${address.port}`
      await execFileAsync('bash', [installer,
        '--channel', channel,
        '--install-dir', installRoot,
        '--no-modify-path',
        '--yes',
      ], {
        env: {
          ...process.env,
          HOME: fixture.root,
          OPENALICE_DOWNLOAD_BASE_URL: baseUrl,
          OPENALICE_STABLE_MANIFEST_URL: `${baseUrl}/manifest.json`,
          OPENALICE_RELEASE_ASSET_BASE_URL: baseUrl,
        },
      })
      const [provenanceName] = await readdir(join(installRoot, 'cli', 'provenance'))
      const provenance = JSON.parse(await readFile(join(installRoot, 'cli', 'provenance', provenanceName), 'utf8'))
      expect(provenance).toMatchObject({
        selector: { kind: 'version', value: `v${version}` },
        updateChannel: channel,
        installerUrl: 'https://openalice.ai/install',
      })
    } finally {
      await new Promise((resolvePromise) => server.close(resolvePromise))
    }
  })

  it.each([
    ['stable', 'beta', '0.92.0', 'Stable manifest did not identify the stable channel'],
    ['beta', 'stable', '0.92.0-beta.1', 'Beta manifest did not identify the beta channel'],
  ])('rejects a %s manifest that identifies the %s release channel', async (
    selectedChannel,
    manifestChannel,
    version,
    expectedError,
  ) => {
    const root = await mkdtemp(join(tmpdir(), `openalice-${selectedChannel}-manifest-channel-`))
    temporaryPaths.push(root)
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ channel: manifestChannel, version }))
    })
    await new Promise((resolvePromise, rejectPromise) => {
      server.once('error', rejectPromise)
      server.listen(0, '127.0.0.1', resolvePromise)
    })
    try {
      const address = server.address()
      const manifestUrl = `http://127.0.0.1:${address.port}/${selectedChannel === 'stable' ? '' : 'beta/'}manifest.json`
      const manifestVariable = selectedChannel === 'stable'
        ? 'OPENALICE_STABLE_MANIFEST_URL'
        : 'OPENALICE_BETA_MANIFEST_URL'
      await expect(execFileAsync('bash', [installer,
        '--channel', selectedChannel,
        '--install-dir', join(root, 'installed'),
        '--plan',
      ], {
        env: {
          ...process.env,
          HOME: root,
          [manifestVariable]: manifestUrl,
        },
      })).rejects.toMatchObject({
        stderr: expect.stringContaining(expectedError),
      })
    } finally {
      await new Promise((resolvePromise) => server.close(resolvePromise))
    }
  })

  it('bridges stable-manifest and exact v0.90.1 installs with explicit update ownership', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-legacy-stable-'))
    temporaryPaths.push(root)
    const receipt = join(root, 'receipt.txt')
    const installRoot = join(root, 'install root')
    const legacyInstaller = Buffer.from(`#!/usr/bin/env bash
{
  printf 'url=%s\\n' "$OPENALICE_INSTALL_URL"
  printf 'install-update=%s\\n' "$OPENALICE_INSTALL_UPDATE_CHANNEL"
  printf 'installer-update=%s\\n' "$OPENALICE_INSTALLER_UPDATE_CHANNEL"
  printf 'args='
  printf '<%s>' "$@"
  printf '\\n'
} > "$OPENALICE_LEGACY_TEST_RECEIPT"
`)
    const legacySha256 = createHash('sha256').update(legacyInstaller).digest('hex')
    const server = createServer((request, response) => {
      if (request.url === '/manifest.json') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ channel: 'stable', version: '0.90.1' }))
      } else if (request.url === '/legacy-install') {
        response.end(legacyInstaller)
      } else {
        response.statusCode = 404
        response.end()
      }
    })
    await new Promise((resolvePromise, rejectPromise) => {
      server.once('error', rejectPromise)
      server.listen(0, '127.0.0.1', resolvePromise)
    })
    try {
      const address = server.address()
      const baseUrl = `http://127.0.0.1:${address.port}`
      await execFileAsync('bash', [installer,
        '--install-dir', installRoot,
        '--no-modify-path',
        '--plan',
      ], {
        env: {
          ...process.env,
          HOME: root,
          OPENALICE_STABLE_MANIFEST_URL: `${baseUrl}/manifest.json`,
          OPENALICE_LEGACY_STABLE_INSTALLER_URL: `${baseUrl}/legacy-install`,
          OPENALICE_LEGACY_STABLE_INSTALLER_SHA256: legacySha256,
          OPENALICE_LEGACY_TEST_RECEIPT: receipt,
          OPENALICE_INSTALL_UPDATE_CHANNEL: 'dev',
          OPENALICE_INSTALLER_UPDATE_CHANNEL: 'dev',
        },
      })
      expect(await readFile(receipt, 'utf8')).toBe([
        'url=https://openalice.ai/install',
        'install-update=stable',
        'installer-update=stable',
        `args=<--install-dir><${installRoot}><--no-modify-path><--plan>`,
        '',
      ].join('\n'))

      const pinnedRoot = join(root, 'pinned install')
      await execFileAsync('bash', [installer,
        '--version', '0.90.1',
        '--install-dir', pinnedRoot,
        '--no-modify-path',
        '--plan',
      ], {
        env: {
          ...process.env,
          HOME: root,
          OPENALICE_LEGACY_STABLE_INSTALLER_URL: `${baseUrl}/legacy-install`,
          OPENALICE_LEGACY_STABLE_INSTALLER_SHA256: legacySha256,
          OPENALICE_LEGACY_TEST_RECEIPT: receipt,
          OPENALICE_INSTALL_UPDATE_CHANNEL: 'dev',
          OPENALICE_INSTALLER_UPDATE_CHANNEL: 'dev',
        },
      })
      expect(await readFile(receipt, 'utf8')).toBe([
        'url=https://openalice.ai/install',
        'install-update=pinned',
        'installer-update=pinned',
        `args=<--install-dir><${pinnedRoot}><--no-modify-path><--plan>`,
        '',
      ].join('\n'))

      const channelRoot = join(root, 'stable channel install')
      await execFileAsync('bash', [installer,
        '--channel', 'stable',
        '--version', '0.90.1',
        '--install-dir', channelRoot,
        '--no-modify-path',
        '--plan',
      ], {
        env: {
          ...process.env,
          HOME: root,
          OPENALICE_LEGACY_STABLE_INSTALLER_URL: `${baseUrl}/legacy-install`,
          OPENALICE_LEGACY_STABLE_INSTALLER_SHA256: legacySha256,
          OPENALICE_LEGACY_TEST_RECEIPT: receipt,
        },
      })
      expect(await readFile(receipt, 'utf8')).toBe([
        'url=https://openalice.ai/install',
        'install-update=stable',
        'installer-update=stable',
        `args=<--install-dir><${channelRoot}><--no-modify-path><--plan>`,
        '',
      ].join('\n'))
    } finally {
      await new Promise((resolvePromise) => server.close(resolvePromise))
    }
  })

  it('refuses to replace a native CLI with the legacy v0.90.1 stable layout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-native-stable-refusal-'))
    temporaryPaths.push(root)
    const installRoot = join(root, 'native install')
    await mkdir(join(installRoot, 'cli', 'releases'), { recursive: true })
    let legacyInstallerRequests = 0
    const server = createServer((request, response) => {
      if (request.url === '/manifest.json') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ channel: 'stable', version: '0.90.1' }))
      } else if (request.url === '/legacy-install') {
        legacyInstallerRequests += 1
        response.end('#!/usr/bin/env bash\nexit 0\n')
      } else {
        response.statusCode = 404
        response.end()
      }
    })
    await new Promise((resolvePromise, rejectPromise) => {
      server.once('error', rejectPromise)
      server.listen(0, '127.0.0.1', resolvePromise)
    })
    try {
      const address = server.address()
      const baseUrl = `http://127.0.0.1:${address.port}`
      await expect(execFileAsync('bash', [installer,
        '--channel', 'stable',
        '--install-dir', installRoot,
        '--plan',
      ], {
        env: {
          ...process.env,
          HOME: root,
          OPENALICE_STABLE_MANIFEST_URL: `${baseUrl}/manifest.json`,
          OPENALICE_LEGACY_STABLE_INSTALLER_URL: `${baseUrl}/legacy-install`,
        },
      })).rejects.toMatchObject({
        stderr: expect.stringContaining('cannot safely replace a native CLI installation'),
      })
      await expect(execFileAsync('bash', [installer,
        '--version', '0.90.1',
        '--install-dir', installRoot,
        '--plan',
      ], { env: { ...process.env, HOME: root } })).rejects.toMatchObject({
        stderr: expect.stringContaining('cannot safely replace a native CLI installation'),
      })
      expect(legacyInstallerRequests).toBe(0)
    } finally {
      await new Promise((resolvePromise) => server.close(resolvePromise))
    }
  })

  it('keeps --version pinned unless an update channel is explicit', async () => {
    const fixture = await makeReleaseArchive('0.92.0', '0'.repeat(16))
    const installRoot = join(fixture.root, 'pinned')
    const server = createServer(async (request, response) => {
      if (request.url?.endsWith('.sha256')) response.end(`${fixture.sha256}  archive.tar.gz\n`)
      else response.end(await readFile(fixture.archive))
    })
    await new Promise((resolvePromise, rejectPromise) => {
      server.once('error', rejectPromise)
      server.listen(0, '127.0.0.1', resolvePromise)
    })
    try {
      const address = server.address()
      await execFileAsync('bash', [installer,
        '--version', '0.92.0',
        '--install-dir', installRoot,
        '--no-modify-path',
        '--yes',
      ], {
        env: {
          ...process.env,
          HOME: fixture.root,
          OPENALICE_RELEASE_ASSET_BASE_URL: `http://127.0.0.1:${address.port}`,
        },
      })
      const [provenanceName] = await readdir(join(installRoot, 'cli', 'provenance'))
      const provenance = JSON.parse(await readFile(join(installRoot, 'cli', 'provenance', provenanceName), 'utf8'))
      expect(provenance).toMatchObject({ updateChannel: 'pinned' })
    } finally {
      await new Promise((resolvePromise) => server.close(resolvePromise))
    }
    await expect(execFileAsync('bash', [installer, '--channel', 'beta', '--version', '0.92.0', '--plan'], {
      env: { ...process.env, HOME: fixture.root },
    })).rejects.toMatchObject({ stderr: expect.stringContaining('--channel beta requires a beta --version') })
  })

  it('accepts the v0.90.1 updater handoff as a stable install', async () => {
    const fixture = await makeReleaseArchive('0.92.0', '1'.repeat(16))
    const installRoot = join(fixture.root, 'legacy-updater')
    const server = createServer(async (request, response) => {
      if (request.url === '/manifest.json') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ channel: 'stable', version: '0.92.0' }))
      } else if (request.url?.endsWith('.sha256')) {
        response.end(`${fixture.sha256}  archive.tar.gz\n`)
      } else {
        response.end(await readFile(fixture.archive))
      }
    })
    await new Promise((resolvePromise, rejectPromise) => {
      server.once('error', rejectPromise)
      server.listen(0, '127.0.0.1', resolvePromise)
    })
    try {
      const address = server.address()
      const baseUrl = `http://127.0.0.1:${address.port}`
      await execFileAsync('bash', [installer,
        '--install-dir', installRoot,
        '--no-modify-path',
        '--yes',
      ], {
        env: {
          ...process.env,
          HOME: fixture.root,
          OPENALICE_EXPECTED_CLI_VERSION: '0.92.0',
          OPENALICE_STABLE_MANIFEST_URL: `${baseUrl}/manifest.json`,
          OPENALICE_RELEASE_ASSET_BASE_URL: baseUrl,
        },
      })
      const [provenanceName] = await readdir(join(installRoot, 'cli', 'provenance'))
      const provenance = JSON.parse(await readFile(join(installRoot, 'cli', 'provenance', provenanceName), 'utf8'))
      expect(provenance).toMatchObject({ updateChannel: 'stable' })
    } finally {
      await new Promise((resolvePromise) => server.close(resolvePromise))
    }
  })

  it('rejects conflicting selectors', async () => {
    const fixture = await makeReleaseArchive('0.91.0', '8'.repeat(16))
    await expect(execFileAsync('bash', [installer,
      '--archive', fixture.archive,
      '--version', '0.91.0',
      '--sha256', fixture.sha256,
      '--plan',
    ], { env: { ...process.env, HOME: fixture.root } })).rejects.toMatchObject({
      stderr: expect.stringContaining('--version cannot be combined with --archive'),
    })
  })
})

async function runInstaller(fixture, installRoot, extraArgs, extraEnv = {}) {
  return await execFileAsync('bash', [installer,
    '--archive', fixture.archive,
    '--sha256', fixture.sha256,
    '--install-dir', installRoot,
    '--no-modify-path',
    ...extraArgs,
  ], { env: { ...process.env, HOME: fixture.root, ...extraEnv } })
}

async function makeReleaseArchive(version, contentIdentity, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'openalice-native-installer-'))
  temporaryPaths.push(root)
  const releaseName = `openalice-cli-${version}-${platform}-${architecture}`
  const release = join(root, releaseName)
  await mkdir(join(release, 'bin'), { recursive: true })
  await mkdir(join(release, 'share', 'openalice', 'ui', 'dist'), { recursive: true })
  const executable = join(release, 'bin', 'openalice')
  const installedLauncherFailure = options.failInstalledLauncher
    ? 'if [ "${OPENALICE_INSTALL_METHOD:-}" = "direct" ]; then exit 42; fi\n'
    : ''
  const versionDelay = Number(options.versionDelaySeconds) > 0
    ? `sleep ${Number(options.versionDelaySeconds)}\n`
    : ''
  await writeFile(executable, `#!/bin/sh
set -eu
${installedLauncherFailure}if [ "\${1:-}" = "--version" ]; then ${versionDelay}printf '%s\\n' '${version}'; exit 0; fi
if [ "\${1:-}" = "debug-env" ]; then
  printf '%s|%s|%s|%s|%s\\n' "\$OPENALICE_INSTALL_ROOT" "\$OPENALICE_RELEASE_DIR" "\$OPENALICE_INSTALL_SOURCE" "\$OPENALICE_CONTENT_IDENTITY" "\$OPENALICE_INSTALL_METHOD"
  exit 0
fi
printf 'fixture %s\\n' '${version}'
`)
  await chmod(executable, 0o755)
  await writeFile(join(release, 'share', 'openalice', 'ui', 'dist', 'index.html'), '<!doctype html>')
  await writeFile(join(release, 'release.json'), `${JSON.stringify({
    schemaVersion: 1,
    version,
    platform,
    arch: architecture,
    contentIdentity,
  })}\n`)
  const archive = join(root, `${releaseName}.tar.gz`)
  await execFileAsync('tar', ['-czf', archive, '-C', root, releaseName])
  const bytes = await readFile(archive)
  return {
    root,
    archive,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

async function waitForPath(path, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await access(path)
      return
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  throw new Error(`Timed out waiting for ${path}`)
}

async function makeInstallerPathWithout(missingCommand) {
  const bin = await mkdtemp(join(tmpdir(), 'openalice-installer-path-'))
  temporaryPaths.push(bin)
  const commands = [
    'bash',
    'cat',
    'diff',
    'flock',
    'lockf',
    'sha256sum',
    'shasum',
    'sysctl',
    'tar',
    'uname',
  ]
  for (const command of commands) {
    if (command === missingCommand) continue
    const executable = await resolveExecutable(command)
    if (executable) await symlink(executable, join(bin, command))
  }
  return bin
}

async function resolveExecutable(command) {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue
    const candidate = join(directory, command)
    try {
      await access(candidate)
      return candidate
    } catch {}
  }
  return null
}
