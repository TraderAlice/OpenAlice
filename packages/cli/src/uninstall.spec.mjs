import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  performUninstall,
  removeManagedPathBlock,
  removeMatchingBlocks,
  runUninstallCommand,
} from './uninstall.mjs'

const temporaryPaths = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('OpenAlice CLI uninstall', () => {
  it('removes only the managed PATH block for this install root', () => {
    const content = `before
# >>> OpenAlice CLI >>>
export PATH=/tmp/first/bin:$PATH
# <<< OpenAlice CLI <<<
middle
# >>> OpenAlice CLI >>>
export PATH=/tmp/second/bin:$PATH
# <<< OpenAlice CLI <<<
after
`
    expect(removeMatchingBlocks(content, '/tmp/first/bin')).toBe(`before
middle
# >>> OpenAlice CLI >>>
export PATH=/tmp/second/bin:$PATH
# <<< OpenAlice CLI <<<
after
`)
  })

  it('preserves a symlinked profile while removing its matching block', async () => {
    const root = await makeTempDir()
    const target = join(root, 'profile-target')
    const profile = join(root, '.zprofile')
    await writeFile(target, `keep\n# >>> OpenAlice CLI >>>\nexport PATH=/tmp/alice/bin:$PATH\n# <<< OpenAlice CLI <<<\n`)
    await import('node:fs/promises').then(({ symlink }) => symlink(target, profile))
    await expect(removeManagedPathBlock(profile, '/tmp/alice/bin')).resolves.toBe(true)
    expect(await readFile(target, 'utf8')).toBe('keep\n')
    expect((await import('node:fs/promises').then(({ lstat }) => lstat(profile))).isSymbolicLink()).toBe(true)
  })

  it('removes installer-owned files while preserving application state and sources', async () => {
    const root = await makeTempDir()
    const layout = await makeInstalledLayout(root)
    const profile = join(root, '.zprofile')
    await writeFile(profile, `# >>> OpenAlice CLI >>>\nexport PATH=${layout.binDir}:$PATH\n# <<< OpenAlice CLI <<<\n`)
    await writeFile(join(layout.installRoot, 'data', 'state.json'), '{}')
    await writeFile(join(layout.installRoot, 'workspaces', 'desk.txt'), 'desk')
    await writeFile(join(layout.installRoot, 'sources', 'checkout.txt'), 'source')
    await writeFile(join(layout.installRoot, 'provider-keys.json'), '{}')
    await writeFile(join(layout.installRoot, 'sealing.key'), 'secret')

    await expect(performUninstall(layout, { profiles: [profile] })).resolves.toEqual({
      profilesChanged: [profile],
    })
    await expect(access(layout.versionsDir)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(join(layout.binDir, 'openalice'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(layout.installRoot, 'data', 'state.json'), 'utf8')).resolves.toBe('{}')
    await expect(readFile(join(layout.installRoot, 'workspaces', 'desk.txt'), 'utf8')).resolves.toBe('desk')
    await expect(readFile(join(layout.installRoot, 'sources', 'checkout.txt'), 'utf8')).resolves.toBe('source')
    await expect(readFile(join(layout.installRoot, 'provider-keys.json'), 'utf8')).resolves.toBe('{}')
    await expect(readFile(join(layout.installRoot, 'sealing.key'), 'utf8')).resolves.toBe('secret')
    await expect(readFile(profile, 'utf8')).resolves.toBe('')
  })

  it('shows a non-mutating plan with explicit preserved paths', async () => {
    const root = await makeTempDir()
    const layout = await makeInstalledLayout(root)
    const output = []
    await expect(runUninstallCommand(['--plan'], {
      layout,
      profiles: [],
      stdout: { write: (value) => output.push(value) },
    })).resolves.toBe(0)
    expect(output.join('')).toContain(join(layout.installRoot, 'workspaces'))
    await expect(access(layout.versionsDir)).resolves.toBeUndefined()
  })

  it('refuses to race a live installer', async () => {
    const root = await makeTempDir()
    const layout = await makeInstalledLayout(root)
    await mkdir(layout.lockDir, { recursive: true })
    await writeFile(join(layout.lockDir, 'pid'), '42\n')
    await expect(performUninstall(layout, {
      profiles: [],
      processKill: () => undefined,
    })).rejects.toThrow('installer is running')
    await expect(access(layout.versionsDir)).resolves.toBeUndefined()
  })
})

async function makeTempDir() {
  const root = await mkdtemp(join(tmpdir(), 'openalice-uninstall-'))
  temporaryPaths.push(root)
  return root
}

async function makeInstalledLayout(root) {
  const installRoot = join(root, '.openalice')
  const layout = {
    installRoot,
    versionsDir: join(installRoot, 'cli-versions'),
    releaseDir: join(installRoot, 'cli-versions', 'master-0123456789abcdef'),
    binDir: join(installRoot, 'bin'),
    lockDir: join(installRoot, '.cli-install.lock'),
    updateCachePath: join(installRoot, '.cli-update-check.json'),
  }
  await mkdir(layout.releaseDir, { recursive: true })
  await mkdir(layout.binDir, { recursive: true })
  await mkdir(join(installRoot, 'data'), { recursive: true })
  await mkdir(join(installRoot, 'workspaces'), { recursive: true })
  await mkdir(join(installRoot, 'sources'), { recursive: true })
  for (const launcher of ['openalice', 'openalice.cmd', 'pi', 'pi.cmd']) {
    await writeFile(join(layout.binDir, launcher), launcher)
  }
  await writeFile(layout.updateCachePath, '{}')
  return layout
}
