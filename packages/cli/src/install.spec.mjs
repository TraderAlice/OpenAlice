import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
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
const temporaryPaths = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32')('OpenAlice CLI installer', { timeout: 15_000 }, () => {
  it('keeps the CLI and desktop managed-Pi pins aligned', async () => {
    const installer = await readFile(join(repositoryRoot, 'install'), 'utf8')
    const desktopVendor = await readFile(join(repositoryRoot, 'scripts/vendor-managed-runtime.mjs'), 'utf8')
    const packageBytes = await readFile(join(piAssets, 'package.json'))
    const lockBytes = await readFile(join(piAssets, 'package-lock.json'))
    const piManifest = JSON.parse(packageBytes.toString('utf8'))
    const rootManifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
    const cliManifest = JSON.parse(await readFile(join(repositoryRoot, 'packages/cli/package.json'), 'utf8'))

    expect(installer).toContain('DEFAULT_BRANCH="master"')
    expect(installer).toContain('MINIMUM_NODE_VERSION="22.19.0"')
    expect(installer).toContain('PI_VERSION="0.80.6"')
    expect(desktopVendor).toContain("const PI_VERSION = '0.80.6'")
    expect(piManifest).toEqual(expect.objectContaining({
      version: '0.80.6',
      engines: { node: '>=22.19.0' },
      dependencies: { '@earendil-works/pi-coding-agent': '0.80.6' },
    }))
    expect(rootManifest.engines.node).toBe('>=22.19.0')
    expect(cliManifest.engines.node).toBe('>=22.19.0')
    expect(sha256(packageBytes)).toBe('ee080db64c3732daea5547bd6d9809465ffa236ef6099051e64a16753e48b795')
    expect(sha256(lockBytes)).toBe('0f409bf498507f93bfbde3dc6f2b4c83bc58bdea2e2f5eabf3053cc2a81568d4')
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
    expect(installed.stdout).toContain('Managed agent  Pi 0.80.6')
    expect(installed.stdout).toContain('OpenAlice and Pi are ready')
    const releases = await readdir(join(installRoot, 'cli-versions'))
    expect(releases).toHaveLength(1)
    expect(releases[0]).toMatch(/^test_ref-[a-f0-9]{16}$/)
    await expect(access(join(installRoot, 'cli-versions', releases[0], 'bin', 'openalice.mjs'))).resolves.toBeUndefined()
    await expect(access(join(installRoot, 'cli-versions', releases[0], 'managed', 'pi', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js'))).resolves.toBeUndefined()
    await expect(access(join(installRoot, 'bin', 'openalice.cmd'))).resolves.toBeUndefined()
    await expect(access(join(installRoot, 'bin', 'pi.cmd'))).resolves.toBeUndefined()

    const result = await execFileAsync(join(installRoot, 'bin', 'openalice'), ['--version'])
    expect(result.stdout.trim()).toBe('0.2.0')
    const versionInfo = await execFileAsync(join(installRoot, 'bin', 'openalice'), ['version', '--json'])
    expect(JSON.parse(versionInfo.stdout)).toEqual({
      version: '0.2.0',
      installSource: {
        schemaVersion: 1,
        repository: 'TraderAlice/OpenAlice',
        cliVersion: '0.2.0',
        selector: { kind: 'version', value: 'test/ref' },
        installerUrl: 'https://raw.githubusercontent.com/TraderAlice/OpenAlice/test/ref/install',
      },
    })
    await expect(access(join(installRoot, 'cli-versions', releases[0], 'install-source.json'))).resolves.toBeUndefined()
    const pi = await execFileAsync(join(installRoot, 'bin', 'pi'), ['--version'])
    expect(pi.stdout.trim()).toBe('0.80.6')
    const launcher = await readFile(join(installRoot, 'bin', 'openalice'), 'utf8')
    expect(launcher).toContain('OPENALICE_MANAGED_PI_PATH=')
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
    expect(result.output).toContain('Start OpenAlice now?')
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
    }, 10_000)

    terminal.onData((data) => {
      output += data
      if (!replied && output.includes('Continue with this install?')) {
        replied = true
        terminal.write(reply)
      }
      if (!declinedStart && output.includes('Start OpenAlice now?')) {
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
