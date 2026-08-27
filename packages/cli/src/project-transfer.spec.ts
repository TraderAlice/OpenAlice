import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { writeAliceProjectProductStamp } from './alice-project-product.ts'
import {
  planProjectTransfer,
  validateManifestPath,
} from './project-transfer.ts'
import { sealProjectTransferJson } from './project-transfer-secrets.ts'

const homes: string[] = []

afterEach(async () => {
  await Promise.all(homes.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('AliceProject transfer planner', () => {
  it('builds a secret-free portable manifest and excludes the complete Session plane', async () => {
    const home = await fixtureHome()
    const destinationRoot = await mkdtemp(join(tmpdir(), 'oa-transfer-destination-'))
    homes.push(destinationRoot)
    const plan = await planProjectTransfer({
      source: sourceProject(home),
      destinationMachineKey: 'cloud',
      destinationProjectKey: 'alice-cloud',
      destinationHome: join(destinationRoot, 'alice'),
      scheduledIssues: 'keep-blocked',
      now: () => new Date('2026-08-23T00:00:00Z'),
      randomId: () => 'transfer-test',
      isGitTracked: async (_root, path) => path.endsWith('tracked.json'),
    })

    expect(plan.readyToApply).toBe(true)
    expect(plan.destination.projectId).toMatch(/^alice-project-/)
    expect(plan.destination.requiredFreeBytes).toBeGreaterThan(plan.portable.bytes)
    expect(plan.portable.entries.map((entry) => entry.path)).toEqual(expect.arrayContaining([
      'data/config/ai-provider-manager.json',
      'data/config/market-data.json',
      'workspaces/workspaces/ws-one/.alice/sessions/tracked.json',
      'workspaces/workspaces/ws-one/research.txt',
    ]))
    expect(plan.portable.entries.map((entry) => entry.path)).not.toEqual(expect.arrayContaining([
      'sealing.key',
      'provider-keys.json',
      'data/config/accounts.json',
      'data/config/connectors.json',
      'data/config/auth.json',
      'data/config/ports.json',
      'workspaces/state/resume-identities.json',
      'workspaces/workspaces/ws-one/.alice/sessions/untracked.json',
    ]))
    expect(plan.portable.entries.find((entry) => entry.path === 'data/config/ai-provider-manager.json')?.transform)
      .toBe('strip-ai-credentials')
    expect(plan.credentials).toEqual({
      ai: { count: 1, vendors: ['openai'] },
      broker: { count: 1, presets: ['alpaca-paper'] },
      connector: { count: 1, adapters: ['telegram'] },
      providerKeys: { count: 2, vendors: ['fmp', 'fred'] },
    })
    expect(JSON.stringify(plan)).not.toContain('sk-transfer-secret')
    expect(JSON.stringify(plan)).not.toContain('broker-transfer-secret')
    expect(JSON.stringify(plan)).not.toContain('connector-transfer-secret')
    expect(JSON.stringify(plan)).not.toContain('provider-transfer-secret')
  })

  it('blocks apply until exact-Session scheduled Issues have an explicit policy', async () => {
    const home = await fixtureHome()
    const destinationRoot = await mkdtemp(join(tmpdir(), 'oa-transfer-destination-'))
    homes.push(destinationRoot)
    const plan = await planProjectTransfer({
      source: sourceProject(home),
      destinationMachineKey: 'cloud',
      destinationProjectKey: 'alice-cloud',
      destinationHome: join(destinationRoot, 'alice'),
      credentials: 'omit',
      randomId: () => 'transfer-policy',
      isGitTracked: async () => false,
    })
    expect(plan.readyToApply).toBe(false)
    expect(plan.blockers).toContainEqual(expect.objectContaining({ code: 'EISSUEPOLICY' }))
    expect(plan.scheduledIssues).toEqual([expect.objectContaining({
      workspaceId: 'ws-one',
      issueId: 'scheduled-owner',
      assignee: '@resume-old-owner',
    })])
  })

  it('marks only affected Issue files for explicit owner rewrite', async () => {
    const home = await fixtureHome()
    const destinationRoot = await mkdtemp(join(tmpdir(), 'oa-transfer-destination-'))
    homes.push(destinationRoot)
    const plan = await planProjectTransfer({
      source: sourceProject(home),
      destinationMachineKey: 'cloud',
      destinationProjectKey: 'alice-cloud',
      destinationHome: join(destinationRoot, 'alice'),
      scheduledIssues: 'new-then-resume',
      randomId: () => 'transfer-rewrite',
      isGitTracked: async () => false,
    })
    expect(plan.portable.entries.find((entry) => entry.path.endsWith('scheduled-owner.md'))?.transform)
      .toBe('rewrite-issue-owner')
    expect(plan.portable.entries.find((entry) => entry.path.endsWith('board-only.md'))?.transform)
      .toBeUndefined()
  })

  it('blocks split launcher roots without interpreting remote POSIX paths locally', async () => {
    const home = await fixtureHome()
    const plan = await planProjectTransfer({
      source: sourceProject(home),
      destinationMachineKey: 'cloud',
      destinationProjectKey: 'alice-cloud',
      destinationHome: '/home/alice/.openalice-copy',
      scheduledIssues: 'keep-blocked',
      env: { AQ_LAUNCHER_ROOT: join(home, 'external-workspaces') },
      randomId: () => 'transfer-blocked',
      isGitTracked: async () => false,
    })
    expect(plan.blockers.map((blocker) => blocker.code)).toEqual(['ESPLITROOT'])
    expect(plan.destination.home).toBe('/home/alice/.openalice-copy')
  })

  it.each(['../escape', '/absolute', 'safe\\windows-ambiguous', 'bad\u0000name'])(
    'rejects unsafe manifest path %j',
    (path) => expect(() => validateManifestPath(path)).toThrow('Unsafe transfer path'),
  )

  it.skipIf(process.platform === 'win32')('rejects symlinks that escape the selected home', async () => {
    const home = await fixtureHome()
    await symlink('../../../../outside', join(home, 'workspaces', 'workspaces', 'ws-one', 'escape'))
    await expect(planProjectTransfer({
      source: sourceProject(home),
      destinationMachineKey: 'cloud',
      destinationProjectKey: 'alice-cloud',
      destinationHome: join(tmpdir(), 'oa-transfer-other'),
      scheduledIssues: 'keep-blocked',
      randomId: () => 'transfer-symlink',
      isGitTracked: async () => false,
    })).rejects.toThrow('escapes the AliceProject home')
  })
})

async function fixtureHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'oa-transfer-source-'))
  homes.push(home)
  await writeAliceProjectProductStamp(home, 'nano')
  await writeJson(join(home, 'data', 'config', 'ai-provider-manager.json'), {
    activeProfile: 'default',
    credentials: {
      'openai-1': { vendor: 'openai', authType: 'api-key', apiKey: 'sk-transfer-secret' },
    },
  })
  await writeJson(join(home, 'data', 'config', 'market-data.json'), {
    providerKeys: { fmp: 'provider-transfer-secret' },
    providers: { equity: 'fmp' },
  })
  await writeJson(join(home, 'provider-keys.json'), { fred: 'global-provider-transfer-secret' })
  await sealProjectTransferJson(home, join('data', 'config', 'accounts.json'), [
    { id: 'paper', presetId: 'alpaca-paper', presetConfig: { apiKey: 'broker-transfer-secret' } },
  ])
  await sealProjectTransferJson(home, join('data', 'config', 'connectors.json'), {
    version: 1,
    adapters: { telegram: { enabled: true, settings: { token: 'connector-transfer-secret' } } },
  })
  await writeJson(join(home, 'data', 'config', 'ports.json'), { web: 47331 })
  await writeJson(join(home, 'data', 'config', 'auth.json'), { tokenHash: 'machine-local' })

  const workspace = join(home, 'workspaces', 'workspaces', 'ws-one')
  await mkdir(join(workspace, '.alice', 'sessions'), { recursive: true })
  await mkdir(join(workspace, '.alice', 'issues'), { recursive: true })
  await writeFile(join(workspace, 'research.txt'), 'portable research\n')
  await writeJson(join(workspace, '.alice', 'sessions', 'tracked.json'), { resumeId: 'tracked' })
  await writeJson(join(workspace, '.alice', 'sessions', 'untracked.json'), { resumeId: 'untracked' })
  await writeFile(join(workspace, '.alice', 'issues', 'scheduled-owner.md'), [
    '---',
    'title: Scheduled owner',
    'assignee: "@resume-old-owner"',
    'when: { kind: every, every: 1h }',
    '---',
    'Continue the work.',
    '',
  ].join('\n'))
  await writeFile(join(workspace, '.alice', 'issues', 'board-only.md'), [
    '---',
    'title: Board only',
    'assignee: "@resume-old-owner"',
    '---',
    'Do the work.',
    '',
  ].join('\n'))
  await writeJson(join(home, 'workspaces', 'workspaces.json'), {
    version: 1,
    workspaces: [{ id: 'ws-one', tag: 'one', dir: workspace, createdAt: '2026-08-23T00:00:00Z' }],
  })
  await writeJson(join(home, 'workspaces', 'state', 'workspace-catalog.json'), {
    version: 1,
    workspaces: [{ id: 'ws-one', tag: 'one', activeDir: workspace, lifecycle: 'active' }],
  })
  await writeJson(join(home, 'workspaces', 'state', 'resume-identities.json'), { version: 1, records: {} })
  return home
}

function sourceProject(home: string) {
  return {
    id: 'alice-project-source',
    key: 'local-source',
    displayName: 'Local Source',
    home,
    port: 47331,
    portAutomatic: true,
    isDefault: true,
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}
