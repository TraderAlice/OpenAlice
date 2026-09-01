import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import { OfficeDayStore } from '../../core/office-day-store.js'
import {
  RoutineFollowUpConflictError,
  RoutineFollowUpCreateDisallowedError,
  RoutineFollowUpStore,
} from '../../core/routine-follow-up-store.js'
import { createOfficeRoutes } from './office.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function directory(
  id: string,
  tag: string,
  sessions: {
    resumeId: string
    agent: string
    lifecycle?: string
    presence?: string
    updatedAt?: number
    latestExecution?: {
      taskId: string
      status: 'done' | 'running' | 'failed' | 'interrupted'
      startedAt: number
      finishedAt?: number
      assistantPreview?: string
    }
  }[],
) {
  return {
    workspace: { id, tag },
    sessions: sessions.map((session) => ({
      createdAt: session.updatedAt ?? Date.now(),
      updatedAt: session.updatedAt ?? Date.now(),
      lifecycle: session.lifecycle ?? 'active',
      resumable: true,
      active: false,
      ...session,
    })),
  }
}

describe('GET /api/office/floor', () => {
  it('returns every office when workspaceId is omitted', async () => {
    const app = new Hono().route('/', createOfficeRoutes({
      registry: {
        list: () => [
          { id: 'quant-1', tag: 'auto-quant', template: 'auto-quant-v2' },
          { id: 'chat-1', tag: 'chat', template: 'chat' },
        ],
        get: (id: string) => id === 'chat-1'
          ? { id, tag: 'chat', template: 'chat' }
          : id === 'quant-1' ? { id, tag: 'auto-quant', template: 'auto-quant-v2' } : undefined,
      },
      sessionDirectory: vi.fn(async (id: string) => id === 'chat-1'
        ? directory('chat-1', 'chat', [{ resumeId: 'resume-alice', agent: 'codex', lifecycle: 'active' }])
        : directory('quant-1', 'auto-quant', [])),
      sessionRegistry: { findByResumeId: vi.fn(() => ({ id: 'codex-1', name: 'c1', resumeId: 'resume-alice', title: 'Desk mate' })) },
      headlessTasks: { get: vi.fn(() => null) },
      agentRuntimeLog: {
        lastSeq: () => 0,
        firstSeq: () => 0,
        projectionEvents: () => [],
        read: vi.fn(async () => []),
      },
      provenanceStore: { list: vi.fn(() => []) },
    } as never))
    const res = await app.request('/floor')
    expect(res.status).toBe(200)
    const body = await res.json() as {
      config: {
        harnessMinimumVisibleGroups: Record<string, number>
      }
      offices: {
        workspace: { id: string; harness: string }
        sleeping: boolean
        employees: unknown[]
      }[]
    }
    expect(body.offices.map((office) => office.workspace.id)).toEqual(['chat-1', 'quant-1'])
    expect(body.offices[0]?.employees).toHaveLength(1)
    expect(body.offices[0]?.sleeping).toBe(false)
    expect(body.offices[1]?.sleeping).toBe(true)
    expect(body.offices.map((office) => office.workspace.harness)).toEqual(['chat', 'auto-quant'])
    expect(body.config.harnessMinimumVisibleGroups).toEqual({
      chat: 1,
      'auto-quant': 1,
      prediction: 1,
      other: 0,
    })
  })

  it('returns 404 for an unknown office filter', async () => {
    const app = new Hono().route('/', createOfficeRoutes({
      registry: { list: () => [], get: vi.fn() },
      sessionDirectory: vi.fn(async () => null),
      provenanceStore: { list: vi.fn(() => []) },
      agentRuntimeLog: {
        lastSeq: () => 0,
        firstSeq: () => 0,
        projectionEvents: () => [],
        read: vi.fn(async () => []),
      },
    } as never))
    const res = await app.request('/floor?workspaceId=missing')
    expect(res.status).toBe(404)
  })

  it('projects active employees and hangs drawers; asOfSeq replays mood', async () => {
    const now = 50_000
    const read = vi.fn(async () => [
      {
        seq: 1,
        ts: now - 20_000,
        type: 'runtime.started',
        payload: { workspaceId: 'office-1', resumeId: 'resume-alice', agent: 'codex', surface: 'headless' },
      },
      {
        seq: 2,
        ts: now - 10_000,
        type: 'runtime.turn.tool',
        payload: {
          workspaceId: 'office-1',
          resumeId: 'resume-alice',
          agent: 'codex',
          toolName: 'workspace_list',
          toolStatus: 'running',
        },
      },
      {
        seq: 3,
        ts: now,
        type: 'runtime.stopped',
        payload: { workspaceId: 'office-1', resumeId: 'resume-alice', agent: 'codex', status: 'done' },
      },
    ])
    const app = new Hono().route('/', createOfficeRoutes({
      registry: {
        list: () => [{ id: 'office-1', tag: 'chat', template: 'chat' }],
        get: (id: string) => id === 'office-1' ? { id, tag: 'chat', template: 'chat' } : undefined,
      },
      sessionDirectory: vi.fn(async () => directory('office-1', 'chat', [
        {
          resumeId: 'resume-alice',
          agent: 'codex',
          lifecycle: 'active',
          latestExecution: {
            taskId: 'run-1',
            status: 'done',
            startedAt: now - 20_000,
            finishedAt: now,
            assistantPreview: 'Filed the finished report.',
          },
        },
        { resumeId: 'resume-archived', agent: 'pi', lifecycle: 'active', presence: 'archived' },
      ])),
      sessionRegistry: {
        findByResumeId: vi.fn((_ws: string, resumeId: string) => resumeId === 'resume-alice'
          ? { id: 'codex-1', name: 'c1', resumeId, title: 'Desk mate' }
          : undefined),
      },
      headlessTasks: {
        get: vi.fn((taskId: string) => taskId === 'run-1'
          ? {
              taskId,
              prompt: 'Read every relevant file, compare the Office interaction states, and return the complete live-floor QA report without shortening this assignment.',
            }
          : null),
      },
      agentRuntimeLog: {
        lastSeq: () => 3,
        firstSeq: () => 1,
        projectionEvents: () => [{
          seq: 3,
          ts: now,
          type: 'runtime.stopped',
          payload: {
            workspaceId: 'office-1',
            resumeId: 'resume-alice',
            agent: 'codex',
            surface: 'headless',
            status: 'done',
          },
        }],
        read,
      },
      provenanceStore: {
        list: vi.fn(() => [
          {
            id: 'prov-1',
            action: 'created',
            at: now,
            origin: { kind: 'session', workspaceId: 'office-1', resumeId: 'resume-alice', agent: 'codex' },
            artifact: { kind: 'report', workspaceId: 'office-1', path: 'docs/note.md' },
          },
        ]),
      },
    } as never))

    const live = await (await app.request('/floor')).json() as {
      offices: {
        employees: {
          resumeId: string
          title?: string
          mood: string
          latestResult?: { text: string; at: number }
          drawers: { label: string }[]
        }[]
      }[]
      lastSeq: number
    }
    expect(live.lastSeq).toBe(3)
    expect(live.offices).toHaveLength(1)
    expect(live.offices[0]?.employees).toHaveLength(1)
    expect(live.offices[0]?.employees[0]).toMatchObject({
      resumeId: 'resume-alice',
      title: 'Read every relevant file, compare the Office interaction states, and return the complete live-floor QA report without shortening this assignment.',
      latestResult: { text: 'Filed the finished report.', at: now },
      drawers: [expect.objectContaining({ label: 'note.md' })],
    })
    expect(read).not.toHaveBeenCalled()

    const replay = await (await app.request('/floor?asOfSeq=2')).json() as {
      offices: {
        employees: {
          mood: string
          bubble: { name?: string } | null
          latestResult?: { text: string; at: number }
        }[]
      }[]
      asOfSeq: number
    }
    expect(replay.asOfSeq).toBe(2)
    expect(replay.offices[0]?.employees[0]).toMatchObject({
      mood: 'working',
      bubble: { kind: 'tool', name: 'workspace_list' },
    })
    expect(replay.offices[0]?.employees[0]?.latestResult).toBeUndefined()
    expect(read).toHaveBeenCalledTimes(1)
  })
})

describe('Office Day', () => {
  const now = Date.parse('2026-09-01T12:00:00.000Z')
  const dayKey = '2026-09-01'

  async function build() {
    const dir = await mkdtemp(join(tmpdir(), 'openalice-office-day-route-'))
    const officeDayStore = await OfficeDayStore.load({
      path: join(dir, 'office', 'day.json'),
      timeZone: 'UTC',
      now: () => now,
    })
    return {
      dir,
      officeDayStore,
      app: new Hono().route('/', createOfficeRoutes({ officeDayStore } as never)),
    }
  }

  it('serves the shared envelope and command-shaped mutations', async () => {
    const { app, dir } = await build()
    try {
      const observed = await app.request('/day')
      expect(observed.status).toBe(200)
      expect(await observed.json()).toEqual({
        serverNow: now,
        dayKey,
        timeZone: 'UTC',
        nextRolloverAt: Date.parse('2026-09-02T00:00:00.000Z'),
        revision: 0,
        day: null,
      })

      const opened = await app.request('/day/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dayKey, slots: ['duty-a', 'duty-b'] }),
      })
      expect(opened.status).toBe(200)
      expect(await opened.json()).toMatchObject({
        applied: true,
        revision: 1,
        day: {
          shift: { id: 1, slots: ['duty-a', 'duty-b'], order: ['duty-a', 'duty-b'] },
          seenDutyIds: ['duty-a', 'duty-b'],
        },
      })

      const deferred = await app.request('/day/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'defer-duty',
          dayKey,
          shiftId: 1,
          dutyId: 'duty-a',
        }),
      })
      expect(deferred.status).toBe(200)
      expect(await deferred.json()).toMatchObject({
        applied: true,
        revision: 2,
        day: { shift: { order: ['duty-b', 'duty-a'] } },
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns the live snapshot instead of writing when a tab has a stale shift id', async () => {
    const { app, dir, officeDayStore } = await build()
    try {
      await officeDayStore.open({ dayKey, slots: ['old-duty'] })
      await officeDayStore.execute({
        type: 'reconcile-shift',
        dayKey,
        shiftId: 1,
        presentSlotIds: [],
        proposedSlots: [],
        unresolvedCount: 0,
      })
      await officeDayStore.execute({
        type: 'start-next-shift',
        dayKey,
        shiftId: 1,
        slots: ['new-duty'],
      })

      const response = await app.request('/day/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'defer-duty',
          dayKey,
          shiftId: 1,
          dutyId: 'old-duty',
        }),
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        applied: false,
        reason: 'stale-shift',
        revision: 3,
        day: { shift: { id: 3, slots: ['new-duty'] } },
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it.each([
    ['/day/open', JSON.stringify({ dayKey, slots: ['duplicate', 'duplicate'] })],
    ['/day/commands', JSON.stringify({
      kind: 'defer-duty',
      dayKey,
      shiftId: 1,
      dutyId: 'duty-a',
    })],
    ['/day/commands', JSON.stringify({
      type: 'review-evidence',
      dayKey,
      shiftId: 1,
      dutyId: JSON.stringify([
        'office-duty-v1',
        'cadence',
        'scheduled-issue-health:a',
        'subject-a',
        'fingerprint-a',
      ]),
      subjectKey: 'subject-b',
      fingerprint: 'fingerprint-b',
    })],
    ['/day/commands', '{'],
  ])('rejects an invalid command body at %s without mutating the day', async (path, body) => {
    const { app, dir } = await build()
    try {
      const response = await app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: 'invalid_office_day_request' })
      expect(await (await app.request('/day')).json()).toMatchObject({ revision: 0, day: null })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('fails every Office Day API closed when the durable sidecar is unavailable', async () => {
    const officeDayStore = OfficeDayStore.unavailable(new Error('malformed sidecar'), {
      timeZone: 'UTC',
      now: () => now,
    })
    const app = new Hono().route('/', createOfficeRoutes({ officeDayStore } as never))

    const observed = await app.request('/day')
    expect(observed.status).toBe(503)
    expect(await observed.json()).toMatchObject({ error: 'office_day_unavailable' })

    const opened = await app.request('/day/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dayKey, slots: [] }),
    })
    expect(opened.status).toBe(503)
    expect(await opened.json()).toMatchObject({ error: 'office_day_unavailable' })

    const commanded = await app.request('/day/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'forget-evidence', dayKey, subjectKey: 'subject-a' }),
    })
    expect(commanded.status).toBe(503)
    expect(await commanded.json()).toMatchObject({ error: 'office_day_unavailable' })
  })
})

describe('Office routine follow-ups', () => {
  const record = {
    inboxEntryId: 'report-1',
    reportTs: 1_700_000_000_000,
    issueWorkspaceId: 'issue-home',
    issueId: 'weekly-review',
    createdAt: 1_700_000_001_000,
  }

  function build(overrides: Record<string, unknown> = {}) {
    const get = vi.fn(async () => ({
      id: record.inboxEntryId,
      ts: record.reportTs,
      workspaceId: 'execution-desk',
      comments: 'Weekly evidence is ready.',
      origin: {
        kind: 'headless' as const,
        runId: 'run-1',
        issueWorkspaceId: record.issueWorkspaceId,
        issueId: record.issueId,
      },
    }))
    const issueDetail = vi.fn(async () => ({
      issue: {
        id: record.issueId,
        when: { kind: 'every' as const, every: '1w' },
      },
    }))
    const list = vi.fn(() => [record])
    const observeFollowUp = vi.fn(() => ({ followUp: null, revision: 0 }))
    const put = vi.fn(async () => ({ followUp: record, created: true }))
    const remove = vi.fn(async () => true)
    const svc = {
      inboxStore: { get },
      issueDetail,
      routineFollowUpStore: { list, observe: observeFollowUp, put, remove },
      ...overrides,
    }
    return {
      app: new Hono().route('/', createOfficeRoutes(svc as never)),
      get,
      issueDetail,
      list,
      observeFollowUp,
      put,
      remove,
    }
  }

  it('lists the durable queue in one stable envelope', async () => {
    const { app, list } = build()

    const response = await app.request('/routine-follow-ups')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ followUps: [record] })
    expect(list).toHaveBeenCalledOnce()
  })

  it('derives the exact scheduled Issue authority from Inbox and ignores spoofed request data', async () => {
    const { app, get, issueDetail, put } = build()

    const response = await app.request('/routine-follow-ups/report-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reportTs: 1,
        issueWorkspaceId: 'spoofed-workspace',
        issueId: 'spoofed-issue',
      }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ followUp: record, created: true })
    expect(get).toHaveBeenCalledWith('report-1')
    expect(issueDetail).toHaveBeenCalledWith('issue-home', 'weekly-review')
    expect(put).toHaveBeenCalledWith(
      {
        inboxEntryId: 'report-1',
        reportTs: record.reportTs,
        issueWorkspaceId: 'issue-home',
        issueId: 'weekly-review',
      },
      { allowCreate: true, observedRevision: 0 },
    )
  })

  it('preserves the idempotent put result', async () => {
    const put = vi.fn(async () => ({ followUp: record, created: false }))
    const issueDetail = vi.fn(async () => null)
    const { app } = build({
      inboxStore: {
        get: vi.fn(async () => ({
          id: record.inboxEntryId,
          ts: record.reportTs,
          workspaceId: 'execution-desk',
          comments: 'Weekly evidence is ready.',
          readAt: record.reportTs + 1,
          origin: {
            kind: 'headless' as const,
            runId: 'run-1',
            issueWorkspaceId: record.issueWorkspaceId,
            issueId: record.issueId,
          },
        })),
      },
      issueDetail,
      routineFollowUpStore: {
        list: vi.fn(() => [record]),
        observe: vi.fn(() => ({ followUp: record, revision: 7 })),
        put,
        remove: vi.fn(),
      },
    })

    const response = await app.request('/routine-follow-ups/report-1', { method: 'PUT' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ followUp: record, created: false })
    expect(issueDetail).not.toHaveBeenCalled()
    expect(put).toHaveBeenCalledWith(
      {
        inboxEntryId: record.inboxEntryId,
        reportTs: record.reportTs,
        issueWorkspaceId: record.issueWorkspaceId,
        issueId: record.issueId,
      },
      { allowCreate: false, observedRevision: 7 },
    )
  })

  it('rejects a fresh carry after the exact Inbox report was already reviewed', async () => {
    const issueDetail = vi.fn()
    const put = vi.fn(async () => {
      throw new RoutineFollowUpCreateDisallowedError(record.inboxEntryId)
    })
    const { app } = build({
      inboxStore: {
        get: vi.fn(async () => ({
          id: record.inboxEntryId,
          ts: record.reportTs,
          workspaceId: 'execution-desk',
          comments: 'Weekly evidence is ready.',
          readAt: record.reportTs + 1,
          origin: {
            kind: 'headless' as const,
            runId: 'run-1',
            issueWorkspaceId: record.issueWorkspaceId,
            issueId: record.issueId,
          },
        })),
      },
      issueDetail,
      routineFollowUpStore: {
        list: vi.fn(() => []),
        observe: vi.fn(() => ({ followUp: null, revision: 0 })),
        put,
        remove: vi.fn(),
      },
    })

    const response = await app.request('/routine-follow-ups/report-1', { method: 'PUT' })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'routine_report_already_reviewed' })
    expect(issueDetail).not.toHaveBeenCalled()
    expect(put).toHaveBeenCalledWith(
      {
        inboxEntryId: record.inboxEntryId,
        reportTs: record.reportTs,
        issueWorkspaceId: record.issueWorkspaceId,
        issueId: record.issueId,
      },
      { allowCreate: false, observedRevision: 0 },
    )
  })

  it('replays an existing carry even after its Issue disappears or stops scheduling', async () => {
    const issueDetail = vi.fn(async () => ({ issue: { id: record.issueId } }))
    const put = vi.fn(async () => ({ followUp: record, created: false }))
    const { app } = build({
      issueDetail,
      routineFollowUpStore: {
        list: vi.fn(() => [record]),
        observe: vi.fn(() => ({ followUp: record, revision: 7 })),
        put,
        remove: vi.fn(),
      },
    })

    const response = await app.request('/routine-follow-ups/report-1', { method: 'PUT' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ followUp: record, created: false })
    expect(issueDetail).not.toHaveBeenCalled()
    expect(put).toHaveBeenCalledWith(
      {
        inboxEntryId: record.inboxEntryId,
        reportTs: record.reportTs,
        issueWorkspaceId: record.issueWorkspaceId,
        issueId: record.issueId,
      },
      { allowCreate: false, observedRevision: 7 },
    )
  })

  it.each([
    ['reviewed', record.reportTs + 1, 'routine_follow_up_no_longer_active'],
    ['still-unread', undefined, 'routine_follow_up_no_longer_active'],
  ] as const)(
    'does not let a stale existing snapshot recreate a %s follow-up after concurrent resolve',
    async (_receiptState, readAt, expectedError) => {
      const dir = await mkdtemp(join(tmpdir(), 'openalice-office-follow-up-aba-'))
      const store = await RoutineFollowUpStore.load(join(dir, 'routine-follow-ups.json'))
      await store.put({
        inboxEntryId: record.inboxEntryId,
        reportTs: record.reportTs,
        issueWorkspaceId: record.issueWorkspaceId,
        issueId: record.issueId,
      }, {
        allowCreate: true,
        observedRevision: 0,
        createdAt: record.createdAt,
      })
      const inboxLookup = deferred<{
        id: string
        ts: number
        workspaceId: string
        comments: string
        readAt?: number
        origin: {
          kind: 'headless'
          runId: string
          issueWorkspaceId: string
          issueId: string
        }
      }>()
      const observeFollowUp = vi.spyOn(store, 'observe')
      const issueDetail = vi.fn()
      const app = new Hono().route('/', createOfficeRoutes({
        inboxStore: { get: vi.fn(() => inboxLookup.promise) },
        issueDetail,
        routineFollowUpStore: store,
      } as never))

      const stalePut = app.request('/routine-follow-ups/report-1', { method: 'PUT' })
      await vi.waitFor(() => expect(observeFollowUp).toHaveBeenCalledWith(record.inboxEntryId))
      await expect(store.remove(record.inboxEntryId)).resolves.toBe(true)
      inboxLookup.resolve({
        id: record.inboxEntryId,
        ts: record.reportTs,
        workspaceId: 'execution-desk',
        comments: 'Weekly evidence is ready.',
        ...(readAt === undefined ? {} : { readAt }),
        origin: {
          kind: 'headless',
          runId: 'run-1',
          issueWorkspaceId: record.issueWorkspaceId,
          issueId: record.issueId,
        },
      })

      const response = await stalePut
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ error: expectedError })
      expect(issueDetail).not.toHaveBeenCalled()
      expect(store.list()).toEqual([])
      expect((await RoutineFollowUpStore.load(join(dir, 'routine-follow-ups.json'))).list())
        .toEqual([])

      observeFollowUp.mockRestore()
      await rm(dir, { recursive: true, force: true })
    },
  )

  it('does not let a stale absent snapshot recreate after a concurrent carry and resolve', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openalice-office-follow-up-fresh-aba-'))
    const store = await RoutineFollowUpStore.load(join(dir, 'routine-follow-ups.json'))
    const issueLookup = deferred<{
      issue: {
        id: string
        when: { kind: 'every'; every: string }
      }
    }>()
    let authoritativeReadAt: number | undefined
    const inboxStore = {
      get: vi.fn(async () => ({
        id: record.inboxEntryId,
        ts: record.reportTs,
        workspaceId: 'execution-desk',
        comments: 'Weekly evidence is ready.',
        ...(authoritativeReadAt === undefined ? {} : { readAt: authoritativeReadAt }),
        origin: {
          kind: 'headless' as const,
          runId: 'run-1',
          issueWorkspaceId: record.issueWorkspaceId,
          issueId: record.issueId,
        },
      })),
    }
    const issueDetail = vi.fn(() => issueLookup.promise)
    const app = new Hono().route('/', createOfficeRoutes({
      inboxStore,
      issueDetail,
      routineFollowUpStore: store,
    } as never))

    try {
      const stalePut = app.request('/routine-follow-ups/report-1', { method: 'PUT' })
      await vi.waitFor(() => expect(issueDetail).toHaveBeenCalledWith(
        record.issueWorkspaceId,
        record.issueId,
      ))

      const concurrentObservation = store.observe(record.inboxEntryId)
      expect(concurrentObservation).toEqual({ followUp: null, revision: 0 })
      await store.put({
        inboxEntryId: record.inboxEntryId,
        reportTs: record.reportTs,
        issueWorkspaceId: record.issueWorkspaceId,
        issueId: record.issueId,
      }, {
        allowCreate: true,
        observedRevision: concurrentObservation.revision,
        createdAt: record.createdAt,
      })
      authoritativeReadAt = record.reportTs + 1
      await expect(store.remove(record.inboxEntryId)).resolves.toBe(true)

      issueLookup.resolve({
        issue: {
          id: record.issueId,
          when: { kind: 'every', every: '1w' },
        },
      })
      const response = await stalePut

      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({
        error: 'routine_follow_up_no_longer_active',
      })
      expect(store.list()).toEqual([])
      expect((await RoutineFollowUpStore.load(join(dir, 'routine-follow-ups.json'))).list())
        .toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns a clear error when Inbox authority is unavailable', async () => {
    const { app } = build({ inboxStore: undefined })

    const response = await app.request('/routine-follow-ups/report-1', { method: 'PUT' })

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: 'inbox_unavailable' })
  })

  it('rejects a missing Inbox report before consulting Issues', async () => {
    const issueDetail = vi.fn()
    const { app } = build({
      inboxStore: { get: vi.fn(async () => null) },
      issueDetail,
    })

    const response = await app.request('/routine-follow-ups/missing', { method: 'PUT' })

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: 'inbox_entry_not_found' })
    expect(issueDetail).not.toHaveBeenCalled()
  })

  it.each([
    ['missing provenance', {
      id: 'report-1',
      ts: record.reportTs,
      workspaceId: 'execution-desk',
      comments: 'Manual note.',
    }],
    ['interactive provenance', {
      id: 'report-1',
      ts: record.reportTs,
      workspaceId: 'execution-desk',
      comments: 'Interactive note.',
      origin: {
        kind: 'interactive',
        issueWorkspaceId: record.issueWorkspaceId,
        issueId: record.issueId,
      },
    }],
    ['invalid timestamp', {
      id: 'report-1',
      ts: Number.NaN,
      workspaceId: 'execution-desk',
      comments: 'Broken report.',
      origin: {
        kind: 'headless',
        issueWorkspaceId: record.issueWorkspaceId,
        issueId: record.issueId,
      },
    }],
  ])('rejects %s as a routine report', async (_label, entry) => {
    const issueDetail = vi.fn()
    const { app } = build({ inboxStore: { get: vi.fn(async () => entry) }, issueDetail })

    const response = await app.request('/routine-follow-ups/report-1', { method: 'PUT' })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: 'not_a_routine_report' })
    expect(issueDetail).not.toHaveBeenCalled()
  })

  it('rejects a report whose exact Issue disappeared', async () => {
    const { app } = build({ issueDetail: vi.fn(async () => null) })

    const response = await app.request('/routine-follow-ups/report-1', { method: 'PUT' })

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: 'routine_issue_not_found' })
  })

  it('rejects a report whose Issue is not scheduled', async () => {
    const { app } = build({ issueDetail: vi.fn(async () => ({ issue: { id: 'weekly-review' } })) })

    const response = await app.request('/routine-follow-ups/report-1', { method: 'PUT' })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: 'routine_issue_not_scheduled' })
  })

  it('surfaces a durable identity conflict as 409', async () => {
    const put = vi.fn(async () => {
      throw new RoutineFollowUpConflictError('report-1')
    })
    const issueDetail = vi.fn()
    const { app } = build({
      issueDetail,
      routineFollowUpStore: {
        list: vi.fn(),
        observe: vi.fn(() => ({ followUp: record, revision: 7 })),
        put,
        remove: vi.fn(),
      },
    })

    const response = await app.request('/routine-follow-ups/report-1', { method: 'PUT' })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'routine_follow_up_conflict' })
    expect(issueDetail).not.toHaveBeenCalled()
  })

  it('fails every decision-queue API closed when the durable sidecar is malformed', async () => {
    const unavailable = RoutineFollowUpStore.unavailable(new Error('malformed sidecar'))
    const { app, get } = build({ routineFollowUpStore: unavailable })

    const listed = await app.request('/routine-follow-ups')
    expect(listed.status).toBe(503)
    expect(await listed.json()).toMatchObject({ error: 'routine_follow_up_unavailable' })

    const carried = await app.request('/routine-follow-ups/report-1', { method: 'PUT' })
    expect(carried.status).toBe(503)
    expect(await carried.json()).toMatchObject({ error: 'routine_follow_up_unavailable' })
    expect(get).not.toHaveBeenCalled()

    const resolved = await app.request('/routine-follow-ups/report-1', { method: 'DELETE' })
    expect(resolved.status).toBe(503)
    expect(await resolved.json()).toMatchObject({ error: 'routine_follow_up_unavailable' })
  })

  it('resolves a follow-up idempotently and reports whether anything changed', async () => {
    const { app, remove } = build()

    const removed = await app.request('/routine-follow-ups/report-1', { method: 'DELETE' })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ ok: true, removed: true })
    expect(remove).toHaveBeenCalledWith('report-1')

    remove.mockResolvedValueOnce(false)
    const repeated = await app.request('/routine-follow-ups/report-1', { method: 'DELETE' })
    expect(repeated.status).toBe(200)
    expect(await repeated.json()).toEqual({ ok: true, removed: false })
  })
})
