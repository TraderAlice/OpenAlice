import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { aliceProjectProductStampPath } from './alice-project-product.ts'
import {
  parseCreateAliceProjectArgs,
  runCreateAliceProjectCommand,
} from './create-alice-project.ts'
import { supervisorConfigPath } from './supervisor-config.ts'

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

  it('creates a NanoAlice project stamp and registry entry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'create-nano-'))
    temporary.push(root)
    const homeDir = join(root, 'user')
    const home = join(root, 'office-home')
    const { resolveStoredLaunchContext } = await import('./supervisor-config.ts')
    const context = await resolveStoredLaunchContext({}, {
      homeDir,
      cwd: root,
      platform: 'linux',
      env: { XDG_CONFIG_HOME: join(root, 'config') },
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
    expect(stdout.join('')).toContain('NanoAlice')
    expect(stdout.join('')).toContain('openalice up --project office')
    expect(JSON.parse(await readFile(aliceProjectProductStampPath(home), 'utf8'))).toEqual({
      version: 1,
      product: 'nano',
    })
    const saved = JSON.parse(await readFile(
      supervisorConfigPath(context.supervisorRoot),
      'utf8',
    )) as { projects?: { office?: { product?: string } } }
    expect(saved.projects?.office?.product).toBe('nano')
  })
})
