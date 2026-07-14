import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { HeadlessTaskRegistry } from './headless-task-registry.js'
import type { Logger } from './logger.js'
import { ResumeRegistry } from './resume-registry.js'
import { ScrollbackStore } from './scrollback-store.js'
import type { SessionPool } from './session-pool.js'
import { SessionRegistry } from './session-registry.js'
import { WorkspaceCatalog } from './workspace-catalog.js'
import { WorkspaceLifecycleManager } from './workspace-lifecycle.js'
import { WorkspaceOperationGuard } from './workspace-operation-guard.js'
import { WorkspaceRegistry, type WorkspaceMeta } from './workspace-registry.js'

const noopLogger = {
  debug() {}, info() {}, warn() {}, error() {}, event() {}, child() { return this },
} as unknown as Logger

let root: string
let workspace: WorkspaceMeta
let registry: WorkspaceRegistry
let catalog: WorkspaceCatalog
let resumes: ResumeRegistry
let sessions: SessionRegistry
let tasks: HeadlessTaskRegistry
let lifecycle: WorkspaceLifecycleManager
let operationGuard: WorkspaceOperationGuard

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'workspace-lifecycle-'))
  const activeDir = join(root, 'workspaces', 'chat-calm-test')
  await mkdir(join(activeDir, '.alice', 'issues'), { recursive: true })
  await writeFile(join(activeDir, '.alice', 'issues', 'handoff-me.md'), [
    '---',
    'title: Handoff me',
    'status: todo',
    'assignee: "@workspace"',
    'when: { kind: every, every: "1h" }',
    '---',
    '',
    'Finish the work.',
  ].join('\n'))
  workspace = {
    id: 'chat-calm-test',
    tag: 'calm-test',
    dir: activeDir,
    createdAt: '2026-01-01T00:00:00.000Z',
    template: 'chat',
    agents: ['pi', 'shell'],
  }
  registry = await WorkspaceRegistry.load(join(root, 'workspaces.json'), noopLogger)
  await registry.add(workspace)
  catalog = await WorkspaceCatalog.load(join(root, 'state', 'workspace-catalog.json'), [workspace], noopLogger)
  resumes = await ResumeRegistry.load(join(root, 'state', 'resume-identities.json'), noopLogger)
  await resumes.ensure({
    resumeId: 'resume-calm-owner',
    wsId: workspace.id,
    agent: 'pi',
    agentSessionId: 'native-session',
    now: 1,
  })
  sessions = await SessionRegistry.load(join(root, 'state'), noopLogger)
  await sessions.create({
    id: 'pi-calm-seat',
    resumeId: 'resume-calm-owner',
    wsId: workspace.id,
    agent: 'pi',
    name: 'p1',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActiveAt: '2026-01-01T00:00:00.000Z',
    state: 'running',
  })
  tasks = await HeadlessTaskRegistry.load(join(root, 'state', 'headless-tasks.json'), noopLogger)
  const pool = {
    get: () => undefined,
    disposeToken: () => false,
  } as unknown as SessionPool
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
})

afterEach(async () => rm(root, { recursive: true, force: true }))

describe('WorkspaceLifecycleManager', () => {
  it('offboards with handoff, retires Sessions, and restores the exact desk', async () => {
    const result = await lifecycle.offboard({ id: workspace.id, reason: 'Team changed', notes: 'Review open work.' })
    expect(result.ok).toBe(true)
    expect(registry.get(workspace.id)).toBeUndefined()
    expect(existsSync(workspace.dir)).toBe(false)
    const departedDir = join(root, 'departed-workspaces', workspace.id)
    expect(existsSync(departedDir)).toBe(true)
    expect(catalog.get(workspace.id)?.lifecycle).toBe('departed')
    expect(resumes.get('resume-calm-owner')).toMatchObject({ lifecycle: 'retired', retirementReason: 'Team changed' })
    expect(sessions.get(workspace.id, 'pi-calm-seat')?.state).toBe('paused')
    expect(await readFile(join(departedDir, '.alice', 'HANDOFF.md'), 'utf8')).toContain('Review open work.')
    expect(await readFile(join(departedDir, '.alice', 'offboarding.json'), 'utf8')).toContain('handoff-me')

    const restored = await lifecycle.restore(workspace.id)
    expect(restored.ok).toBe(true)
    expect(registry.get(workspace.id)?.dir).toBe(workspace.dir)
    expect(existsSync(workspace.dir)).toBe(true)
    expect(catalog.get(workspace.id)?.lifecycle).toBe('active')
    expect(resumes.get('resume-calm-owner')?.lifecycle).toBe('active')
    expect(sessions.get(workspace.id, 'pi-calm-seat')).toBeTruthy()
  })

  it('blocks departure while a headless coworker is still working', async () => {
    await tasks.create({
      wsId: workspace.id,
      agent: 'pi',
      prompt: 'keep working',
      startedAt: 1,
      resumeId: 'resume-calm-owner',
    })
    const result = await lifecycle.offboard({ id: workspace.id })
    expect(result).toMatchObject({ ok: false, code: 'blocked' })
    expect(registry.get(workspace.id)).toBeTruthy()
    expect(existsSync(workspace.dir)).toBe(true)
  })

  it('does not offboard a checkout while another directory operation owns it', async () => {
    const upgrade = operationGuard.acquire(workspace.id, 'template-upgrade')
    expect(upgrade).toBeTruthy()
    const blocked = await lifecycle.offboard({ id: workspace.id })
    expect(blocked).toMatchObject({
      ok: false,
      code: 'blocked',
      message: 'workspace is busy with template-upgrade',
    })
    expect(existsSync(workspace.dir)).toBe(true)
    upgrade?.release()
    expect((await lifecycle.offboard({ id: workspace.id })).ok).toBe(true)
  })

  it('purges only the departed checkout while retaining the Catalog tombstone', async () => {
    expect((await lifecycle.offboard({ id: workspace.id })).ok).toBe(true)
    expect((await lifecycle.purge(workspace.id)).ok).toBe(true)
    expect(catalog.get(workspace.id)?.lifecycle).toBe('purged')
    expect(existsSync(join(root, 'departed-workspaces', workspace.id))).toBe(false)
    expect(sessions.listFor(workspace.id)).toEqual([])
    expect(resumes.get('resume-calm-owner')?.lifecycle).toBe('retired')
  })

  it('finishes an interrupted offboarding transition and preserves successor handoff', async () => {
    await resumes.ensure({
      resumeId: 'resume-successor',
      wsId: 'another-workspace',
      agent: 'pi',
      agentSessionId: 'successor-native',
      now: 2,
    })
    const assessment = await lifecycle.assess(workspace.id)
    expect(assessment).toBeTruthy()
    const departedDir = join(root, 'departed-workspaces', workspace.id)
    await catalog.beginOffboarding({
      meta: workspace,
      departedDir,
      reason: 'Desk retired',
      handoff: {
        preparedAt: '2026-01-02T00:00:00.000Z',
        reason: 'Desk retired',
        dirtyFiles: [],
        openIssueIds: assessment?.openIssueIds ?? [],
        scheduledIssueIds: assessment?.scheduledIssueIds ?? [],
        resumeIds: ['resume-calm-owner'],
        successors: { 'resume-calm-owner': 'resume-successor' },
        sessionRecords: 1,
      },
    })

    // Simulate a crash immediately after the transition record was flushed.
    await lifecycle.recover()

    expect(registry.get(workspace.id)).toBeUndefined()
    expect(existsSync(workspace.dir)).toBe(false)
    expect(existsSync(departedDir)).toBe(true)
    expect(catalog.get(workspace.id)?.lifecycle).toBe('departed')
    expect(resumes.get('resume-calm-owner')).toMatchObject({
      lifecycle: 'retired',
      successorResumeId: 'resume-successor',
    })
  })

  it('finishes an interrupted restore after the directory move', async () => {
    expect((await lifecycle.offboard({ id: workspace.id })).ok).toBe(true)
    const departedDir = join(root, 'departed-workspaces', workspace.id)
    await catalog.beginRestoring(workspace.id)
    await rename(departedDir, workspace.dir)

    // Simulate a crash after the checkout returned but before registry/catalog
    // and resume identities were reactivated.
    await lifecycle.recover()

    expect(registry.get(workspace.id)?.dir).toBe(workspace.dir)
    expect(catalog.get(workspace.id)?.lifecycle).toBe('active')
    expect(resumes.get('resume-calm-owner')?.lifecycle).toBe('active')
    expect(existsSync(workspace.dir)).toBe(true)
  })
})
