import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  inspectRollback,
  parseRollbackArgs,
  runRollbackCommand,
} from './rollback.mjs'

const temporaryPaths = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('OpenAlice CLI rollback arguments', () => {
  it('parses explicit release selection and confirmation options', () => {
    expect(parseRollbackArgs(['--to', '0.90.0-linux-x64-0123456789abcdef', '--plan', '--yes']))
      .toEqual({
        target: '0.90.0-linux-x64-0123456789abcdef',
        planOnly: true,
        yes: true,
      })
    expect(() => parseRollbackArgs(['--to', '../outside'])).toThrow('installed release name')
  })
})

// The native CLI installer and its symlink activation transaction currently
// support macOS and Linux only. Windows acceptance belongs to the deferred
// PowerShell/native distribution lane.
describe.skipIf(process.platform === 'win32')('OpenAlice CLI rollback transaction', () => {
  it('selects a retained release and switches only the active pointer', async () => {
    const layout = await makeInstalledLayout()
    const plan = await inspectRollback(layout)
    expect(plan.current.name).toBe('0.91.0-linux-x64-bbbbbbbbbbbbbbbb')
    expect(plan.target.name).toBe('0.90.0-linux-x64-aaaaaaaaaaaaaaaa')

    const output = []
    await expect(runRollbackCommand(['--yes'], {
      layout,
      stdout: { write: (value) => output.push(value) },
      stdin: { isTTY: false },
    })).resolves.toBe(0)
    expect(await readlink(layout.currentPath)).toBe('releases/0.90.0-linux-x64-aaaaaaaaaaaaaaaa')
    expect(JSON.parse(await readFile(layout.activationPath, 'utf8'))).toMatchObject({
      activeRelease: '0.90.0-linux-x64-aaaaaaaaaaaaaaaa',
      previousRelease: '0.91.0-linux-x64-bbbbbbbbbbbbbbbb',
      productVersion: '0.90.0',
      state: 'pending',
    })
    expect(output.join('')).toContain('User data was not changed')
  })

  it('keeps --plan non-mutating and rejects a live installer', async () => {
    const layout = await makeInstalledLayout()
    const before = await readlink(layout.currentPath)
    await expect(runRollbackCommand(['--plan'], {
      layout,
      stdout: { write: () => undefined },
    })).resolves.toBe(0)
    expect(await readlink(layout.currentPath)).toBe(before)

    await mkdir(layout.lockDir)
    await writeFile(join(layout.lockDir, 'pid'), '42\n')
    await expect(runRollbackCommand(['--yes'], {
      layout,
      stdout: { write: () => undefined },
      stdin: { isTTY: false },
      processKill: () => undefined,
    })).rejects.toThrow('installer is running')
    expect(await readlink(layout.currentPath)).toBe(before)
  })

  it('does not switch the persistent release pointer inside Railway', async () => {
    const layout = await makeInstalledLayout()
    const before = await readlink(layout.currentPath)
    const output = []

    await expect(runRollbackCommand(['--yes'], {
      layout,
      env: { OPENALICE_SERVICE_MANAGER: 'railway' },
      stdout: { write: (value) => output.push(value) },
      stdin: { isTTY: false },
    })).resolves.toBe(0)

    expect(await readlink(layout.currentPath)).toBe(before)
    expect(output.join('')).toContain('OPENALICE_RAILWAY_CHANNEL')
    expect(output.join('')).toContain('did not modify')
  })

  it('refuses rollback when no previous release is retained', async () => {
    const layout = await makeInstalledLayout({ previous: false })
    await expect(inspectRollback(layout)).rejects.toThrow('No previous')
  })
})

async function makeInstalledLayout(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'openalice-rollback-'))
  temporaryPaths.push(root)
  const installRoot = join(root, '.openalice')
  const cliDir = join(installRoot, 'cli')
  const releasesDir = join(cliDir, 'releases')
  const provenanceDir = join(cliDir, 'provenance')
  const currentName = '0.91.0-linux-x64-bbbbbbbbbbbbbbbb'
  const previousName = '0.90.0-linux-x64-aaaaaaaaaaaaaaaa'
  await mkdir(releasesDir, { recursive: true })
  await mkdir(provenanceDir, { recursive: true })
  await makeRelease(releasesDir, provenanceDir, currentName, '0.91.0', 'b'.repeat(64))
  if (options.previous !== false) {
    await makeRelease(releasesDir, provenanceDir, previousName, '0.90.0', 'a'.repeat(64))
  }
  await symlink(join('releases', currentName), join(cliDir, 'current'))
  return {
    installRoot,
    cliDir,
    releasesDir,
    versionsDir: releasesDir,
    releaseDir: join(releasesDir, currentName),
    currentPath: join(cliDir, 'current'),
    provenanceDir,
    activationPath: join(cliDir, 'activation.json'),
    binDir: join(installRoot, 'bin'),
    lockDir: join(installRoot, '.cli-install.lock'),
    updateCachePath: join(installRoot, '.cli-update-check.json'),
    kind: 'bun',
  }
}

async function makeRelease(releasesDir, provenanceDir, name, version, sha256) {
  const path = join(releasesDir, name)
  await mkdir(join(path, 'bin'), { recursive: true })
  await writeFile(join(path, 'bin', 'openalice'), '#!/bin/sh\n', { mode: 0o755 })
  await writeFile(join(provenanceDir, `${name}.json`), `${JSON.stringify({
    schemaVersion: 3,
    repository: 'TraderAlice/OpenAlice',
    cliVersion: version,
    selector: { kind: 'version', value: `v${version}` },
    installerUrl: 'https://openalice.ai/install',
    updateChannel: 'stable',
    method: 'direct',
    artifact: { platform: 'linux', arch: 'x64', sha256 },
    installedAt: '2026-08-29T00:00:00Z',
  })}\n`)
}
