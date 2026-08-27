import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createSupervisorAliceProject,
  isNewerSupervisorSchemaError,
  isSupervisorConfigError,
  parseSupervisorConfig,
  persistAliceProjectLaunchConfig,
  persistMachineLaunchConfig,
  persistSelectedSupervisorAliceProject,
  readMachineLaunchConfig,
  readSupervisorAliceProjectRegistry,
  readSupervisorConfig,
  resolveAvailableStoredLaunchContext,
  resolveStoredLaunchContext,
  supervisorConfigPath,
  writeSupervisorConfig,
} from './supervisor-config.ts'

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )))
})

describe('Supervisor configuration', () => {
  it('loads machine and selected-project layers below environment and flags', async () => {
    const context = await resolveStoredLaunchContext({
      port: 44_000,
    }, {
      homeDir: '/home/alice',
      cwd: '/repo',
      platform: 'linux',
      env: {
        XDG_CONFIG_HOME: '/xdg',
        OPENALICE_HOME: '/env-home',
      },
      readConfig: async () => ({
        schemaVersion: 1,
        defaultInstance: 'research',
        defaults: {
          home: '/machine-home',
          port: 41_000,
          appDir: '/machine-app',
        },
        instances: {
          research: {
            name: 'research',
            home: '/project-home',
            port: 42_000,
            appDir: '/project-app',
          },
        },
      }),
    })

    expect(context).toMatchObject({
      project: 'research',
      home: resolve('/env-home'),
      port: 44_000,
      appDir: resolve('/project-app'),
      provenance: {
        project: { source: 'machine-config' },
        home: { source: 'environment' },
        port: { source: 'cli-flag' },
        appDir: { source: 'project-config' },
      },
    })
  })

  it('falls back to an available AliceProject only after a stored default home becomes unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-supervisor-recovery-'))
    temporaryPaths.push(root)
    const config = {
      schemaVersion: 1 as const,
      defaultInstance: 'missing',
      instances: {
        missing: {
          name: 'missing',
          home: join(root, 'disconnected-home'),
        },
      },
    }
    const options = {
      homeDir: join(root, 'user'),
      cwd: root,
      platform: 'linux' as const,
      env: { XDG_CONFIG_HOME: join(root, 'config') },
      readConfig: async () => config,
    }

    await expect(resolveStoredLaunchContext({}, options)).rejects.toMatchObject({
      code: 'ESTOREDHOMEMISSING',
    })

    const fallback = await resolveAvailableStoredLaunchContext(options)
    expect(fallback).toMatchObject({
      project: 'default',
      home: resolve(root, 'user/.openalice'),
      provenance: {
        project: {
          source: 'machine-config',
          detail: 'machine.defaultProject',
        },
        home: {
          source: 'default',
        },
      },
    })
  })

  it('persists an AliceProject source atomically outside the selected home', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-supervisor-config-'))
    temporaryPaths.push(root)
    const context = await resolveStoredLaunchContext({}, {
      homeDir: join(root, 'user'),
      cwd: '/repo',
      platform: 'linux',
      env: { XDG_CONFIG_HOME: join(root, 'config') },
    })

    await persistAliceProjectLaunchConfig(context, {
      appDir: '/srv/OpenAlice',
    })

    const saved = JSON.parse(
      await readFile(supervisorConfigPath(context.supervisorRoot), 'utf8'),
    )
    expect(saved).toEqual({
      schemaVersion: 2,
      projects: {
        default: {
          name: 'default',
          appDir: '/srv/OpenAlice',
        },
      },
    })
    expect(context.supervisorRoot.startsWith(context.home)).toBe(false)

    const resolved = await resolveStoredLaunchContext({}, {
      homeDir: join(root, 'user'),
      cwd: '/elsewhere',
      platform: 'linux',
      env: { XDG_CONFIG_HOME: join(root, 'config') },
    })
    expect(resolved.appDir).toBe(resolve('/srv/OpenAlice'))
    expect(resolved.provenance.appDir).toEqual({
      source: 'project-config',
      detail: 'project.default.appDir',
    })
  })

  it('removes an AliceProject override when a setting returns to inheritance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-supervisor-inherit-'))
    temporaryPaths.push(root)
    const context = await resolveStoredLaunchContext({}, {
      homeDir: join(root, 'user'),
      platform: 'linux',
      env: { XDG_CONFIG_HOME: join(root, 'config') },
    })

    await persistAliceProjectLaunchConfig(context, {
      port: 49_001,
      updateChecks: false,
    })
    await persistAliceProjectLaunchConfig(context, {
      port: undefined,
    })

    const saved = JSON.parse(
      await readFile(supervisorConfigPath(context.supervisorRoot), 'utf8'),
    )
    expect(saved.projects.default).toEqual({
      name: 'default',
      updateChecks: false,
    })
  })

  it('persists machine defaults below AliceProject, environment, and CLI layers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-supervisor-machine-'))
    temporaryPaths.push(root)
    const homeDir = join(root, 'user')
    const context = await resolveStoredLaunchContext({}, {
      homeDir,
      platform: 'linux',
      env: { XDG_CONFIG_HOME: join(root, 'config') },
    })

    await persistMachineLaunchConfig(context, {
      home: join(root, 'machine-home'),
      port: 48_001,
      updateChecks: false,
    }, {
      homeDir,
      platform: 'linux',
    })

    await expect(readMachineLaunchConfig(context)).resolves.toEqual({
      home: await realpath(join(root, 'machine-home')),
      port: 48_001,
      updateChecks: false,
    })
    const inherited = await resolveStoredLaunchContext({}, {
      homeDir,
      platform: 'linux',
      env: { XDG_CONFIG_HOME: join(root, 'config') },
    })
    expect(inherited).toMatchObject({
      home: await realpath(join(root, 'machine-home')),
      port: 48_001,
      updateChecks: false,
      provenance: {
        home: { source: 'machine-config' },
        port: { source: 'machine-config' },
        updateChecks: { source: 'machine-config' },
      },
    })

    await persistAliceProjectLaunchConfig(inherited, { port: 48_002 })
    const overridden = await resolveStoredLaunchContext({ port: 48_004 }, {
      homeDir,
      platform: 'linux',
      env: {
        XDG_CONFIG_HOME: join(root, 'config'),
        OPENALICE_WEB_PORT: '48003',
      },
    })
    expect(overridden.port).toBe(48_004)
    expect(overridden.provenance.port.source).toBe('cli-flag')

    await persistMachineLaunchConfig(overridden, {
      home: undefined,
      port: undefined,
      updateChecks: undefined,
    }, {
      homeDir,
      platform: 'linux',
    })
    await expect(readMachineLaunchConfig(context)).resolves.toEqual({})
  })

  it('creates, lists, selects, and remembers named complete-home AliceProjects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-supervisor-projects-'))
    temporaryPaths.push(root)
    const homeDir = join(root, 'user')
    const configRoot = join(root, 'config')
    const context = await resolveStoredLaunchContext({}, {
      homeDir,
      cwd: root,
      platform: 'linux',
      env: { XDG_CONFIG_HOME: configRoot },
    })

    await createSupervisorAliceProject(
      context,
      'research',
      './research-home',
      { homeDir, cwd: root, platform: 'linux' },
    )
    const researchHome = await realpath(resolve(root, 'research-home'))

    const registry = await readSupervisorAliceProjectRegistry(context, {
      homeDir,
      cwd: root,
      platform: 'linux',
    })
    expect(registry).toMatchObject({
      defaultProject: 'research',
      projects: [
        {
          key: 'default',
          displayName: 'Default AliceProject',
          home: resolve(homeDir, '.openalice'),
          port: 47_331,
          portAutomatic: true,
          isDefault: false,
        },
        {
          key: 'research',
          displayName: 'Research',
          home: researchHome,
          port: 47_331,
          portAutomatic: true,
          isDefault: true,
        },
      ],
    })

    const selected = await resolveStoredLaunchContext({}, {
      homeDir,
      cwd: root,
      platform: 'linux',
      env: { XDG_CONFIG_HOME: configRoot },
    })
    expect(selected).toMatchObject({
      project: 'research',
      home: researchHome,
    })

    await persistSelectedSupervisorAliceProject(context, 'default')
    const saved = JSON.parse(
      await readFile(supervisorConfigPath(context.supervisorRoot), 'utf8'),
    )
    expect(saved.defaultProject).toBeUndefined()
    expect(saved.projects.research.home).toBe(researchHome)
    expect((await stat(researchHome)).isDirectory()).toBe(true)
    expect(saved.projects.research.product).toBeUndefined()
  })

  it('registers a transferred AliceProject without changing the remote default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-supervisor-transfer-register-'))
    temporaryPaths.push(root)
    const homeDir = join(root, 'user')
    const context = await resolveStoredLaunchContext({}, {
      homeDir,
      cwd: root,
      platform: 'linux',
      env: { XDG_CONFIG_HOME: join(root, 'config') },
    })
    await createSupervisorAliceProject(
      context,
      'research',
      join(root, 'research-home'),
      { homeDir, cwd: root, platform: 'linux' },
    )
    await createSupervisorAliceProject(
      context,
      'migrated',
      join(root, 'migrated-home'),
      {
        homeDir,
        cwd: root,
        platform: 'linux',
        displayName: 'Migrated Alice',
        select: false,
      },
    )

    const registry = await readSupervisorAliceProjectRegistry(context, {
      homeDir,
      cwd: root,
      platform: 'linux',
    })
    expect(registry.defaultProject).toBe('research')
    expect(registry.projects.find((project) => project.key === 'migrated')).toMatchObject({
      displayName: 'Migrated Alice',
      isDefault: false,
    })
  })

  it('stamps NanoAlice product on create and does not rewrite it later', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-supervisor-nano-'))
    temporaryPaths.push(root)
    const homeDir = join(root, 'user')
    const context = await resolveStoredLaunchContext({}, {
      homeDir,
      cwd: root,
      platform: 'linux',
      env: { XDG_CONFIG_HOME: join(root, 'config') },
    })
    await createSupervisorAliceProject(
      context,
      'office',
      join(root, 'office-home'),
      { homeDir, cwd: root, platform: 'linux', product: 'nano' },
    )
    const officeHome = await realpath(join(root, 'office-home'))
    const { aliceProjectProductStampPath } = await import('./alice-project-product.ts')
    expect(JSON.parse(await readFile(aliceProjectProductStampPath(officeHome), 'utf8'))).toEqual({
      version: 1,
      product: 'nano',
    })
    const selected = await resolveStoredLaunchContext({}, {
      homeDir,
      cwd: root,
      platform: 'linux',
      env: { XDG_CONFIG_HOME: join(root, 'config') },
    })
    await persistAliceProjectLaunchConfig(selected, { port: 48_010 })
    const saved = JSON.parse(await readFile(supervisorConfigPath(context.supervisorRoot), 'utf8'))
    expect(saved.projects.office.product).toBe('nano')
    expect(saved.projects.office.port).toBe(48_010)
  })

  it('rejects registration when an existing home was born as another product', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-supervisor-product-conflict-'))
    temporaryPaths.push(root)
    const homeDir = join(root, 'user')
    const projectHome = join(root, 'existing-home')
    const context = await resolveStoredLaunchContext({}, {
      homeDir,
      cwd: root,
      platform: 'linux',
      env: { XDG_CONFIG_HOME: join(root, 'config') },
    })
    const { writeAliceProjectProductStamp } = await import('./alice-project-product.ts')
    await writeAliceProjectProductStamp(projectHome, 'nano')

    await expect(createSupervisorAliceProject(
      context,
      'office',
      projectHome,
      { homeDir, cwd: root, platform: 'linux', product: 'trader' },
    )).rejects.toThrow(/was born as nano; it cannot be registered as trader/)

    const saved = await readSupervisorAliceProjectRegistry(context, {
      homeDir,
      cwd: root,
      platform: 'linux',
    })
    expect(saved.projects.map((project) => project.key)).not.toContain('office')
  })

  it('rejects duplicate, overlapping, and home-less named AliceProjects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-supervisor-collision-'))
    temporaryPaths.push(root)
    const homeDir = join(root, 'user')
    const context = await resolveStoredLaunchContext({}, {
      homeDir,
      cwd: root,
      platform: 'linux',
      env: { XDG_CONFIG_HOME: join(root, 'config') },
    })

    await expect(createSupervisorAliceProject(
      context,
      'nested',
      join(context.home, 'child'),
      { homeDir, cwd: root, platform: 'linux' },
    )).rejects.toThrow(/overlaps AliceProject "Default AliceProject"/)

    await createSupervisorAliceProject(
      context,
      'paper',
      join(root, 'paper-home'),
      { homeDir, cwd: root, platform: 'linux' },
    )
    await expect(createSupervisorAliceProject(
      context,
      'paper',
      join(root, 'another-home'),
      { homeDir, cwd: root, platform: 'linux' },
    )).rejects.toThrow(/already registered/)

    const unrelated = join(root, 'unrelated')
    await mkdir(unrelated)
    await writeFile(join(unrelated, 'notes.txt'), 'not OpenAlice')
    await expect(createSupervisorAliceProject(
      context,
      'unsafe',
      unrelated,
      { homeDir, cwd: root, platform: 'linux' },
    )).rejects.toThrow(/non-empty and is not an existing OpenAlice home/)

    const selected = await resolveStoredLaunchContext({}, {
      homeDir,
      cwd: root,
      platform: 'linux',
      env: { XDG_CONFIG_HOME: join(root, 'config') },
    })
    await expect(persistAliceProjectLaunchConfig(
      selected,
      { home: undefined },
    )).rejects.toThrow(/must keep an explicit complete home/)
  })

  it('resolves symlinked ancestors before checking nested-home collisions', async ({ skip }) => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-supervisor-symlink-'))
    temporaryPaths.push(root)
    const homeDir = join(root, 'user')
    const context = await resolveStoredLaunchContext({}, {
      homeDir,
      cwd: root,
      platform: 'linux',
      env: { XDG_CONFIG_HOME: join(root, 'config') },
    })
    const actual = join(root, 'actual')
    const alias = join(root, 'alias')
    await mkdir(actual)
    try {
      await symlink(actual, alias, 'dir')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        skip('symlinks unavailable on this runner')
        return
      }
      throw error
    }

    await persistAliceProjectLaunchConfig(
      context,
      { home: join(actual, 'default-home') },
      { homeDir, cwd: root, platform: 'linux' },
    )
    await expect(createSupervisorAliceProject(
      context,
      'nested',
      join(alias, 'default-home', 'nested'),
      { homeDir, cwd: root, platform: 'linux' },
    )).rejects.toThrow(/overlaps AliceProject/)
  })

  it('rejects corrupt, unknown, and mismatched configuration fields', () => {
    expect(() => parseSupervisorConfig({
      schemaVersion: 0,
    })).toThrow(/schemaVersion must be 2/)
    expect(() => parseSupervisorConfig({
      schemaVersion: 1,
      surprise: true,
    })).toThrow(/unknown field "surprise"/)
    expect(() => parseSupervisorConfig({
      schemaVersion: 1,
      instances: {
        research: { name: 'other' },
      },
    })).toThrow(/must match its registry key/)
    expect(() => parseSupervisorConfig({
      schemaVersion: 1,
      defaultInstance: 'missing',
    })).toThrow(/not present in instances/)
    expect(() => parseSupervisorConfig({
      schemaVersion: 2,
      extra: true,
      defaults: { port: 'nope' },
    })).toThrow(/defaults.port must be an integer/)
  })

  it('reports a newer schemaVersion before unknown-field validation', () => {
    try {
      parseSupervisorConfig({
        schemaVersion: 3,
        surprise: true,
        defaults: { futureDefault: true },
      })
      throw new Error('expected newer schemaVersion to fail')
    } catch (error) {
      expect(isNewerSupervisorSchemaError(error)).toBe(true)
      expect(isSupervisorConfigError(error)).toBe(true)
      expect(error).toMatchObject({
        code: 'ESUPERVISORSCHEMA',
        exitCode: 2,
      })
      expect((error as Error).message).toMatch(/schemaVersion 3 is newer than this OpenAlice/)
      expect((error as Error).message).not.toMatch(/unknown field/)
      expect((error as Error).message).not.toMatch(/must be 2/)
    }
  })

  it('preserves additive current-schema fields through parse and write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-supervisor-forward-'))
    temporaryPaths.push(root)
    const researchHome = join(root, 'research-home')
    await mkdir(researchHome, { recursive: true })
    const parsed = parseSupervisorConfig({
      schemaVersion: 2,
      futureRoot: 'keep-root',
      defaults: {
        port: 48_001,
        futureDefault: { enabled: true },
      },
      projects: {
        research: {
          name: 'research',
          home: researchHome,
          futureProject: ['a', 1],
        },
      },
    })
    expect(parsed).toEqual({
      schemaVersion: 2,
      futureRoot: 'keep-root',
      defaults: {
        port: 48_001,
        futureDefault: { enabled: true },
      },
      projects: {
        research: {
          name: 'research',
          home: researchHome,
          futureProject: ['a', 1],
        },
      },
    })

    const context = await resolveStoredLaunchContext({ project: 'research' }, {
      homeDir: join(root, 'user'),
      cwd: root,
      platform: 'linux',
      env: { XDG_CONFIG_HOME: join(root, 'config') },
      readConfig: async () => parsed,
    })
    await writeSupervisorConfig(context.supervisorRoot, parsed)
    await expect(readSupervisorConfig(context.supervisorRoot)).resolves.toEqual(parsed)

    await persistAliceProjectLaunchConfig(context, { port: 48_002 }, {
      homeDir: join(root, 'user'),
      cwd: root,
      platform: 'linux',
    })

    expect(JSON.parse(
      await readFile(supervisorConfigPath(context.supervisorRoot), 'utf8'),
    )).toEqual({
      schemaVersion: 2,
      futureRoot: 'keep-root',
      defaults: {
        port: 48_001,
        futureDefault: { enabled: true },
      },
      projects: {
        research: {
          name: 'research',
          home: researchHome,
          futureProject: ['a', 1],
          port: 48_002,
        },
      },
    })
  })

  it('reads the released v1 instance shape and canonicalizes it as AliceProject v2', () => {
    expect(parseSupervisorConfig({
      schemaVersion: 1,
      defaultInstance: 'research',
      instances: {
        research: {
          name: 'research',
          home: '/tmp/research',
        },
      },
    })).toEqual({
      schemaVersion: 2,
      defaultProject: 'research',
      projects: {
        research: {
          name: 'research',
          displayName: 'Research',
          home: '/tmp/research',
        },
      },
    })
  })
})
