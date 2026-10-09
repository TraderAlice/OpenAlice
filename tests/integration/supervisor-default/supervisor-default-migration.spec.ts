import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateSupervisorDefault } from '../../../packages/cli/src/supervisor-default-migration.ts'
import { readSupervisorConfig, persistMachineLaunchConfig, persistAliceProjectLaunchConfig, resolveStoredLaunchContext } from '../../../packages/cli/src/supervisor-config.ts'
import { DefaultSelection, readStartupTarget, writeStartupTarget } from '../../../packages/cli/src/startup-target.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'default-migration-')); roots.push(root)
  const desktop = join(root, 'desktop.json')
  const save = async (_: string, config: unknown) => { await writeFile(join(root, 'config.json'), JSON.stringify(config)) }
  return { root, desktop, save }
}

describe('Supervisor Default authority', () => {
  it('migrates consistent legacy choices once and ignores later backup changes, including new null', async () => {
    const { root, desktop, save } = await fixture()
    const config = { schemaVersion: 2 as const, defaultProject: 'research', projects: { research: { home: join(root, 'research') } }, future: { keep: true } }
    await save(root, config)
    await writeFile(desktop, JSON.stringify({ selectedHome: config.projects.research.home }))
    await writeFile(join(root, 'startup-target.json'), JSON.stringify({ schemaVersion: 1, target: { machine: 'local', project: 'research' } }))
    const migrated = await migrateSupervisorDefault(root, config, save, desktop)
    expect(migrated).toMatchObject({ schemaVersion: 3, defaultTarget: { machine: 'local', project: 'research' }, future: { keep: true } })
    expect(migrated.defaultProject).toBeUndefined()
    expect(JSON.parse(await readFile(join(root, 'config.pre-default-target.json'), 'utf8'))).toEqual(config)
    await writeFile(join(root, 'startup-target.json'), '{corrupt')
    expect(await readSupervisorConfig(root)).toMatchObject(migrated)
    await writeStartupTarget(null, { supervisorRoot: root })
    expect(await readStartupTarget({ supervisorRoot: root })).toBeNull()
  })

  it.each(['conflict', 'corrupt', 'unmapped'])('records a recoverable chooser state for %s without changing legacy data', async reason => {
    const { root, desktop, save } = await fixture()
    const config = { schemaVersion: 2 as const, defaultProject: 'default' }
    const legacy = reason === 'corrupt' ? '{broken' : JSON.stringify({ schemaVersion: 1, target: { machine: 'cloud', project: 'research' } })
    await writeFile(join(root, 'startup-target.json'), legacy)
    if (reason === 'unmapped') await writeFile(desktop, JSON.stringify({ selectedHome: '/unregistered' }))
    const migrated = await migrateSupervisorDefault(root, config, save, desktop)
    expect(migrated.defaultTarget).toBeNull()
    expect(migrated.defaultTargetMigrationError).toContain('Choose an AliceProject')
    expect(await readFile(join(root, 'startup-target.json'), 'utf8')).toBe(legacy)
    await writeStartupTarget({ machine: 'local', project: 'default' }, { supervisorRoot: root })
    expect(await readStartupTarget({ supervisorRoot: root })).toEqual({ machine: 'local', project: 'default' })
  })

  it('uses both packaged and development Electron preferences regardless of which client migrates first', async () => {
    const { root, save } = await fixture()
    const packaged = join(root, 'OpenAlice', 'openalice-data-home.json')
    const development = join(root, 'open-alice', 'openalice-data-home.json')
    await mkdir(join(root, 'OpenAlice')); await mkdir(join(root, 'open-alice'))
    const config = { schemaVersion: 2 as const, projects: { research: { home: join(root, 'research') } } }
    await writeFile(development, JSON.stringify({ selectedHome: config.projects.research.home }))
    expect((await migrateSupervisorDefault(root, config, save, packaged)).defaultTarget).toEqual({ machine: 'local', project: 'research' })
    await writeFile(packaged, JSON.stringify({ selectedHome: '/unmapped' }))
    expect((await migrateSupervisorDefault(root, config, save, development)).defaultTargetMigrationError).toContain('not mapped')
  })

  it('preserves an unreachable remote choice rather than checking or falling back during migration', async () => {
    const { root, desktop, save } = await fixture()
    await writeFile(join(root, 'startup-target.json'), JSON.stringify({ schemaVersion: 1, target: { machine: 'offline', project: 'research' } }))
    const result = await migrateSupervisorDefault(root, { schemaVersion: 2 }, save, desktop)
    expect(result.defaultTarget).toEqual({ machine: 'offline', project: 'research' })
    await expect(resolveStoredLaunchContext({}, { env: { OPENALICE_SUPERVISOR_HOME: root } })).rejects.toThrow('Default is remote')
    await mkdir(join(root, 'local'))
    const context = await resolveStoredLaunchContext({ project: 'default', home: join(root, 'local') }, { env: { OPENALICE_SUPERVISOR_HOME: root } })
    expect(context.project).toBe('default')
    expect(await readStartupTarget({ supervisorRoot: root })).toEqual(result.defaultTarget)
  })

  it('preserves unrelated config during concurrent settings and successful-selection writes', async () => {
    const { root, save } = await fixture()
    await save(root, { schemaVersion: 3, defaultTarget: null, future: { untouched: true } })
    const context = await resolveStoredLaunchContext({ project: 'default', home: join(root, 'home') }, { env: { OPENALICE_SUPERVISOR_HOME: root } })
    await Promise.all([
      persistMachineLaunchConfig(context, { port: 49000 }),
      persistAliceProjectLaunchConfig(context, { appDir: '/project-app' }),
      writeStartupTarget({ machine: 'cloud', project: 'research' }, { supervisorRoot: root }),
    ])
    expect(await readSupervisorConfig(root)).toMatchObject({ defaultTarget: { machine: 'cloud', project: 'research' }, defaults: { port: 49000 }, projects: { default: { appDir: '/project-app' } }, future: { untouched: true } })
  })

  it('prevents cancelled and superseded completions from saving', async () => {
    const { root, save } = await fixture()
    await save(root, { schemaVersion: 3, defaultTarget: { machine: 'cloud', project: 'old' } })
    const selections = new DefaultSelection()
    const old = selections.begin()
    const next = selections.begin()
    await writeStartupTarget({ machine: 'local', project: 'default' }, { supervisorRoot: root, current: old.current })
    next.cancel()
    await writeStartupTarget(null, { supervisorRoot: root, current: next.current })
    expect(await readStartupTarget({ supervisorRoot: root })).toEqual({ machine: 'cloud', project: 'old' })
  })
  it('serializes writes from independent CLI processes', async () => {
    const { root, save } = await fixture()
    await save(root, { schemaVersion: 3, defaultTarget: null, future: 'keep' })
    const moduleUrl = new URL('../../../packages/cli/src/supervisor-config.ts', import.meta.url).href
    await Promise.all([{ port: 49111 }, { updateChecks: false }].map(patch => promisify(execFile)(process.execPath, ['--input-type=module', '-e', `import { persistMachineLaunchConfig } from ${JSON.stringify(moduleUrl)}; await persistMachineLaunchConfig({ supervisorRoot: ${JSON.stringify(root)} }, ${JSON.stringify(patch)});`])))
    expect(await readSupervisorConfig(root)).toMatchObject({ defaults: { port: 49111, updateChecks: false }, future: 'keep', defaultTarget: null })
  })

})
