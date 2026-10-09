import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { readStartupTarget, writeStartupTarget, resolveStartupTarget } from './startup-target.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'openalice-startup-'))
  roots.push(path)
  return path
}

describe('client startup target', () => {
  it('distinguishes an unset preference from a saved Machine/AliceProject pair', async () => {
    const supervisorRoot = await root()
    expect(await readStartupTarget({ supervisorRoot })).toBeNull()
    await writeStartupTarget({ machine: 'cloud', project: 'research' }, { supervisorRoot })
    expect(await readStartupTarget({ supervisorRoot })).toEqual({ machine: 'cloud', project: 'research' })
    const stored = JSON.parse(await readFile(join(supervisorRoot, 'config.json'), 'utf8'))
    expect(stored).toEqual({ schemaVersion: 3, defaultTarget: { machine: 'cloud', project: 'research' } })
  })

  it('fails closed on malformed state and does not replace it during a read', async () => {
    const supervisorRoot = await root()
    const path = join(supervisorRoot, 'startup-target.json')
    await writeFile(path, '{broken', 'utf8')
    await expect(readStartupTarget({ supervisorRoot })).rejects.toThrow(/Choose an AliceProject/)
    expect(await readFile(path, 'utf8')).toBe('{broken')
  })

  it('rejects invalid keys without changing the saved preference', async () => {
    const supervisorRoot = await root()
    await writeStartupTarget({ machine: 'local', project: 'default' }, { supervisorRoot })
    await expect(writeStartupTarget({ machine: '../other', project: 'default' }, { supervisorRoot })).rejects.toThrow(/defaultTarget.machine/)
    expect(await readStartupTarget({ supervisorRoot })).toEqual({ machine: 'local', project: 'default' })
  })
  it('resolves explicit local and remote pairs without reading or persisting Default', async () => {
    const supervisorRoot = await root()
    await writeStartupTarget({ machine: 'cloud', project: 'old' }, { supervisorRoot })
    expect(await resolveStartupTarget({ project: 'default', env: {} }, { supervisorRoot })).toEqual({ target: { machine: 'local', project: 'default' }, override: true })
    expect(await resolveStartupTarget({ machine: 'other', project: 'research', env: {} }, { supervisorRoot })).toEqual({ target: { machine: 'other', project: 'research' }, override: true })
    expect(await resolveStartupTarget({ home: '/temporary', env: {} }, { supervisorRoot })).toMatchObject({ override: true })
    expect(await readStartupTarget({ supervisorRoot })).toEqual({ machine: 'cloud', project: 'old' })
    await expect(resolveStartupTarget({ machine: 'other', env: {} }, { supervisorRoot })).rejects.toThrow('--project')
  })

})

// Default migration must never consult the maintainer's installed Desktop state.
vi.mock('./supervisor-default-migration.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('./supervisor-default-migration.ts')>()
  return { ...actual, migrateSupervisorDefault: (root: string, config: Parameters<typeof actual.migrateSupervisorDefault>[1], save: Parameters<typeof actual.migrateSupervisorDefault>[2], desktopPath?: string) =>
    actual.migrateSupervisorDefault(root, config, save, desktopPath ?? join(root, 'fixture-desktop-preferences.json')) }
})
