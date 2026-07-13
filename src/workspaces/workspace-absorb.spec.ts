import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { exec as gitExec } from 'dugite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { HeadlessTaskRegistry } from './headless-task-registry.js'
import type { Logger } from './logger.js'
import { ResumeRegistry } from './resume-registry.js'
import { ScrollbackStore } from './scrollback-store.js'
import type { SessionPool } from './session-pool.js'
import { SessionRegistry } from './session-registry.js'
import { WorkspaceAbsorbError, WorkspaceAbsorbManager } from './workspace-absorb.js'
import { WorkspaceCatalog } from './workspace-catalog.js'
import { WorkspaceLifecycleManager } from './workspace-lifecycle.js'
import { WorkspaceOperationGuard } from './workspace-operation-guard.js'
import { WorkspaceRegistry, type WorkspaceMeta } from './workspace-registry.js'
import type { WorkspaceRuntimeActivity } from './workspace-runtime-activity.js'

const noopLogger = {
  debug() {}, info() {}, warn() {}, error() {}, event() {}, child() { return this },
} as unknown as Logger

const idle: WorkspaceRuntimeActivity = { busy: false, sessions: [], headless: [] }

let root: string
let source: WorkspaceMeta
let target: WorkspaceMeta
let registry: WorkspaceRegistry
let catalog: WorkspaceCatalog
let resumes: ResumeRegistry
let lifecycle: WorkspaceLifecycleManager
let operationGuard: WorkspaceOperationGuard
let activity: Record<string, WorkspaceRuntimeActivity>

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'workspace-absorb-'))
  source = workspace('source-workspace', 'source-desk')
  target = workspace('target-workspace', 'target-desk')
  await createSource(source.dir)
  await createTarget(target.dir)

  registry = await WorkspaceRegistry.load(join(root, 'workspaces.json'), noopLogger)
  await registry.add(source)
  await registry.add(target)
  catalog = await WorkspaceCatalog.load(
    join(root, 'state', 'workspace-catalog.json'),
    [source, target],
    noopLogger,
  )
  resumes = await ResumeRegistry.load(join(root, 'state', 'resume-identities.json'), noopLogger)
  await resumes.ensure({
    resumeId: 'resume-source-owner',
    wsId: source.id,
    agent: 'pi',
    agentSessionId: 'native-source-session',
    now: 1,
  })
  const sessions = await SessionRegistry.load(join(root, 'state'), noopLogger)
  await sessions.create({
    id: 'pi-source-seat',
    resumeId: 'resume-source-owner',
    wsId: source.id,
    agent: 'pi',
    name: 'p1',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActiveAt: '2026-01-01T00:00:00.000Z',
    state: 'paused',
  })
  const tasks = await HeadlessTaskRegistry.load(join(root, 'state', 'headless-tasks.json'), noopLogger)
  const pool = { get: () => undefined, disposeToken: () => false } as unknown as SessionPool
  operationGuard = new WorkspaceOperationGuard()
  lifecycle = new WorkspaceLifecycleManager({
    launcherRoot: root,
    registry,
    catalog,
    resumeRegistry: resumes,
    sessionRegistry: sessions,
    scrollbackStore: new ScrollbackStore(join(root, 'state'), noopLogger),
    headlessTasks: tasks,
    pool,
    operationGuard,
    logger: noopLogger,
  })
  activity = { [source.id]: idle, [target.id]: idle }
})

afterEach(async () => rm(root, { recursive: true, force: true }))

describe('WorkspaceAbsorbManager', () => {
  it('classifies user files while excluding runtime and template-owned roots', async () => {
    const plan = await manager().plan(target.id, source.id)

    expect(plan).toMatchObject({
      source: { id: source.id, tag: source.tag },
      target: { id: target.id, tag: target.tag },
      blocked: false,
      summary: { ready: 2, duplicates: 1, conflicts: 1 },
      sourceInventory: { sessions: 1, resumeIds: 1 },
    })
    expect(plan.files.map((file) => file.path)).toEqual([
      'research/conflict.md',
      'research/new.md',
      'research/same.md',
      'research/untracked.md',
    ])
    expect(plan.files.find((file) => file.path === 'research/conflict.md'))
      .toMatchObject({ status: 'conflict', canUseSource: true })
    expect(plan.files.some((file) => file.path.startsWith('.alice/'))).toBe(false)
    expect(plan.files.some((file) => file.path === 'AGENTS.md')).toBe(false)
  })

  it('copies reviewed files, archives source identity, and records one audit commit', async () => {
    await writeFile(join(target.dir, 'local-notes.md'), 'target local edit\n')
    const absorb = manager()
    const plan = await absorb.plan(target.id, source.id)
    const result = await absorb.apply({
      targetWorkspaceId: target.id,
      sourceWorkspaceId: source.id,
      planDigest: plan.planDigest,
      resolutions: { 'research/conflict.md': 'both' },
    })

    expect(await readFile(join(target.dir, 'research', 'new.md'), 'utf8')).toBe('new source research\n')
    expect(await readFile(join(target.dir, 'research', 'conflict.md'), 'utf8')).toBe('target copy\n')
    expect(await readFile(join(target.dir, plan.importRoot, 'research', 'conflict.md'), 'utf8')).toBe('source copy\n')
    expect(await readFile(join(target.dir, 'research', 'untracked.md'), 'utf8')).toBe('untracked but useful\n')
    expect(await readFile(join(target.dir, 'local-notes.md'), 'utf8')).toBe('target local edit\n')
    expect(await git(target.dir, ['show', '--pretty=', '--name-only', 'HEAD'])).not.toContain('local-notes.md')
    expect(await git(target.dir, ['log', '-1', '--pretty=%B'])).toContain(`OpenAlice-Absorb-Source: ${source.id}`)
    expect(result.changedPaths).toContain('research/new.md')

    const sourceRecord = catalog.get(source.id)
    expect(sourceRecord).toMatchObject({
      lifecycle: 'departed',
      absorbedIntoWorkspaceId: target.id,
      absorbCommit: result.commit,
    })
    expect(registry.get(source.id)).toBeUndefined()
    expect(existsSync(source.dir)).toBe(false)
    expect(existsSync(result.departedDir)).toBe(true)
    expect(resumes.get('resume-source-owner')?.lifecycle).toBe('retired')

    expect((await lifecycle.restore(source.id)).ok).toBe(true)
    expect(catalog.get(source.id)).toMatchObject({ lifecycle: 'active' })
    expect(catalog.get(source.id)?.absorbedIntoWorkspaceId).toBeUndefined()
    expect(resumes.get('resume-source-owner')?.lifecycle).toBe('active')
  })

  it('rejects real runtime activity, staged target state, and stale previews', async () => {
    activity[source.id] = {
      busy: true,
      sessions: [{
        sessionId: 'pi-source-seat', resumeId: 'resume-source-owner', name: 'p1', agent: 'pi',
        surface: 'webpi', startedAt: 1,
      }],
      headless: [],
    }
    const busyPlan = await manager().plan(target.id, source.id)
    expect(busyPlan.blockers).toEqual(['source_active_sessions'])
    await expect(manager().apply({
      targetWorkspaceId: target.id,
      sourceWorkspaceId: source.id,
      planDigest: busyPlan.planDigest,
    })).rejects.toMatchObject({ code: 'busy' } satisfies Partial<WorkspaceAbsorbError>)

    activity[source.id] = idle
    await writeFile(join(target.dir, 'staged.md'), 'staged\n')
    await git(target.dir, ['add', 'staged.md'])
    const stagedPlan = await manager().plan(target.id, source.id)
    expect(stagedPlan.blockers).toContain('target_staged_changes')
    await git(target.dir, ['reset', '-q', '--', 'staged.md'])

    const plan = await manager().plan(target.id, source.id)
    await writeFile(join(source.dir, 'research', 'new.md'), 'changed after preview\n')
    await expect(manager().apply({
      targetWorkspaceId: target.id,
      sourceWorkspaceId: source.id,
      planDigest: plan.planDigest,
      resolutions: { 'research/conflict.md': 'both' },
    })).rejects.toMatchObject({ code: 'stale_plan' } satisfies Partial<WorkspaceAbsorbError>)
  })

  it('never follows a target symlink when offering source replacement', async ({ skip }) => {
    const external = join(root, 'external')
    await mkdir(external, { recursive: true })
    await mkdir(join(source.dir, 'danger'), { recursive: true })
    await writeFile(join(source.dir, 'danger', 'report.md'), 'source report\n')
    await git(source.dir, ['add', 'danger/report.md'])
    await git(source.dir, ['-c', 'user.email=test@local', '-c', 'user.name=test', 'commit', '-q', '-m', 'danger fixture'])
    try {
      await symlink(external, join(target.dir, 'danger'), 'dir')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') skip('symlinks unavailable on this runner')
      throw error
    }

    const plan = await manager().plan(target.id, source.id)
    expect(plan.files.find((file) => file.path === 'danger/report.md'))
      .toMatchObject({ status: 'conflict', canUseSource: false })
  })

  it('restores both desks when the isolated target commit fails', async () => {
    const hook = join(target.dir, '.git', 'hooks', 'pre-commit')
    await writeFile(hook, '#!/bin/sh\nexit 1\n')
    await chmod(hook, 0o755)
    const absorb = manager()
    const plan = await absorb.plan(target.id, source.id)
    const head = (await git(target.dir, ['rev-parse', 'HEAD'])).trim()

    await expect(absorb.apply({
      targetWorkspaceId: target.id,
      sourceWorkspaceId: source.id,
      planDigest: plan.planDigest,
      resolutions: { 'research/conflict.md': 'source' },
    })).rejects.toThrow(/exited 1/)

    expect(registry.get(source.id)?.dir).toBe(source.dir)
    expect(catalog.get(source.id)?.lifecycle).toBe('active')
    expect(resumes.get('resume-source-owner')?.lifecycle).toBe('active')
    expect(await readFile(join(target.dir, 'research', 'conflict.md'), 'utf8')).toBe('target copy\n')
    expect(existsSync(join(target.dir, 'research', 'new.md'))).toBe(false)
    expect((await git(target.dir, ['rev-parse', 'HEAD'])).trim()).toBe(head)
    expect(existsSync(join(target.dir, '.alice', 'workspace-absorb', 'transaction'))).toBe(false)
  })

  it('finishes a committed absorb journal after restart', async () => {
    const absorb = manager()
    const plan = await absorb.plan(target.id, source.id)
    const targetHead = (await git(target.dir, ['rev-parse', 'HEAD'])).trim()
    expect((await lifecycle.offboard({ id: source.id, reason: `Absorbed into ${target.tag}` })).ok).toBe(true)
    const journalDir = join(target.dir, '.alice', 'workspace-absorb', 'transaction')
    await mkdir(journalDir, { recursive: true })
    await writeFile(join(journalDir, 'journal.json'), JSON.stringify({
      version: 1,
      sourceWorkspaceId: source.id,
      targetWorkspaceId: target.id,
      targetHead,
      planDigest: plan.planDigest,
      touchedPaths: [],
      preparedAt: '2026-01-02T00:00:00.000Z',
    }))
    await git(target.dir, [
      '-c', 'user.email=test@local', '-c', 'user.name=test',
      'commit', '--allow-empty', '-q', '-m', [
        `workspace: absorb ${source.tag} into ${target.tag}`,
        '',
        `OpenAlice-Absorb-Source: ${source.id}`,
        `OpenAlice-Absorb-Plan: ${plan.planDigest}`,
      ].join('\n'),
    ])
    const absorbCommit = (await git(target.dir, ['rev-parse', 'HEAD'])).trim()

    await absorb.recover()

    expect(catalog.get(source.id)).toMatchObject({
      lifecycle: 'departed',
      absorbedIntoWorkspaceId: target.id,
      absorbCommit,
    })
    expect(existsSync(journalDir)).toBe(false)
  })
})

function workspace(id: string, tag: string): WorkspaceMeta {
  return {
    id,
    tag,
    dir: join(root, 'workspaces', id),
    createdAt: '2026-01-01T00:00:00.000Z',
    template: 'chat',
    agents: ['pi'],
  }
}

async function createSource(dir: string): Promise<void> {
  await mkdir(join(dir, 'research'), { recursive: true })
  await mkdir(join(dir, '.alice', 'issues'), { recursive: true })
  await writeFile(join(dir, 'AGENTS.md'), 'source template context\n')
  await writeFile(join(dir, '.env'), 'SECRET=stays-with-source\n')
  await writeFile(join(dir, 'research', 'new.md'), 'new source research\n')
  await writeFile(join(dir, 'research', 'same.md'), 'same copy\n')
  await writeFile(join(dir, 'research', 'conflict.md'), 'source copy\n')
  await writeFile(join(dir, '.alice', 'issues', 'scheduled.md'), [
    '---', 'title: Scheduled', 'status: todo', 'assignee: "@workspace"',
    'when: { kind: every, every: "1h" }', '---', '', 'Run later.',
  ].join('\n'))
  await git(dir, ['init', '-q'])
  await git(dir, ['add', '.'])
  await git(dir, ['-c', 'user.email=test@local', '-c', 'user.name=test', 'commit', '-q', '-m', 'source root'])
  await writeFile(join(dir, 'research', 'untracked.md'), 'untracked but useful\n')
}

async function createTarget(dir: string): Promise<void> {
  await mkdir(join(dir, 'research'), { recursive: true })
  await writeFile(join(dir, 'research', 'same.md'), 'same copy\n')
  await writeFile(join(dir, 'research', 'conflict.md'), 'target copy\n')
  await git(dir, ['init', '-q'])
  await git(dir, ['add', '.'])
  await git(dir, ['-c', 'user.email=test@local', '-c', 'user.name=test', 'commit', '-q', '-m', 'target root'])
}

function manager(): WorkspaceAbsorbManager {
  return new WorkspaceAbsorbManager({
    registry,
    catalog,
    lifecycle,
    operationGuard,
    workspaceRuntimeActivity: (workspaceId) => activity[workspaceId] ?? idle,
    logger: noopLogger,
  })
}

async function git(dir: string, args: readonly string[]): Promise<string> {
  const result = await gitExec([...args], dir)
  if (result.exitCode !== 0) throw new Error(String(result.stderr))
  return String(result.stdout)
}
