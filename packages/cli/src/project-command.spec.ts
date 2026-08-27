import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

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

  it('prints a blocked transfer plan without stopping a running source', async () => {
    const env = await setupProjects()
    const stdout: string[] = []
    const stop = vi.fn()
    const send = vi.fn()
    const code = await runProjectCommand([
      'transfer',
      '--from', 'default',
      '--to-machine', 'cloud',
      '--to-project', 'remote-copy',
      '--to-home', '/srv/openalice/remote-copy',
      '--session-owner-policy', 'keep-blocked',
      '--plan',
      '--json',
    ], transferIo(env, {
      stdout: { write: (chunk: string) => { stdout.push(chunk) } },
      inspectSourceRuntime: async () => ({ class: 'running', owner: { surface: 'cli-server' } }),
      stopSourceRuntime: stop,
      sendTransfer: send,
    }))
    expect(code).toBe(1)
    const result = JSON.parse(stdout.join('')) as { plan: { blockers: Array<{ code: string }> } }
    expect(result.plan.blockers).toContainEqual(expect.objectContaining({ code: 'ESOURCERUNNING' }))
    expect(stop).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('requires and honors separate source-stop authority before transfer apply', async () => {
    const env = await setupProjects()
    const inspectSource = vi.fn()
      .mockResolvedValueOnce({ class: 'running', owner: { surface: 'cli-server' } })
      .mockResolvedValue({ class: 'absent', owner: null })
    const stop = vi.fn(async () => undefined)
    const send = vi.fn(async ({ plan }) => receipt(plan.transferId, plan.destination.home))
    const stdout: string[] = []
    await expect(runProjectCommand([
      'transfer',
      '--from', 'default',
      '--to-machine', 'cloud',
      '--to-project', 'remote-copy',
      '--to-home', '/srv/openalice/remote-copy',
      '--session-owner-policy', 'keep-blocked',
      '--yes',
      '--stop-source',
    ], transferIo(env, {
      stdout: { write: (chunk: string) => { stdout.push(chunk) } },
      inspectSourceRuntime: inspectSource,
      stopSourceRuntime: stop,
      sendTransfer: send,
    }))).resolves.toBe(0)
    expect(stop).toHaveBeenCalledWith(env.defaultHome)
    expect(send).toHaveBeenCalledOnce()
    expect(stdout.join('')).toContain('AliceProject transfer complete')
    expect(stdout.join('')).toContain('Sessions imported: 0')
  })

  it('refuses to stop a foreign source owner', async () => {
    const env = await setupProjects()
    const stop = vi.fn()
    await expect(runProjectCommand([
      'transfer',
      '--from', 'default',
      '--to-machine', 'cloud',
      '--to-project', 'remote-copy',
      '--to-home', '/srv/openalice/remote-copy',
      '--session-owner-policy', 'keep-blocked',
      '--yes',
      '--stop-source',
    ], transferIo(env, {
      inspectSourceRuntime: async () => ({ class: 'running', owner: { surface: 'electron' } }),
      stopSourceRuntime: stop,
    }))).rejects.toThrow('owned by electron')
    expect(stop).not.toHaveBeenCalled()
  })

  it('re-probes and refuses a destination collision introduced after consent', async () => {
    const env = await setupProjects()
    const inspectMachine = vi.fn()
      .mockResolvedValueOnce(remoteInventory())
      .mockResolvedValueOnce(remoteInventory([{
        key: 'remote-copy',
        home: '/srv/openalice/another-home',
      }]))
    const send = vi.fn()
    await expect(runProjectCommand([
      'transfer',
      '--from', 'default',
      '--to-machine', 'cloud',
      '--to-project', 'remote-copy',
      '--to-home', '/srv/openalice/remote-copy',
      '--session-owner-policy', 'keep-blocked',
      '--yes',
    ], transferIo(env, {
      inspectMachine,
      sendTransfer: send,
      stdout: { write: () => undefined },
    })))
      .rejects.toThrow('Destination changed after planning')
    expect(send).not.toHaveBeenCalled()
  })

  it('dispatches the private receive endpoint without exposing another parser', async () => {
    const stdout: string[] = []
    await expect(runProjectCommand(['transfer-receive'], {
      stdout: { write: (chunk) => { stdout.push(chunk) } },
      receiveTransfer: async () => receipt('transfer-receive', '/srv/openalice/received'),
    })).resolves.toBe(0)
    expect(JSON.parse(stdout.join(''))).toMatchObject({ transferId: 'transfer-receive' })
  })

  it('documents the command surface', () => {
    expect(formatProjectHelp()).toContain('copy-ai-creds')
    expect(formatProjectHelp()).toContain('project use')
    expect(formatProjectHelp()).toContain('project transfer')
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

function transferIo(
  env: Awaited<ReturnType<typeof setupProjects>>,
  overrides: Record<string, unknown> = {},
) {
  const source = {
    id: 'alice-project-source',
    key: 'default',
    displayName: 'Default AliceProject',
    home: env.defaultHome,
    port: 47331,
    portAutomatic: true,
    isDefault: true,
  }
  return {
    resolveContext: async () => env.context,
    loadRegistry: async () => ({ defaultProject: 'default', projects: [source] }),
    loadMachines: async () => ({
      defaultMachine: 'local',
      machines: [{
        key: 'cloud',
        displayName: 'Cloud',
        sshTarget: 'alice@example.com',
        isDefault: false,
      }],
    }),
    inspectMachine: async () => remoteInventory(),
    inspectSourceRuntime: async () => ({ class: 'absent', owner: null }),
    planTransfer: async (input: { destinationHome: string; destinationProjectKey: string }) => ({
      schemaVersion: 1 as const,
      transferId: 'transfer-command',
      generatedAt: '2026-08-23T00:00:00Z',
      source: { projectId: source.id, key: source.key, displayName: source.displayName, home: source.home, product: 'trader' as const },
      destination: {
        machineKey: 'cloud',
        projectId: 'alice-project-destination',
        key: input.destinationProjectKey,
        displayName: 'Remote Copy',
        home: input.destinationHome,
        requiredFreeBytes: 64 * 1024 * 1024,
      },
      policy: { credentials: 'include' as const, scheduledIssues: 'keep-blocked' as const },
      portable: { entries: [], files: 0, directories: 0, symlinks: 0, bytes: 0 },
      excluded: [],
      credentials: {
        ai: { count: 0, vendors: [] },
        broker: { count: 0, presets: [] },
        connector: { count: 0, adapters: [] },
        providerKeys: { count: 0, vendors: [] },
      },
      scheduledIssues: [],
      blockers: [],
      readyToApply: true,
    }),
    ...overrides,
  }
}

function remoteInventory(projects: Array<{ key: string; home: string }> = []) {
  return {
    key: 'cloud',
    displayName: 'Cloud',
    registered: true,
    connection: 'online' as const,
    sshTarget: 'alice@example.com',
    platform: 'linux',
    arch: 'x64',
    hostname: 'cloud',
    cliVersion: '0.90.0-beta',
    defaultProject: 'default',
    projects: projects.map((project) => ({
      id: `alice-project-${project.key}-test`,
      key: project.key,
      displayName: project.key,
      home: project.home,
      product: 'trader' as const,
      port: 47331,
      portAutomatic: true,
      isDefault: false,
      available: true,
      runtime: {
        class: 'absent' as const,
        state: 'absent',
        ownerSurface: null,
        uptimeSeconds: null,
        webEndpoint: null,
        components: {},
      },
    })),
    capabilities: {
      inspect: true,
      lifecycle: true,
      openTunnel: true,
      transferReceive: true,
      credentialReseal: true,
    },
    issue: null,
  }
}

function receipt(transferId: string, destinationHome: string) {
  return {
    schemaVersion: 1 as const,
    transferId,
    sourceProjectId: 'alice-project-source',
    destinationProjectId: 'alice-project-destination',
    destinationHome,
    files: 0,
    bytes: 0,
    manifestSha256: 'a'.repeat(64),
    credentials: 'included' as const,
    sessionsImported: 0 as const,
    publishedAt: '2026-08-23T01:00:00Z',
  }
}
