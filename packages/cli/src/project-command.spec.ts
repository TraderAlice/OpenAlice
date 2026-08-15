import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { AI_PROVIDER_FILE_REL } from './ai-credential-copy.ts'
import { formatProjectHelp, runProjectCommand } from './project-command.ts'
import {
  createSupervisorAliceProject,
  persistMachineLaunchConfig,
  persistSelectedSupervisorAliceProject,
  resolveStoredLaunchContext,
  supervisorConfigPath,
} from './supervisor-config.ts'

const temporary: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('openalice project', () => {
  it('lists registered AliceProjects and can select one', async () => {
    const env = await setupProjects()
    const listed: string[] = []
    await expect(runProjectCommand(['list'], {
      stdout: { write: (chunk) => { listed.push(chunk) } },
      resolveContext: async () => env.context,
    })).resolves.toBe(0)
    expect(listed.join('')).toContain('office')
    expect(listed.join('')).toContain('default')

    const used: string[] = []
    await expect(runProjectCommand(['use', 'office'], {
      stdout: { write: (chunk) => { used.push(chunk) } },
      resolveContext: async () => env.context,
    })).resolves.toBe(0)
    expect(used.join('')).toContain('office')
    const saved = JSON.parse(await env.readConfig()) as { defaultProject?: string }
    expect(saved.defaultProject).toBe('office')
  })

  it('copies AI credentials with --yes', async () => {
    const env = await setupProjects()
    await mkdir(join(env.defaultHome, 'data', 'config'), { recursive: true })
    await writeFile(join(env.defaultHome, AI_PROVIDER_FILE_REL), `${JSON.stringify({
      credentials: {
        'openai-1': { vendor: 'openai', authType: 'api-key', apiKey: 'sk-office-copy' },
      },
    })}\n`)
    const stdout: string[] = []
    await expect(runProjectCommand(
      ['copy-ai-creds', '--from', 'default', '--to', 'office', '--yes'],
      {
        stdout: { write: (chunk) => { stdout.push(chunk) } },
        resolveContext: async () => env.context,
      },
    )).resolves.toBe(0)
    expect(stdout.join('')).toContain('Added 1')
    expect(stdout.join('')).not.toContain('sk-office-copy')
    const dest = JSON.parse(await env.readOfficeVault()) as {
      credentials: Record<string, { apiKey?: string }>
    }
    expect(dest.credentials['openai-1']?.apiKey).toBe('sk-office-copy')
  })

  it('prints a JSON registry summary', async () => {
    const env = await setupProjects()
    const listed: string[] = []
    await expect(runProjectCommand(['--json'], {
      stdout: { write: (chunk) => { listed.push(chunk) } },
      resolveContext: async () => env.context,
    })).resolves.toBe(0)
    const payload = JSON.parse(listed.join('')) as {
      defaultProject: string
      projects: Array<{ key: string }>
    }
    expect(payload.projects.map((entry) => entry.key)).toEqual(
      expect.arrayContaining(['default', 'office']),
    )
  })

  it('requires --from and --to with --yes', async () => {
    const env = await setupProjects()
    await expect(runProjectCommand(['copy-ai-creds', '--yes'], {
      resolveContext: async () => env.context,
    })).rejects.toMatchObject({ code: 'EUSAGE' })
  })

  it('rejects the same project even when its credential vault is empty', async () => {
    const env = await setupProjects()
    await expect(runProjectCommand(
      ['copy-ai-creds', '--from', 'office', '--to', 'office', '--yes'],
      { resolveContext: async () => env.context },
    )).rejects.toMatchObject({ code: 'EUSAGE' })
  })

  it('rejects an unknown project key', async () => {
    const env = await setupProjects()
    await expect(runProjectCommand(['use', 'missing'], {
      resolveContext: async () => env.context,
    })).rejects.toMatchObject({ code: 'EUSAGE' })
  })

  it('documents the command surface', () => {
    expect(formatProjectHelp()).toContain('copy-ai-creds')
    expect(formatProjectHelp()).toContain('project use')
  })
})

async function setupProjects() {
  const root = await mkdtemp(join(tmpdir(), 'oa-project-cmd-'))
  temporary.push(root)
  const homeDir = join(root, 'user')
  const defaultHome = join(root, 'default-home')
  const officeHome = join(root, 'office-home')
  const options = {
    homeDir,
    cwd: root,
    platform: 'linux' as const,
    env: { XDG_CONFIG_HOME: join(root, 'config') },
  }
  const context = await resolveStoredLaunchContext({}, options)
  await persistMachineLaunchConfig(context, { home: defaultHome }, options)
  const withHome = await resolveStoredLaunchContext({}, options)
  await createSupervisorAliceProject(withHome, 'office', officeHome, options)
  await persistSelectedSupervisorAliceProject(withHome, 'default', options)
  const ready = await resolveStoredLaunchContext({}, options)
  return {
    context: ready,
    defaultHome,
    officeHome,
    async readConfig() {
      const { readFile } = await import('node:fs/promises')
      return readFile(supervisorConfigPath(ready.supervisorRoot), 'utf8')
    },
    async readOfficeVault() {
      const { readFile } = await import('node:fs/promises')
      return readFile(join(officeHome, AI_PROVIDER_FILE_REL), 'utf8')
    },
  }
}
