import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

import { writeAliceProjectProductStamp } from './alice-project-product.ts'
import { transformProjectTransferFile } from './project-transfer-files.ts'
import {
  planProjectTransfer,
  validateManifestPath,
} from './project-transfer.ts'
import { sealProjectTransferJson } from './project-transfer-secrets.ts'

const homes: string[] = []
const execFile = promisify(execFileCallback)

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
      'workspaces/workspaces/runtime-selection.json',
      'workspaces/workspaces/ws-one/.claude/skills/portable/SKILL.md',
      'workspaces/workspaces/ws-one/.alice/sessions/tracked.json',
      'workspaces/workspaces/ws-one/research.txt',
    ]))
    expect(plan.portable.entries.map((entry) => entry.path)).not.toEqual(expect.arrayContaining([
      'sealing.key',
      'provider-keys.json',
      'data/config/accounts.json',
      'data/config/connectors.json',
      'data/config/auth.json',
      'data/config/auth.json.previous',
      'data/config/ports.json',
      'data/config/ports.json.backup',
      'data/config/sessions.json',
      'data/config/sessions.json.tmp',
      'data/config/accounts.json.backup-canary',
      'data/config/connectors.json.tmp-canary',
      'data/config/ai-provider-manager.json.backup-canary',
      'data/config/.ai-provider-manager.123.tmp',
      'data/config/market-data.json.previous',
      'data/_backup/pre-migration/config/ai-provider-manager.json',
      'demo-text-backups/provider-canary.json',
      '.openalice-transfer-receipt.json',
      '.cli-update-check.json',
      '.cli-install.lock/pid',
      '.cli-install.lock.guard',
      'provider-keys.json.backup',
      'sealing.key.previous',
      'workspaces/workspaces.json.before-transfer',
      'workspaces/state/workspace-catalog.json.backup',
      'workspaces/state/resume-identities.json',
      'workspaces/state/runtime.lock/owner.json',
      'workspaces/workspaces/ws-one/.alice/sessions/untracked.json',
      'workspaces/workspaces/opencode.json',
      'workspaces/workspaces/ws-one/.claude/settings.local.json',
      'workspaces/workspaces/ws-one/.claude/openalice-provider.json',
      'workspaces/workspaces/ws-one/.codex/env.json',
      'workspaces/workspaces/ws-one/.codex/openalice-home/auth.json',
      'workspaces/workspaces/ws-one/.codex/sessions/rollout.jsonl',
      'workspaces/workspaces/ws-one/opencode.json',
      'workspaces/workspaces/ws-one/.opencode/openalice-provider.json',
      'workspaces/workspaces/ws-one/.pi/settings.json',
      'workspaces/workspaces/ws-one/.pi/openalice-provider.json',
      'workspaces/workspaces/ws-one/.pi/extensions/openalice-provider.ts',
      'workspaces/workspaces/ws-one/.pi-agent/auth.json',
      'data/logs/connector-io.jsonl',
    ]))
    expect(plan.portable.entries.find((entry) => entry.path === 'data/config/ai-provider-manager.json')?.transform)
      .toBe('strip-ai-credentials')
    const catalogEntry = plan.portable.entries.find((entry) => entry.path === 'workspaces/state/workspace-catalog.json')
    expect(catalogEntry?.transform).toBe('workspace-catalog-paths')
    expect(plan.credentials).toEqual({
      ai: { count: 2, vendors: ['google', 'openai'] },
      broker: { count: 1, presets: ['alpaca-paper'] },
      connector: { count: 1, adapters: ['telegram'] },
      providerKeys: { count: 2, vendors: ['fmp', 'fred'] },
    })
    expect(JSON.stringify(plan)).not.toContain('sk-transfer-secret')
    expect(JSON.stringify(plan)).not.toContain('broker-transfer-secret')
    expect(JSON.stringify(plan)).not.toContain('connector-transfer-secret')
    expect(JSON.stringify(plan)).not.toContain('provider-transfer-secret')
    expect(JSON.stringify(plan)).not.toContain('legacy-ai-transfer-secret')
    expect(JSON.stringify(plan)).not.toContain('derived-secret-canary')
    expect(JSON.stringify(plan)).not.toContain('native-agent-secret-canary')
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
      readCredentials: async () => { throw new Error('omit must not read credentials') },
      randomId: () => 'transfer-policy',
      isGitTracked: async () => false,
    })
    expect(plan.readyToApply).toBe(false)
    expect(plan.credentials.ai.count).toBe(0)
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

  it('derives a stable transaction id so a new CLI process can retry registration', async () => {
    const home = await fixtureHome()
    const input = {
      source: sourceProject(home),
      destinationMachineKey: 'cloud',
      destinationProjectKey: 'alice-cloud',
      destinationHome: '/srv/openalice/alice-cloud',
      credentials: 'omit' as const,
      scheduledIssues: 'keep-blocked' as const,
      isGitTracked: async () => false,
    }
    const first = await planProjectTransfer({
      ...input,
      now: () => new Date('2026-08-23T00:00:00Z'),
    })
    const second = await planProjectTransfer({
      ...input,
      now: () => new Date('2026-08-24T00:00:00Z'),
    })
    expect(second.transferId).toBe(first.transferId)
    expect(second.generatedAt).not.toBe(first.generatedAt)
  })

  it.each(['../escape', '/absolute', 'safe\\windows-ambiguous', 'bad\u0000name'])(
    'rejects unsafe manifest path %j',
    (path) => expect(() => validateManifestPath(path)).toThrow('Unsafe transfer path'),
  )

  it('rewrites remote Workspace paths with POSIX semantics on every sender OS', () => {
    const transformed = transformProjectTransferFile({
      path: 'workspaces/state/workspace-catalog.json',
      transform: 'workspace-catalog-paths',
      bytes: Buffer.from(JSON.stringify({
        workspaces: [
          { id: 'active-one', activeDir: 'C:\\source\\active-one', lifecycle: 'active' },
          {
            id: '.pi-agent',
            activeDir: 'C:\\source\\.pi-agent',
            departedDir: 'C:\\source\\.pi-agent',
            lifecycle: 'departed',
            legacyImported: true,
          },
        ],
      })),
      destinationHome: '/srv/openalice/main-cloud',
    })
    const catalog = JSON.parse(transformed.toString('utf8'))
    expect(catalog.workspaces).toEqual([expect.objectContaining({
      id: 'active-one',
      activeDir: '/srv/openalice/main-cloud/workspaces/workspaces/active-one',
    })])
  })

  it.skipIf(process.platform === 'win32')('excludes machine-local symlinks and keeps contained links portable', async () => {
    const home = await fixtureHome()
    await symlink('../../../../outside', join(home, 'workspaces', 'workspaces', 'ws-one', 'escape'))
    await symlink('research.txt', join(home, 'workspaces', 'workspaces', 'ws-one', 'contained'))
    const plan = await planProjectTransfer({
      source: sourceProject(home),
      destinationMachineKey: 'cloud',
      destinationProjectKey: 'alice-cloud',
      destinationHome: join(tmpdir(), 'oa-transfer-other'),
      scheduledIssues: 'keep-blocked',
      randomId: () => 'transfer-symlink',
      isGitTracked: async () => false,
    })
    expect(plan.portable.entries).toContainEqual(expect.objectContaining({
      path: 'workspaces/workspaces/ws-one/contained',
      kind: 'symlink',
      linkTarget: 'research.txt',
    }))
    expect(plan.portable.entries.map((entry) => entry.path))
      .not.toContain('workspaces/workspaces/ws-one/escape')
    expect(plan.excluded.find((entry) => entry.reason === 'machine-local')?.files)
      .toBeGreaterThanOrEqual(4)
  })

  it.skipIf(process.platform === 'win32')('blocks linked worktrees instead of silently dropping their Git state', async () => {
    const home = await fixtureHome()
    const repository = await mkdtemp(join(tmpdir(), 'oa-transfer-worktree-owner-'))
    homes.push(repository)
    await execFile('git', ['init', '-q'], { cwd: repository })
    await writeFile(join(repository, 'README.md'), 'linked workspace\n')
    await execFile('git', ['add', 'README.md'], { cwd: repository })
    await execFile('git', [
      '-c', 'user.name=OpenAlice Test',
      '-c', 'user.email=openalice@example.test',
      'commit', '-qm', 'fixture',
    ], { cwd: repository })
    const linked = join(home, 'workspaces', 'workspaces', 'linked')
    await execFile('git', ['worktree', 'add', '--detach', linked, 'HEAD'], { cwd: repository })

    const plan = await planProjectTransfer({
      source: sourceProject(home),
      destinationMachineKey: 'cloud',
      destinationProjectKey: 'alice-cloud',
      destinationHome: join(tmpdir(), 'oa-transfer-linked-worktree'),
      scheduledIssues: 'keep-blocked',
      randomId: () => 'transfer-linked-worktree',
    })
    const paths = plan.portable.entries.map((entry) => entry.path)
    expect(paths).toContain('workspaces/workspaces/linked/README.md')
    expect(paths).not.toContain('workspaces/workspaces/linked/.git')
    expect(plan.readyToApply).toBe(false)
    expect(plan.blockers).toContainEqual(expect.objectContaining({ code: 'ELINKEDWORKTREE' }))
    expect(plan.excluded.find((entry) => entry.reason === 'machine-local')?.files)
      .toBeGreaterThanOrEqual(4)
  })

  it('blocks Git Workspaces that depend on non-portable object or promisor state', async () => {
    const home = await fixtureHome()
    const workspace = join(home, 'workspaces', 'workspaces', 'ws-one')
    const alternate = await mkdtemp(join(tmpdir(), 'oa-transfer-alternate-'))
    homes.push(alternate)
    await execFile('git', ['init', '-q'], { cwd: workspace })
    await execFile('git', ['init', '-q'], { cwd: alternate })
    await writeText(
      join(workspace, '.git', 'objects', 'info', 'alternates'),
      `${join(alternate, '.git', 'objects')}\n`,
    )
    await execFile('git', ['config', '--local', 'remote.origin.promisor', 'true'], { cwd: workspace })

    const plan = await planProjectTransfer({
      source: sourceProject(home),
      destinationMachineKey: 'cloud',
      destinationProjectKey: 'alice-cloud',
      destinationHome: '/srv/openalice/alice-cloud',
      scheduledIssues: 'keep-blocked',
      credentials: 'omit',
    })
    expect(plan.readyToApply).toBe(false)
    expect(plan.blockers).toContainEqual(expect.objectContaining({ code: 'EGITPORTABILITY' }))
    expect(plan.blockers.find((blocker) => blocker.code === 'EGITPORTABILITY')?.message)
      .toContain('alternate object database')
  })

  it('blocks an independent nested Git repository instead of silently emptying it', async () => {
    const home = await fixtureHome()
    const workspace = join(home, 'workspaces', 'workspaces', 'ws-one')
    await initCommittedRepository(workspace, 'research.txt')
    const nested = join(workspace, 'nested-repository')
    await mkdir(nested)
    await writeFile(join(nested, 'nested.txt'), 'nested user work\n')
    await initCommittedRepository(nested, 'nested.txt')

    const plan = await planProjectTransfer({
      source: sourceProject(home),
      destinationMachineKey: 'cloud',
      destinationProjectKey: 'alice-cloud',
      destinationHome: '/srv/openalice/alice-cloud',
      scheduledIssues: 'keep-blocked',
      credentials: 'omit',
    })

    expect(plan.readyToApply).toBe(false)
    expect(plan.blockers).toContainEqual(expect.objectContaining({ code: 'ENESTEDGIT' }))
    expect(plan.blockers.find((blocker) => blocker.code === 'ENESTEDGIT')?.message)
      .toContain('nested-repository')
  })

  it.each([
    ['clean', false],
    ['dirty', true],
  ])('blocks an initialized %s Git submodule instead of degrading it', async (_label, dirty) => {
    const home = await fixtureHome()
    const workspace = join(home, 'workspaces', 'workspaces', 'ws-one')
    await initCommittedRepository(workspace, 'research.txt')
    const submoduleSource = await mkdtemp(join(tmpdir(), 'oa-transfer-submodule-source-'))
    homes.push(submoduleSource)
    await writeFile(join(submoduleSource, 'module.txt'), 'submodule content\n')
    await initCommittedRepository(submoduleSource, 'module.txt')
    await execFile('git', [
      '-c', 'protocol.file.allow=always',
      'submodule', 'add', '-q', submoduleSource, 'vendor/module',
    ], { cwd: workspace })
    await execFile('git', ['add', '.gitmodules', 'vendor/module'], { cwd: workspace })
    await execFile('git', [
      '-c', 'user.name=OpenAlice Test',
      '-c', 'user.email=openalice@example.test',
      'commit', '-qm', 'add submodule',
    ], { cwd: workspace })
    if (dirty) await writeFile(join(workspace, 'vendor', 'module', 'module.txt'), 'dirty submodule work\n')

    const plan = await planProjectTransfer({
      source: sourceProject(home),
      destinationMachineKey: 'cloud',
      destinationProjectKey: 'alice-cloud',
      destinationHome: '/srv/openalice/alice-cloud',
      scheduledIssues: 'keep-blocked',
      credentials: 'omit',
    })

    expect(plan.readyToApply).toBe(false)
    expect(plan.blockers).toContainEqual(expect.objectContaining({ code: 'ENESTEDGIT' }))
    expect(plan.blockers.find((blocker) => blocker.code === 'ENESTEDGIT')?.message)
      .toContain('vendor/module')
  })

  it('uses one cached Git index per Workspace to skip ignored generated trees', async () => {
    const home = await fixtureHome()
    const workspace = join(home, 'workspaces', 'workspaces', 'ws-one')
    await execFile('git', ['init', '-q'], { cwd: workspace })
    await writeFile(join(workspace, '.gitignore'), [
      'node_modules/',
      '.venv/',
      'dist/',
      '',
    ].join('\n'))
    await writeFile(join(workspace, '.git', 'info', 'exclude'), '.pi-agent/\n')
    await writeFile(join(workspace, 'draft.txt'), 'untracked user work\n')
    await mkdir(join(workspace, 'node_modules', 'package'), { recursive: true })
    await mkdir(join(workspace, '.venv', 'bin'), { recursive: true })
    await mkdir(join(workspace, 'dist'), { recursive: true })
    await writeFile(join(workspace, 'node_modules', 'package', 'tracked.js'), 'tracked dependency\n')
    await writeFile(join(workspace, 'node_modules', 'package', 'ignored.js'), 'ignored dependency\n')
    await writeFile(join(workspace, '.venv', 'bin', 'python'), 'ignored virtualenv\n')
    await writeFile(join(workspace, 'dist', 'bundle.js'), 'ignored build output\n')
    await writeJson(join(workspace, '.pi-agent', 'auth.json'), { token: 'ignored-agent-secret-canary' })
    await writeText(join(workspace, '.codex', 'commands', 'tracked.md'), 'tracked native project command\n')
    await writeText(join(workspace, '.codex', 'local-state.json'), 'untracked native runtime state\n')
    await writeText(join(workspace, '.codex', 'state_5.sqlite'), 'untracked native session state\n')
    await execFile('git', [
      'add', '.gitignore', 'research.txt', '.alice/sessions/tracked.json', '.codex/commands/tracked.md',
    ], { cwd: workspace })
    await execFile('git', ['add', '-f', 'node_modules/package/tracked.js'], { cwd: workspace })

    const plainWorkspace = join(home, 'workspaces', 'workspaces', 'plain')
    await mkdir(join(plainWorkspace, 'node_modules'), { recursive: true })
    await writeFile(join(plainWorkspace, 'node_modules', 'kept.js'), 'non-Git content\n')

    const plan = await planProjectTransfer({
      source: sourceProject(home),
      destinationMachineKey: 'cloud',
      destinationProjectKey: 'alice-cloud',
      destinationHome: join(tmpdir(), 'oa-transfer-git-index'),
      scheduledIssues: 'keep-blocked',
      randomId: () => 'transfer-git-index',
    })
    const paths = plan.portable.entries.map((entry) => entry.path)
    expect(paths).toEqual(expect.arrayContaining([
      'workspaces/workspaces/ws-one/.git/HEAD',
      'workspaces/workspaces/ws-one/.git/index',
      'workspaces/workspaces/ws-one/.gitignore',
      'workspaces/workspaces/ws-one/research.txt',
      'workspaces/workspaces/ws-one/draft.txt',
      'workspaces/workspaces/ws-one/node_modules/package/tracked.js',
      'workspaces/workspaces/ws-one/.alice/sessions/tracked.json',
      'workspaces/workspaces/ws-one/.codex/commands/tracked.md',
      'workspaces/workspaces/plain/node_modules/kept.js',
    ]))
    expect(paths).not.toEqual(expect.arrayContaining([
      'workspaces/workspaces/ws-one/node_modules/package/ignored.js',
      'workspaces/workspaces/ws-one/.venv/bin/python',
      'workspaces/workspaces/ws-one/dist/bundle.js',
      'workspaces/workspaces/ws-one/.pi-agent/auth.json',
      'workspaces/workspaces/ws-one/.alice/sessions/untracked.json',
      'workspaces/workspaces/ws-one/.git/config',
      'workspaces/workspaces/ws-one/.codex/local-state.json',
      'workspaces/workspaces/ws-one/.codex/state_5.sqlite',
    ]))
    expect(plan.excluded.find((entry) => entry.reason === 'git-ignored')?.files)
      .toBeGreaterThanOrEqual(3)
    expect(JSON.stringify(plan)).not.toContain('ignored-agent-secret-canary')
  })
})

async function fixtureHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'oa-transfer-source-'))
  homes.push(home)
  await writeAliceProjectProductStamp(home, 'nano')
  await writeJson(join(home, 'data', 'config', 'ai-provider-manager.json'), {
    activeProfile: 'default',
    apiKeys: { google: 'legacy-ai-transfer-secret' },
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
  await writeJson(join(home, 'data', 'config', 'sessions.json'), { sessions: [{ sid: 'derived-secret-canary' }] })
  await writeJson(join(home, 'data', 'config', 'sessions.json.tmp'), { sid: 'derived-secret-canary' })
  await writeText(join(home, 'data', 'logs', 'connector-io.jsonl'), 'native-agent-secret-canary\n')
  await writeJson(join(home, 'data', 'config', 'ports.json.backup'), { secret: 'derived-secret-canary' })
  await writeJson(join(home, 'data', 'config', 'auth.json.previous'), { secret: 'derived-secret-canary' })
  await writeJson(join(home, 'data', 'config', 'accounts.json.backup-canary'), { secret: 'derived-secret-canary' })
  await writeJson(join(home, 'data', 'config', 'connectors.json.tmp-canary'), { secret: 'derived-secret-canary' })
  await writeJson(join(home, 'data', 'config', 'ai-provider-manager.json.backup-canary'), { secret: 'derived-secret-canary' })
  await writeJson(join(home, 'data', 'config', '.ai-provider-manager.123.tmp'), { secret: 'derived-secret-canary' })
  await writeJson(join(home, 'data', 'config', 'market-data.json.previous'), { secret: 'derived-secret-canary' })
  await writeJson(join(home, 'data', '_backup', 'pre-migration', 'config', 'ai-provider-manager.json'), { secret: 'derived-secret-canary' })
  await writeJson(join(home, 'demo-text-backups', 'provider-canary.json'), { secret: 'derived-secret-canary' })
  await writeJson(join(home, '.openalice-transfer-receipt.json'), { secret: 'derived-secret-canary' })
  await writeJson(join(home, '.cli-update-check.json'), { secret: 'derived-secret-canary' })
  await mkdir(join(home, '.cli-install.lock'), { recursive: true })
  await writeFile(join(home, '.cli-install.lock', 'pid'), '99999999\n')
  await writeFile(join(home, '.cli-install.lock.guard'), '')
  await writeJson(join(home, 'provider-keys.json.backup'), { secret: 'derived-secret-canary' })
  await writeFile(join(home, 'sealing.key.previous'), 'derived-secret-canary\n')
  await writeJson(join(home, 'workspaces', 'workspaces.json.before-transfer'), { path: '/source-only' })
  await writeJson(join(home, 'workspaces', 'state', 'workspace-catalog.json.backup'), { path: '/source-only' })
  await writeJson(join(home, 'workspaces', 'state', 'runtime.lock', 'owner.json'), {
    token: 'native-agent-secret-canary',
  })

  const workspace = join(home, 'workspaces', 'workspaces', 'ws-one')
  await mkdir(join(workspace, '.alice', 'sessions'), { recursive: true })
  await mkdir(join(workspace, '.alice', 'issues'), { recursive: true })
  await writeFile(join(workspace, 'research.txt'), 'portable research\n')
  await writeText(join(workspace, '.claude', 'skills', 'portable', 'SKILL.md'), '# Portable skill\n')
  await writeJson(join(workspace, '.claude', 'settings.local.json'), { env: { API_KEY: 'native-agent-secret-canary' } })
  await writeJson(join(workspace, '.claude', 'openalice-provider.json'), { key: 'native-agent-secret-canary' })
  await writeJson(join(workspace, '.codex', 'env.json'), { OPENALICE_WORKSPACE_KEY: 'native-agent-secret-canary' })
  await writeJson(join(workspace, '.codex', 'openalice-home', 'auth.json'), { token: 'native-agent-secret-canary' })
  await writeJson(join(workspace, '.codex', 'sessions', 'rollout.jsonl'), { token: 'native-agent-secret-canary' })
  await writeJson(join(workspace, 'opencode.json'), { key: 'native-agent-secret-canary' })
  await writeJson(join(workspace, '.opencode', 'openalice-provider.json'), { key: 'native-agent-secret-canary' })
  await writeJson(join(workspace, '.pi', 'settings.json'), { provider: 'native-agent-secret-canary' })
  await writeJson(join(workspace, '.pi', 'openalice-provider.json'), { key: 'native-agent-secret-canary' })
  await writeText(join(workspace, '.pi', 'extensions', 'openalice-provider.ts'), 'native-agent-secret-canary\n')
  await writeJson(join(workspace, '.pi-agent', 'auth.json'), { token: 'native-agent-secret-canary' })
  await writeJson(join(workspace, '.alice', 'sessions', 'tracked.json'), { resumeId: 'tracked' })
  await writeJson(join(workspace, '.alice', 'sessions', 'untracked.json'), { resumeId: 'untracked' })
  await writeFile(join(workspace, '.alice', 'issues', 'scheduled-owner.md'), [
    '---',
    'title: Scheduled owner',
    'assignee: "@resume-old-owner" # exact owner',
    'when:',
    '  kind: every',
    '  every: 1h',
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
  await writeJson(join(home, 'workspaces', 'workspaces', 'runtime-selection.json'), {
    selectedRuntime: 'opencode',
  })
  await writeJson(join(home, 'workspaces', 'workspaces', 'opencode.json'), {
    provider: { key: 'native-agent-secret-canary' },
  })
  await writeJson(join(home, 'workspaces', 'state', 'workspace-catalog.json'), {
    version: 1,
    workspaces: [
      { id: 'ws-one', tag: 'one', activeDir: workspace, lifecycle: 'active' },
      {
        id: '.pi-agent',
        tag: 'pi-agent',
        activeDir: join(home, 'workspaces', 'departed-workspaces', '.pi-agent'),
        departedDir: join(home, 'workspaces', 'departed-workspaces', '.pi-agent'),
        lifecycle: 'departed',
        legacyImported: true,
      },
    ],
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

async function initCommittedRepository(repository: string, file: string): Promise<void> {
  await execFile('git', ['init', '-q'], { cwd: repository })
  await execFile('git', ['add', file], { cwd: repository })
  await execFile('git', [
    '-c', 'user.name=OpenAlice Test',
    '-c', 'user.email=openalice@example.test',
    'commit', '-qm', 'fixture',
  ], { cwd: repository })
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, value)
}
