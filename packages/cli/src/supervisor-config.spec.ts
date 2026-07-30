import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  parseSupervisorConfig,
  persistInstanceLaunchConfig,
  resolveStoredLaunchContext,
  supervisorConfigPath,
} from './supervisor-config.ts'

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )))
})

describe('Supervisor configuration', () => {
  it('loads machine and selected-instance layers below environment and flags', async () => {
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
            home: '/instance-home',
            port: 42_000,
            appDir: '/instance-app',
          },
        },
      }),
    })

    expect(context).toMatchObject({
      instance: 'research',
      home: '/env-home',
      port: 44_000,
      appDir: '/instance-app',
      provenance: {
        instance: { source: 'machine-config' },
        home: { source: 'environment' },
        port: { source: 'cli-flag' },
        appDir: { source: 'instance-config' },
      },
    })
  })

  it('persists an instance source atomically outside the selected home', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-supervisor-config-'))
    temporaryPaths.push(root)
    const context = await resolveStoredLaunchContext({}, {
      homeDir: join(root, 'user'),
      cwd: '/repo',
      platform: 'linux',
      env: { XDG_CONFIG_HOME: join(root, 'config') },
    })

    await persistInstanceLaunchConfig(context, {
      appDir: '/srv/OpenAlice',
    })

    const saved = JSON.parse(
      await readFile(supervisorConfigPath(context.supervisorRoot), 'utf8'),
    )
    expect(saved).toEqual({
      schemaVersion: 1,
      instances: {
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
      source: 'instance-config',
      detail: 'instance.default.appDir',
    })
  })

  it('removes an instance override when a setting returns to inheritance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-supervisor-inherit-'))
    temporaryPaths.push(root)
    const context = await resolveStoredLaunchContext({}, {
      homeDir: join(root, 'user'),
      platform: 'linux',
      env: { XDG_CONFIG_HOME: join(root, 'config') },
    })

    await persistInstanceLaunchConfig(context, {
      port: 49_001,
      updateChecks: false,
    })
    await persistInstanceLaunchConfig(context, {
      port: undefined,
    })

    const saved = JSON.parse(
      await readFile(supervisorConfigPath(context.supervisorRoot), 'utf8'),
    )
    expect(saved.instances.default).toEqual({
      name: 'default',
      updateChecks: false,
    })
  })

  it('rejects corrupt, unknown, and mismatched configuration fields', () => {
    expect(() => parseSupervisorConfig({
      schemaVersion: 2,
    })).toThrow(/schemaVersion must be 1/)
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
  })
})
