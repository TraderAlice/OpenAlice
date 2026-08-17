import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import * as pty from 'node-pty'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const fakeNpm = join(repositoryRoot, 'scripts/install-smoke/fake-npm.sh')
const piAssets = join(repositoryRoot, 'scripts/install-smoke/pi-assets')
const productVersion = JSON.parse(
  await readFile(join(repositoryRoot, 'package.json'), 'utf8'),
).version
const temporaryPaths = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32')('OpenAlice CLI installer', { timeout: 30_000 }, () => {
  it('keeps the CLI and desktop managed-Pi pins aligned', async () => {
    const installer = await readFile(join(repositoryRoot, 'install'), 'utf8')
    const desktopVendor = await readFile(join(repositoryRoot, 'scripts/vendor-managed-runtime.mjs'), 'utf8')
    const packageBytes = await readFile(join(piAssets, 'package.json'))
    const lockBytes = await readFile(join(piAssets, 'package-lock.json'))
    const piManifest = JSON.parse(packageBytes.toString('utf8'))
    const rootManifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
    const cliManifest = JSON.parse(await readFile(join(repositoryRoot, 'packages/cli/package.json'), 'utf8'))

    expect(installer).toContain('DEFAULT_BRANCH="master"')
    expect(installer).toContain('PUBLIC_INSTALLER_URL="https://openalice.ai/install"')
    expect(installer).toContain('OPENALICE_INSTALLER_UPDATE_CHANNEL="${OPENALICE_INSTALLER_UPDATE_CHANNEL:-}"')
    expect(installer).toContain('MINIMUM_NODE_VERSION="22.19.0"')
    expect(installer).toContain('PI_VERSION="0.83.0"')
    expect(desktopVendor).toContain("const PI_VERSION = '0.83.0'")
    expect(piManifest).toEqual(expect.objectContaining({
      version: '0.83.0',
      engines: { node: '>=22.19.0' },
      dependencies: { '@earendil-works/pi-coding-agent': '0.83.0' },
    }))
    expect(rootManifest.engines.node).toBe('>=22.19.0')
    expect(cliManifest.engines.node).toBe('>=22.19.0')
    expect(cliManifest.version).toBe(rootManifest.version)
    for (const file of cliManifest.files) {
      expect(installer).toContain(`  "${file}"`)
    }
    expect(sha256(packageBytes)).toBe('41f07a3eb41227905ac436ad41d949e4589dcc34c15454d718f85f399b533cb6')
    expect(sha256(lockBytes)).toBe('f5cb41dcfc60561ba54490b49c17beecec202900f73eb5f104b34f8b2a79a0af')
  })

  it('defaults to master, accepts an explicit branch, and rejects multiple selectors', async () => {
    const home = await mkdtemp(join(tmpdir(), 'openalice-install-selectors-'))
    temporaryPaths.push(home)
    const installer = join(repositoryRoot, 'install')
    const commonArgs = [
      '--source', repositoryRoot,
      '--install-dir', join(home, '.openalice'),
      '--no-modify-path',
      '--plan',
    ]

    const stable = await execFileAsync('bash', [installer, ...commonArgs], { env: installerEnv(home) })
    expect(stable.stdout).toContain('Branch         master')

    const preview = await execFileAsync('bash', [installer, ...commonArgs, '--branch', 'dev'], { env: installerEnv(home) })
    expect(preview.stdout).toContain('Branch         dev')

    await expect(execFileAsync('bash', [installer,
      ...commonArgs,
      '--branch', 'dev',
      '--version', 'v0.2.0',
    ], { env: installerEnv(home) })).rejects.toMatchObject({
      stderr: expect.stringContaining('Use only one of --branch or --version'),
    })
  })

  it('records the public installer URL for the default master channel', async () => {
    const home = await mkdtemp(join(tmpdir(), 'openalice-install-public-source-'))
    temporaryPaths.push(home)
    const installRoot = join(home, '.openalice')
    const installer = join(repositoryRoot, 'install')

    const installed = await execFileAsync('bash', [installer,
      '--source', repositoryRoot,
      '--install-dir', installRoot,
      '--no-modify-path',
      '--yes',
    ], {
      env: {
        ...installerEnv(home),
        OPENALICE_INSTALL_CONTEXT: 'remote',
      },
    })

    expect(installed.stdout).toContain('Remote Runtime CLI installer')
    expect(installed.stdout).not.toContain('then run locally in your browser')
    expect(installed.stdout).toContain('Returning to the approved remote setup plan')
    expect(installed.stdout).not.toContain('Next: launch from an OpenAlice checkout')

    const versionInfo = await execFileAsync(join(installRoot, 'bin', 'openalice'), ['version', '--json'])
    expect(JSON.parse(versionInfo.stdout).installSource).toMatchObject({
      schemaVersion: 2,
      selector: { kind: 'branch', value: 'master' },
      installerUrl: 'https://openalice.ai/install',
      updateChannel: 'stable',
    })
  })

  it('installs a runnable, versioned CLI without touching the shell profile', async () => {
    const home = await mkdtemp(join(tmpdir(), 'openalice-install-test-'))
    temporaryPaths.push(home)
    const installRoot = join(home, '.openalice')
    const installer = join(repositoryRoot, 'install')
    const installed = await execFileAsync('bash', [installer,
      '--source', repositoryRoot,
      '--version', 'test/ref',
      '--install-dir', installRoot,
      '--no-modify-path',
      '--yes',
    ], { env: installerEnv(home) })

    expect(installed.stdout).toContain('Local Runtime CLI installer')
    expect(installed.stdout).toContain('System build tools are optional and listed before consent')
    expect(installed.stdout).toContain('No system packages were changed')
    expect(installed.stdout).toContain('Install plan')
    expect(installed.stdout).toContain('Managed agent  Pi 0.83.0')
    expect(installed.stdout).toContain('OpenAlice and Pi are ready')
    expect(installed.stdout).toContain('Activate OpenAlice in this terminal now (no restart required):')
    const activation = installed.stdout.match(/Activate OpenAlice in this terminal now \(no restart required\):\n  (.+)\n/)?.[1]
    expect(activation).toBeDefined()
    const activated = await execFileAsync('bash', ['-c', `${activation}; command -v openalice`], {
      env: installerEnv(home),
    })
    expect(activated.stdout.trim()).toBe(join(installRoot, 'bin', 'openalice'))
    const releases = await readdir(join(installRoot, 'cli-versions'))
    expect(releases).toHaveLength(1)
    expect(releases[0]).toMatch(/^test_ref-[a-f0-9]{16}$/)
    await expect(access(join(installRoot, 'cli-versions', releases[0], 'bin', 'openalice.ts'))).resolves.toBeUndefined()
    await expect(access(join(installRoot, 'cli-versions', releases[0], 'managed', 'pi', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js'))).resolves.toBeUndefined()
    await expect(access(join(installRoot, 'cli-versions', releases[0], 'managed', 'pi', 'node_modules', '@earendil-works', 'pi-tui', 'package.json'))).resolves.toBeUndefined()
    await expect(access(join(installRoot, 'bin', 'openalice.cmd'))).resolves.toBeUndefined()
    await expect(access(join(installRoot, 'bin', 'pi.cmd'))).resolves.toBeUndefined()

    const result = await execFileAsync(join(installRoot, 'bin', 'openalice'), ['--version'])
    expect(result.stdout.trim()).toBe(productVersion)
    const versionInfo = await execFileAsync(join(installRoot, 'bin', 'openalice'), ['version', '--json'])
    expect(JSON.parse(versionInfo.stdout)).toEqual({
      version: productVersion,
      contentIdentity: releases[0].slice(-16),
      installSource: {
        schemaVersion: 2,
        repository: 'TraderAlice/OpenAlice',
        cliVersion: productVersion,
        selector: { kind: 'version', value: 'test/ref' },
        installerUrl: 'https://raw.githubusercontent.com/TraderAlice/OpenAlice/test/ref/install',
        updateChannel: 'pinned',
      },
      managedRuntime: null,
    })
    await expect(access(join(installRoot, 'cli-versions', releases[0], 'install-source.json'))).resolves.toBeUndefined()
    const pi = await execFileAsync(join(installRoot, 'bin', 'pi'), ['--version'])
    expect(pi.stdout.trim()).toBe('0.83.0')
    const launcher = await readFile(join(installRoot, 'bin', 'openalice'), 'utf8')
    expect(launcher).toContain('OPENALICE_MANAGED_PI_PATH=')
  })

  it('recovers a legacy pinned release install onto stable without losing its exact ref', async () => {
    const home = await mkdtemp(join(tmpdir(), 'openalice-install-stable-ref-'))
    temporaryPaths.push(home)
    const installRoot = join(home, '.openalice')
    const installerArgs = [
      '--source', repositoryRoot,
      '--version', `v${productVersion}`,
      '--install-dir', installRoot,
      '--no-modify-path',
      '--yes',
    ]

    await execFileAsync('bash', [join(repositoryRoot, 'install'), ...installerArgs], {
      env: {
        ...installerEnv(home),
        OPENALICE_INSTALL_CONTEXT: 'remote',
      },
    })
    const [legacyRelease] = await readdir(join(installRoot, 'cli-versions'))
    await writeFile(join(installRoot, 'cli-versions', legacyRelease, 'install-source.json'), `${JSON.stringify({
      schemaVersion: 1,
      repository: 'TraderAlice/OpenAlice',
      cliVersion: productVersion,
      selector: { kind: 'version', value: `v${productVersion}` },
      installerUrl: `https://raw.githubusercontent.com/TraderAlice/OpenAlice/v${productVersion}/install`,
    }, null, 2)}\n`)
    const pinnedCheck = await execFileAsync(join(installRoot, 'bin', 'openalice'), ['update', '--check', '--json'])
    expect(JSON.parse(pinnedCheck.stdout)).toMatchObject({ status: 'unsupported', channel: 'pinned' })

    await execFileAsync('bash', [join(repositoryRoot, 'install'), ...installerArgs], {
      env: {
        ...installerEnv(home),
        OPENALICE_INSTALL_CONTEXT: 'remote',
        OPENALICE_INSTALL_UPDATE_CHANNEL: 'stable',
      },
    })

    const versionInfo = await execFileAsync(join(installRoot, 'bin', 'openalice'), ['version', '--json'])
    expect(JSON.parse(versionInfo.stdout).installSource).toEqual({
      schemaVersion: 2,
      repository: 'TraderAlice/OpenAlice',
      cliVersion: productVersion,
      selector: { kind: 'version', value: `v${productVersion}` },
      installerUrl: `https://raw.githubusercontent.com/TraderAlice/OpenAlice/v${productVersion}/install`,
      updateChannel: 'stable',
    })

    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        version: productVersion,
        releaseNotesUrl: `https://github.com/TraderAlice/OpenAlice/releases/tag/v${productVersion}`,
        installer: {
          url: 'https://download.openalice.ai/install',
          versionedUrl: `https://download.openalice.ai/OpenAlice-${productVersion}-install`,
          sha256: '0'.repeat(64),
        },
      }))
    })
    await new Promise((resolvePromise, rejectPromise) => {
      server.once('error', rejectPromise)
      server.listen(0, '127.0.0.1', resolvePromise)
    })
    try {
      const address = server.address()
      const stableCheck = await execFileAsync(join(installRoot, 'bin', 'openalice'), ['update', '--check', '--json'], {
        env: {
          ...process.env,
          OPENALICE_UPDATE_MANIFEST_URL: `http://127.0.0.1:${address.port}/manifest.json`,
        },
      })
      expect(JSON.parse(stableCheck.stdout)).toMatchObject({
        status: 'current',
        currentVersion: productVersion,
        latestVersion: productVersion,
        channel: 'stable',
      })
    } finally {
      await new Promise((resolvePromise) => server.close(resolvePromise))
    }
  })

  it('can show the complete plan without creating the install root', async () => {
    const home = await mkdtemp(join(tmpdir(), 'openalice-install-plan-'))
    temporaryPaths.push(home)
    const installRoot = join(home, '.openalice')
    const installer = join(repositoryRoot, 'install')
    const result = await execFileAsync('bash', [installer,
      '--source', repositoryRoot,
      '--version', 'plan-only',
      '--install-dir', installRoot,
      '--no-modify-path',
      '--plan',
    ], { env: installerEnv(home) })

    expect(result.stdout).toContain('Install plan')
    expect(result.stdout).toContain('Plan complete')
    await expect(access(installRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a payload that does not match the update manifest version', async () => {
    const home = await mkdtemp(join(tmpdir(), 'openalice-install-expected-version-'))
    temporaryPaths.push(home)
    await expect(execFileAsync('bash', [join(repositoryRoot, 'install'),
      '--source', repositoryRoot,
      '--install-dir', join(home, '.openalice'),
      '--no-modify-path',
      '--yes',
    ], {
      env: {
        ...installerEnv(home),
        OPENALICE_EXPECTED_CLI_VERSION: '999.0.0',
      },
    })).rejects.toMatchObject({
      stderr: expect.stringContaining('instead of expected release 999.0.0'),
    })
    await expect(access(join(home, '.openalice', 'bin', 'openalice')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('requires explicit approval when no interactive terminal is available', async () => {
    const home = await mkdtemp(join(tmpdir(), 'openalice-install-unattended-'))
    temporaryPaths.push(home)
    const installRoot = join(home, '.openalice')
    const installer = join(repositoryRoot, 'install')

    await expect(execFileAsync('bash', [installer,
      '--source', repositoryRoot,
      '--version', 'unattended',
      '--install-dir', installRoot,
      '--no-modify-path',
    ], { env: installerEnv(home) })).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining('--yes'),
    })

    await expect(access(installRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('treats blank interactive confirmation as cancellation', async () => {
    const home = await mkdtemp(join(tmpdir(), 'openalice-install-cancel-'))
    temporaryPaths.push(home)
    const installRoot = join(home, '.openalice')
    const result = await runInstallerInPty([
      '--source', repositoryRoot,
      '--version', 'interactive-cancel',
      '--install-dir', installRoot,
      '--no-modify-path',
    ], { home, reply: '\r' })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Continue with this install?')
    expect(result.output).toContain('[y/N]')
    expect(result.output).toContain('No changes made')
    await expect(access(installRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('installs after an explicit interactive y confirmation', async () => {
    const home = await mkdtemp(join(tmpdir(), 'openalice-install-confirm-'))
    temporaryPaths.push(home)
    const installRoot = join(home, '.openalice')
    const result = await runInstallerInPty([
      '--source', repositoryRoot,
      '--version', 'interactive-confirm',
      '--install-dir', installRoot,
      '--no-modify-path',
    ], { home, reply: 'y\r' })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Continue with this install?')
    expect(result.output).toContain('OpenAlice and Pi are ready')
    expect(result.output).toContain('Open the OpenAlice Supervisor now?')
    expect(result.output).toContain('Start it when you are ready')
    await expect(access(join(installRoot, 'bin', 'openalice'))).resolves.toBeUndefined()
  })

  it('refuses to race another live installer', async () => {
    const home = await mkdtemp(join(tmpdir(), 'openalice-install-lock-'))
    temporaryPaths.push(home)
    const installRoot = join(home, '.openalice')
    const lockDir = join(installRoot, '.cli-install.lock')
    const installer = join(repositoryRoot, 'install')
    await mkdir(lockDir, { recursive: true })
    await writeFile(join(lockDir, 'pid'), `${process.pid}\n`)

    await expect(execFileAsync('bash', [installer,
      '--source', repositoryRoot,
      '--version', 'locked',
      '--install-dir', installRoot,
      '--no-modify-path',
      '--yes',
    ], { env: installerEnv(home) })).rejects.toMatchObject({
      stderr: expect.stringContaining('Another OpenAlice CLI installer is running'),
    })

    await expect(access(join(installRoot, 'bin', 'openalice'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

function runInstallerInPty(args, { home, reply }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const terminal = pty.spawn('bash', [join(repositoryRoot, 'install'), ...args], {
      cwd: repositoryRoot,
      cols: 120,
      rows: 32,
      env: {
        ...installerEnv(home),
        SHELL: '/bin/bash',
        TERM: 'xterm-256color',
      },
    })
    let output = ''
    let replied = false
    let declinedStart = false
    const timeout = setTimeout(() => {
      terminal.kill()
      rejectPromise(new Error(`installer PTY timed out:\n${output}`))
    }, 20_000)

    terminal.onData((data) => {
      output += data
      if (!replied && output.includes('Continue with this install?')) {
        replied = true
        terminal.write(reply)
      }
      if (!declinedStart && output.includes('Open the OpenAlice Supervisor now?')) {
        declinedStart = true
        terminal.write('n\r')
      }
    })
    terminal.onExit(({ exitCode, signal }) => {
      clearTimeout(timeout)
      resolvePromise({ exitCode, signal, output })
    })
  })
}

function installerEnv(home) {
  return {
    ...process.env,
    HOME: home,
    OPENALICE_NPM_BIN: fakeNpm,
    OPENALICE_PI_SOURCE_DIR: piAssets,
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
