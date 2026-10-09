import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { aliceProjectProductStampPath } from '../../../packages/cli/src/alice-project-product.ts'
import {
  parseCreateAliceProjectArgs,
  runCreateAliceProjectCommand,
} from '../../../packages/cli/src/create-alice-project.ts'
import { readSupervisorConfig, supervisorConfigPath, writeSupervisorConfig } from '../../../packages/cli/src/supervisor-config.ts'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('openalice create alice-project', () => {
  it('requires name and home when --yes is set', async () => {
    expect(parseCreateAliceProjectArgs(['--yes']).yes).toBe(true)
    await expect(runCreateAliceProjectCommand(['--yes'])).rejects.toThrow(
      /--yes requires --name and --home/,
    )
  })

  it.each([
    null,
    { machine: 'local', project: 'default' },
    { machine: 'cloud', project: 'research' },
  ])('creates a NanoAlice project without changing Default %j', async (defaultTarget) => {
    const root = await mkdtemp(join(tmpdir(), 'create-nano-'))
    temporary.push(root)
    const homeDir = join(root, 'user')
    const home = join(root, 'office-home')
    const { resolveStoredLaunchContext } = await import('../../../packages/cli/src/supervisor-config.ts')
    const context = await resolveStoredLaunchContext({ project: 'default' }, {
      homeDir,
      cwd: root,
      platform: 'linux',
      env: { XDG_CONFIG_HOME: join(root, 'config') },
    })
    await writeSupervisorConfig(context.supervisorRoot, {
      ...await readSupervisorConfig(context.supervisorRoot),
      schemaVersion: 3,
      defaultTarget,
    })
    const stdout: string[] = []
    await expect(runCreateAliceProjectCommand(
      ['--name', 'office', '--home', home, '--product', 'nano', '--yes'],
      {
        stdout: { write: (chunk) => { stdout.push(chunk) } },
        resolveContext: async () => context,
        homeDir,
      },
    )).resolves.toBe(0)
    expect(JSON.parse(await readFile(join(home, 'workspace-setup.json'), 'utf8')).pending).toEqual(['chat', 'auto-quant', 'auto-prediction'])
    expect(stdout.join('')).toContain('NanoAlice')
    expect(stdout.join('')).toContain('Lifecycle default unchanged.')
    expect(stdout.join('')).not.toContain('Selected as')
    expect(stdout.join('')).toContain('openalice up --project office')
    expect(JSON.parse(await readFile(aliceProjectProductStampPath(home), 'utf8'))).toEqual({
      version: 1,
      product: 'nano',
    })
    const saved = JSON.parse(await readFile(
      supervisorConfigPath(context.supervisorRoot),
      'utf8',
    )) as { defaultTarget: unknown; projects?: { office?: { product?: string } } }
    expect(saved.projects?.office?.product).toBe('nano')
    expect(saved.defaultTarget).toEqual(defaultTarget)
  })
})

it('keeps creation selection fixed to the three default Workspaces', () => {
  expect(parseCreateAliceProjectArgs([])).not.toHaveProperty('workspaces')
  expect(() => parseCreateAliceProjectArgs(['--workspaces', 'none'])).toThrow('Unknown option')
})

it('refuses to initialize a non-empty GUI destination before consulting the registry', async () => {
  const home = await mkdtemp(join(tmpdir(), 'create-protected-'))
  temporary.push(home)
  await writeFile(join(home, 'existing.txt'), 'keep me')
  let resolved = false
  await expect(runCreateAliceProjectCommand(['--name', 'research', '--home', home, '--yes', '--require-empty'], {
    resolveContext: async () => { resolved = true; throw new Error('must not resolve') },
  })).rejects.toThrow('new or empty')
  expect(resolved).toBe(false)
  expect(await readFile(join(home, 'existing.txt'), 'utf8')).toBe('keep me')
})
