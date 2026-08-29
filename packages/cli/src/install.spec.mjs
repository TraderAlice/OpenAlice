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
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
      .rejects.toMatchObject({ stderr: expect.stringContaining('installer is running') })
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

  it('rejects conflicting selectors', async () => {
    const fixture = await makeReleaseArchive('0.91.0', '8'.repeat(16))
    await expect(execFileAsync('bash', [installer,
      '--archive', fixture.archive,
      '--version', '0.91.0',
      '--sha256', fixture.sha256,
      '--plan',
    ], { env: { ...process.env, HOME: fixture.root } })).rejects.toMatchObject({
      stderr: expect.stringContaining('Use only one of --branch, --version, or --archive'),
    })
  })
})

async function runInstaller(fixture, installRoot, extraArgs) {
  return await execFileAsync('bash', [installer,
    '--archive', fixture.archive,
    '--sha256', fixture.sha256,
    '--install-dir', installRoot,
    '--no-modify-path',
    ...extraArgs,
  ], { env: { ...process.env, HOME: fixture.root } })
}

async function makeReleaseArchive(version, contentIdentity) {
  const root = await mkdtemp(join(tmpdir(), 'openalice-native-installer-'))
  temporaryPaths.push(root)
  const releaseName = `openalice-cli-${version}-${platform}-${architecture}`
  const release = join(root, releaseName)
  await mkdir(join(release, 'bin'), { recursive: true })
  await mkdir(join(release, 'share', 'openalice', 'ui', 'dist'), { recursive: true })
  const executable = join(release, 'bin', 'openalice')
  await writeFile(executable, `#!/bin/sh
set -eu
if [ "\${1:-}" = "--version" ]; then printf '%s\\n' '${version}'; exit 0; fi
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
