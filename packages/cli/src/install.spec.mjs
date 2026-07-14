import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import * as pty from 'node-pty'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const temporaryPaths = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32')('OpenAlice CLI installer', () => {
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
    ], { env: { ...process.env, HOME: home } })

    expect(installed.stdout).toContain('Local Runtime CLI installer')
    expect(installed.stdout).toContain('services stay untouched until you start them yourself')
    expect(installed.stdout).toContain('Install plan')
    expect(installed.stdout).toContain('OpenAlice CLI is ready')
    const releases = await readdir(join(installRoot, 'cli-versions'))
    expect(releases).toHaveLength(1)
    expect(releases[0]).toMatch(/^test_ref-[a-f0-9]{16}$/)
    await expect(access(join(installRoot, 'cli-versions', releases[0], 'bin', 'openalice.mjs'))).resolves.toBeUndefined()
    await expect(access(join(installRoot, 'bin', 'openalice.cmd'))).resolves.toBeUndefined()

    const result = await execFileAsync(join(installRoot, 'bin', 'openalice'), ['--version'])
    expect(result.stdout.trim()).toBe('0.2.0')
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
    ], { env: { ...process.env, HOME: home } })

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
    ], { env: { ...process.env, HOME: home } })).rejects.toMatchObject({
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
    expect(result.output).toContain('OpenAlice CLI is ready')
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
    ], { env: { ...process.env, HOME: home } })).rejects.toMatchObject({
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
        ...process.env,
        HOME: home,
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
