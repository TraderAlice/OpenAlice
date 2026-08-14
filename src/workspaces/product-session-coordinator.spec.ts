import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Logger } from './logger.js'
import { ProductSessionCoordinator } from './product-session-coordinator.js'
import { ResumeRegistry } from './resume-registry.js'
import { SessionRegistry } from './session-registry.js'
import { WorkspaceSessionRuntimeStore } from './session-runtime-store.js'

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  event() {},
  child() {
    return noopLogger
  },
} as unknown as Logger

const WS = 'chat-calm-amber-river'
const RESUME = 'resume-calm-amber-river-a1b2c3'

let root: string
let resumes: ResumeRegistry
let sessions: SessionRegistry
let coordinator: ProductSessionCoordinator

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'product-session-'))
  const runtimeStore = new WorkspaceSessionRuntimeStore((wsId) => [
    join(root, 'workspaces', wsId, '.alice', 'sessions'),
  ])
  resumes = await ResumeRegistry.load(
    join(root, 'resume-identities.json'),
    noopLogger,
    runtimeStore,
  )
  sessions = await SessionRegistry.load(root, noopLogger)
  coordinator = new ProductSessionCoordinator(resumes, sessions, noopLogger)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('ProductSessionCoordinator', () => {
  it('gives a headless-born resume identity exactly one durable roster row', async () => {
    const first = await coordinator.ensure({
      resumeId: RESUME,
      wsId: WS,
      agent: 'codex',
      namePrefix: 'x',
      latestTaskId: 'task-1',
      state: 'running',
      surface: 'headless',
      fallbackTitle: 'Run the market close scan',
      sourceRunId: 'task-1',
      now: 1_723_337_000_000,
    })
    const second = await coordinator.ensure({
      resumeId: RESUME,
      wsId: WS,
      agent: 'codex',
      namePrefix: 'x',
      state: 'running',
      surface: 'headless',
      now: 1_723_337_001_000,
    })

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.session.id).toBe(first.session.id)
    expect(second.session.name).toBe('x1')
    expect(sessions.listFor(WS)).toHaveLength(1)
    expect(resumes.get(RESUME)).toMatchObject({
      resumeId: RESUME,
      wsId: WS,
      agent: 'codex',
      latestTaskId: 'task-1',
    })
    expect(first.session).toMatchObject({
      resumeId: RESUME,
      state: 'running',
      surface: 'headless',
      fallbackTitle: 'Run the market close scan',
      sourceRunId: 'task-1',
    })
  })

  it('moves the same record between headless and interactive execution states', async () => {
    const born = await coordinator.ensure({
      resumeId: RESUME,
      wsId: WS,
      agent: 'claude',
      namePrefix: 'c',
      state: 'running',
      surface: 'headless',
      now: 1_723_337_000_000,
    })

    await coordinator.transition({
      wsId: WS,
      resumeId: RESUME,
      state: 'paused',
      surface: 'headless',
      now: 1_723_337_010_000,
    })
    const interactive = await coordinator.ensure({
      resumeId: RESUME,
      wsId: WS,
      agent: 'claude',
      namePrefix: 'c',
      state: 'running',
      surface: 'terminal',
      now: 1_723_337_020_000,
    })

    expect(interactive.session.id).toBe(born.session.id)
    expect(interactive.session).toMatchObject({
      state: 'running',
      surface: 'terminal',
      lastActiveAt: new Date(1_723_337_020_000).toISOString(),
    })
    expect(sessions.listFor(WS)).toHaveLength(1)
  })

  it('repairs an interrupted identity birth without changing resume identity or birth time', async () => {
    await resumes.ensure({
      resumeId: RESUME,
      wsId: WS,
      agent: 'pi',
      latestTaskId: 'task-latest',
      now: 1_723_337_000_000,
    })

    const repaired = await coordinator.reconcile({
      namePrefixForAgent: () => 'p',
      fallbackForResume: () => ({
        title: 'Recovered headless prompt',
        sourceRunId: 'task-latest',
      }),
    })

    expect(repaired).toBe(1)
    expect(sessions.findByResumeId(WS, RESUME)).toMatchObject({
      resumeId: RESUME,
      name: 'p1',
      createdAt: new Date(1_723_337_000_000).toISOString(),
      state: 'paused',
      surface: 'headless',
      fallbackTitle: 'Recovered headless prompt',
      sourceRunId: 'task-latest',
    })
    expect(await coordinator.reconcile({ namePrefixForAgent: () => 'p' })).toBe(0)
  })

  it('retains deleted and retired identities unless their Workspace was purged', async () => {
    await resumes.ensure({
      resumeId: RESUME,
      wsId: WS,
      agent: 'pi',
      now: 1_723_337_000_000,
    })
    await resumes.setPresence({ resumeId: RESUME, wsId: WS, presence: 'archived' })
    await resumes.setPresence({ resumeId: RESUME, wsId: WS, presence: 'deleted' })
    await resumes.retireWorkspace(WS, { reason: 'Desk departed' })

    expect(await coordinator.reconcile({ namePrefixForAgent: () => 'p' })).toBe(1)
    expect(sessions.findByResumeId(WS, RESUME)).toBeTruthy()

    const purgedResume = 'resume-purged-workspace-a1b2c3'
    await resumes.ensure({
      resumeId: purgedResume,
      wsId: 'chat-purged-workspace',
      agent: 'codex',
      now: 1_723_337_100_000,
    })
    expect(await coordinator.reconcile({
      namePrefixForAgent: () => 'x',
      shouldRetain: (identity) => identity.wsId !== 'chat-purged-workspace',
    })).toBe(0)
    expect(sessions.findByResumeId('chat-purged-workspace', purgedResume)).toBeUndefined()
  })

  it('fails startup reconciliation when a roster row has no matching identity', async () => {
    await sessions.create({
      id: 'codex-orphan-row',
      resumeId: RESUME,
      wsId: WS,
      agent: 'codex',
      name: 'x1',
      createdAt: '2026-08-01T00:00:00.000Z',
      lastActiveAt: '2026-08-01T00:00:00.000Z',
      state: 'paused',
      surface: 'headless',
    })

    await expect(coordinator.reconcile({
      namePrefixForAgent: () => 'x',
    })).rejects.toThrow('has no ResumeIdentityRecord')
  })
})
