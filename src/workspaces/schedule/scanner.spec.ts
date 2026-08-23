import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Schedule } from '../../core/schedule-expr.js'
import type { CliAdapter } from '../cli-adapter.js'
import type { Logger } from '../logger.js'
import type { WorkspaceMeta, WorkspaceRegistry } from '../workspace-registry.js'

import { ScheduleScanner, type MarkerStore, type ScheduleScannerDeps } from './scanner.js'

const NOW = 1_700_000_000_000 // realistic epoch ms — `every` is relative-from-0, so first-sight needs a large clock

const noopLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  event() {},
  child() {
    return noopLogger
  },
} as unknown as Logger

class FakeMarkers implements MarkerStore {
  private m = new Map<string, number>()
  private held = new Map<string, number>()
  pruned: Set<string> | null = null
  key(w: string, t: string): string {
    return `${w} ${t}`
  }
  get(w: string, t: string): number | undefined {
    return this.m.get(this.key(w, t))
  }
  getHeld(w: string, t: string): number | undefined {
    return this.held.get(this.key(w, t))
  }
  async set(w: string, t: string, ts: number): Promise<void> {
    this.m.set(this.key(w, t), ts)
    this.held.delete(this.key(w, t))
  }
  async hold(w: string, t: string, ts: number): Promise<void> {
    this.held.set(this.key(w, t), ts)
  }
  async prune(seen: Set<string>): Promise<void> {
    this.pruned = seen
    for (const k of [...this.m.keys()]) if (!seen.has(k)) this.m.delete(k)
    for (const k of [...this.held.keys()]) if (!seen.has(k)) this.held.delete(k)
  }
}

const headlessAdapter = {
  id: 'claude',
  capabilities: { headless: true },
  composeHeadlessCommand: () => [],
} as unknown as CliAdapter

const nonHeadlessAdapter = {
  id: 'shell',
  capabilities: { headless: false },
} as unknown as CliAdapter

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sched-scan-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

interface IssueSpec {
  id: string
  title: string
  when?: Schedule
  what?: string
  status?: string
  priority?: string
  agent?: string
  credential?: string
  credentialSource?: 'native'
  model?: string
  effort?: string
  timeout?: string
  assignee?: string
  connectorDesk?: string
  body?: string
}

/** Serialize one issue spec to its `.alice/issues/<id>.md` frontmatter form. */
function issueMd(spec: IssueSpec): string {
  const lines = [`title: ${spec.title}`]
  if (spec.status) lines.push(`status: ${spec.status}`)
  if (spec.priority) lines.push(`priority: ${spec.priority}`)
  if (spec.what) lines.push(`what: ${spec.what}`)
  if (spec.agent) lines.push(`agent: ${spec.agent}`)
  if (spec.credential) lines.push(`credential: ${spec.credential}`)
  if (spec.credentialSource) lines.push(`credentialSource: ${spec.credentialSource}`)
  if (spec.model) lines.push(`model: ${spec.model}`)
  if (spec.effort) lines.push(`effort: ${spec.effort}`)
  if (spec.timeout) lines.push(`timeout: ${spec.timeout}`)
  if (spec.connectorDesk) lines.push(`connectorDesk: ${spec.connectorDesk}`)
  // Scanner tests exercise dispatch policy, not declaration defaults. Keep the
  // historical fresh-every-fire fixture explicit now that omitted scheduled
  // ownership means recruit once (`@new-then-resume`).
  const assignee = spec.assignee ?? (spec.when ? '@new-each-run' : undefined)
  if (assignee) lines.push(`assignee: ${JSON.stringify(assignee)}`)
  if (spec.when) {
    const w = spec.when
    const inner =
      w.kind === 'at'
        ? `kind: at, at: "${w.at}"`
        : w.kind === 'every'
          ? `kind: every, every: "${w.every}"`
          : `kind: cron, cron: "${w.cron}"${w.catchUp === false ? ', catchUp: false' : ''}`
    lines.push(`when: { ${inner} }`)
  }
  return `---\n${lines.join('\n')}\n---\n${spec.body ?? ''}`
}

async function makeWs(id: string, issues: IssueSpec[]): Promise<WorkspaceMeta> {
  const dir = join(root, id)
  const issuesDir = join(dir, '.alice', 'issues')
  await mkdir(issuesDir, { recursive: true })
  for (const issue of issues) {
    await writeFile(join(issuesDir, `${issue.id}.md`), issueMd(issue), 'utf8')
  }
  return { id, tag: id, dir, createdAt: new Date(NOW).toISOString() }
}

function scannerFor(
  workspaces: WorkspaceMeta[],
  opts: {
    dispatch?: (
      m: WorkspaceMeta,
      a: CliAdapter,
      p: string,
      t?: number,
      trigger?: import('../headless-task-registry.js').HeadlessTaskTrigger,
      resumeId?: string,
    ) => Promise<{ taskId: string; resumeId: string }>
    markers?: MarkerStore
    now?: number
    adapter?: CliAdapter
    resolveAdapter?: ScheduleScannerDeps['resolveAdapter']
    resolveResumeWorkspace?: ScheduleScannerDeps['resolveResumeWorkspace']
    claimFreshSession?: ScheduleScannerDeps['claimFreshSession']
    observeIssues?: ScheduleScannerDeps['observeIssues']
  } = {},
) {
  const dispatch = opts.dispatch ?? vi.fn(async () => ({ taskId: 'run-1', resumeId: 'resume-new-worker-a1b2c3' }))
  const markers = opts.markers ?? new FakeMarkers()
  const scanner = new ScheduleScanner({
    registry: {
      list: () => workspaces,
      get: (id: string) => workspaces.find((workspace) => workspace.id === id),
    } as unknown as WorkspaceRegistry,
    resolveResumeWorkspace: opts.resolveResumeWorkspace ?? (() => workspaces[0]),
    resolveAdapter: opts.resolveAdapter ?? (() => opts.adapter ?? headlessAdapter),
    dispatch,
    claimFreshSession: opts.claimFreshSession,
    observeIssues: opts.observeIssues,
    markers,
    logger: noopLogger,
    now: () => opts.now ?? NOW,
  })
  return { scanner, dispatch, markers }
}

describe('ScheduleScanner', () => {
  it('stamps connector cron metadata on scheduled and run-now phone-desk runs', async () => {
    const ws = await makeWs('w1', [{
      id: 'telegram-phone-desk',
      title: 'Telegram phone desk',
      when: { kind: 'every', every: '30m' },
      what: 'wake',
      connectorDesk: 'telegram',
    }])
    const { scanner, dispatch } = scannerFor([ws])

    await scanner.scan()
    expect(vi.mocked(dispatch).mock.calls[0]?.[4]).toEqual({
      kind: 'issue',
      workspaceId: 'w1',
      issueId: 'telegram-phone-desk',
      metadata: {
        kind: 'connector-cron-issue',
        connectorId: 'telegram',
      },
    })

    await scanner.runIssueNow('w1', 'telegram-phone-desk')
    expect(vi.mocked(dispatch).mock.calls[1]?.[4]).toEqual({
      kind: 'issue',
      workspaceId: 'w1',
      issueId: 'telegram-phone-desk',
      metadata: {
        kind: 'connector-cron-issue',
        connectorId: 'telegram',
      },
    })
  })

  it('manually retries with live Issue semantics without moving the schedule marker', async () => {
    const ws = await makeWs('w1', [{
      id: 'retry-me',
      title: 'Retry me',
      when: { kind: 'every', every: '30m' },
      what: 'same exact prompt',
      agent: 'claude',
    }])
    const { scanner, dispatch, markers } = scannerFor([ws])

    await expect(scanner.runIssueNow('w1', 'retry-me')).resolves.toEqual({ taskId: 'run-1' })
    expect(dispatch).toHaveBeenCalledWith(
      ws,
      headlessAdapter,
      'same exact prompt',
      undefined,
      { kind: 'issue', workspaceId: 'w1', issueId: 'retry-me' },
      undefined,
      undefined,
      undefined,
      undefined,
      {
        kind: 'issue',
        workspaceId: 'w1',
        issueId: 'retry-me',
        policy: 'new-each-run',
        fire: 'retry',
      },
    )
    expect(markers.get('w1', 'retry-me')).toBeUndefined()
  })

  it('passes an Issue timeout as the dispatch watchdog and omits it by default', async () => {
    const limited = await makeWs('w1', [{
      id: 'limited',
      title: 'Limited',
      when: { kind: 'every', every: '30m' },
      what: 'go',
      timeout: '45m',
    }])
    const unlimited = await makeWs('w2', [{
      id: 'open',
      title: 'Open',
      when: { kind: 'every', every: '30m' },
      what: 'go',
    }])
    const { scanner: limitedScanner, dispatch: limitedDispatch } = scannerFor([limited])
    const { scanner: unlimitedScanner, dispatch: unlimitedDispatch } = scannerFor([unlimited])
    await limitedScanner.scan()
    await unlimitedScanner.scan()
    expect(limitedDispatch).toHaveBeenCalledWith(
      limited,
      headlessAdapter,
      'go',
      45 * 60_000,
      { kind: 'issue', workspaceId: 'w1', issueId: 'limited' },
      undefined,
      undefined,
      undefined,
      undefined,
      {
        kind: 'issue',
        workspaceId: 'w1',
        issueId: 'limited',
        policy: 'new-each-run',
        fire: 'schedule',
      },
    )
    expect(unlimitedDispatch).toHaveBeenCalledWith(
      unlimited,
      headlessAdapter,
      'go',
      undefined,
      { kind: 'issue', workspaceId: 'w2', issueId: 'open' },
      undefined,
      undefined,
      undefined,
      undefined,
      {
        kind: 'issue',
        workspaceId: 'w2',
        issueId: 'open',
        policy: 'new-each-run',
        fire: 'schedule',
      },
    )

    const { scanner: retryScanner, dispatch: retryDispatch } = scannerFor([limited])
    await retryScanner.runIssueNow('w1', 'limited')
    expect(retryDispatch).toHaveBeenCalledWith(
      limited,
      headlessAdapter,
      'go',
      45 * 60_000,
      { kind: 'issue', workspaceId: 'w1', issueId: 'limited' },
      undefined,
      undefined,
      undefined,
      undefined,
      {
        kind: 'issue',
        workspaceId: 'w1',
        issueId: 'limited',
        policy: 'new-each-run',
        fire: 'retry',
      },
    )
  })

  it('refuses manual retry for an unscheduled or terminal Issue', async () => {
    const ws = await makeWs('w1', [
      { id: 'plain', title: 'Plain work' },
      { id: 'closed', title: 'Closed', status: 'done', when: { kind: 'every', every: '30m' } },
    ])
    const { scanner } = scannerFor([ws])
    await expect(scanner.runIssueNow('w1', 'plain')).rejects.toMatchObject({ code: 'not_scheduled' })
    await expect(scanner.runIssueNow('w1', 'closed')).rejects.toMatchObject({ code: 'not_fireable' })
  })

  it('fires a scheduled (every) issue on first sight and records the marker after dispatch', async () => {
    const ws = await makeWs('w1', [{ id: 't1', title: 'i1', when: { kind: 'every', every: '30m' }, what: 'go' }])
    const { scanner, dispatch, markers } = scannerFor([ws])
    await scanner.scan()
    expect(dispatch).toHaveBeenCalledTimes(1)
    // 5th arg = the firing issue's id, threaded so the run records its origin.
    expect(dispatch).toHaveBeenCalledWith(
      ws,
      headlessAdapter,
      'go',
      undefined,
      { kind: 'issue', workspaceId: 'w1', issueId: 't1' },
      undefined,
      undefined,
      undefined,
      undefined,
      {
        kind: 'issue',
        workspaceId: 'w1',
        issueId: 't1',
        policy: 'new-each-run',
        fire: 'schedule',
      },
    )
    expect(markers.get('w1', 't1')).toBe(NOW)
  })

  it('does not repeat an occurrence after dispatch registered a run that later fails', async () => {
    const ws = await makeWs('w1', [{
      id: 't1',
      title: 'i1',
      when: { kind: 'every', every: '30m' },
      what: 'go',
    }])
    // Dispatch acceptance means the durable run exists. Its asynchronous
    // launch/result may fail later, but that is one recorded occurrence and
    // must not turn the scanner interval into an automatic retry loop.
    const dispatch = vi.fn(async () => ({
      taskId: 'run-that-will-fail',
      resumeId: 'resume-failed-run-a1b2c3',
    }))
    const { scanner, markers } = scannerFor([ws], { dispatch })
    await scanner.scan()
    await scanner.scan()
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(markers.get('w1', 't1')).toBe(NOW)
  })

  it('passes Issue credential, model, and effort as one fresh-Session selection', async () => {
    const ws = await makeWs('w1', [{
      id: 'tuned',
      title: 'tuned run',
      when: { kind: 'every', every: '30m' },
      what: 'go',
      agent: 'claude',
      credential: 'anthropic-primary',
      model: 'claude-opus-4-8',
      effort: 'high',
    }])
    const { scanner, dispatch } = scannerFor([ws])
    await scanner.scan()
    expect(dispatch).toHaveBeenCalledWith(
      ws,
      headlessAdapter,
      'go',
      undefined,
      { kind: 'issue', workspaceId: 'w1', issueId: 'tuned' },
      undefined,
      undefined,
      { credentialSlug: 'anthropic-primary', model: 'claude-opus-4-8', reasoningEffort: 'high' },
      undefined,
      {
        kind: 'issue',
        workspaceId: 'w1',
        issueId: 'tuned',
        policy: 'new-each-run',
        fire: 'schedule',
      },
    )
  })

  it('passes explicit native Agent login without mistaking it for Workspace inheritance', async () => {
    const ws = await makeWs('w1', [{
      id: 'native',
      title: 'native run',
      when: { kind: 'every', every: '30m' },
      what: 'go',
      agent: 'codex',
      credentialSource: 'native',
      model: 'gpt-5.6-sol',
      effort: 'low',
    }])
    const { scanner, dispatch } = scannerFor([ws])
    await scanner.scan()
    expect(dispatch).toHaveBeenCalledWith(
      ws,
      headlessAdapter,
      'go',
      undefined,
      { kind: 'issue', workspaceId: 'w1', issueId: 'native' },
      undefined,
      undefined,
      { credentialSource: 'native', model: 'gpt-5.6-sol', reasoningEffort: 'low' },
      undefined,
      {
        kind: 'issue',
        workspaceId: 'w1',
        issueId: 'native',
        policy: 'new-each-run',
        fire: 'schedule',
      },
    )
  })

  it('passes one exact resumeId through adapter resolution and dispatch', async () => {
    const ws = await makeWs('w1', [{
      id: 'owned',
      title: 'owned work',
      when: { kind: 'every', every: '30m' },
      what: 'continue',
      assignee: '@resume-kind-owl-abc123',
    }])
    const resolveAdapter = vi.fn(async () => headlessAdapter)
    const { scanner, dispatch } = scannerFor([ws], { resolveAdapter })
    await scanner.scan()

    expect(resolveAdapter).toHaveBeenCalledWith(ws, undefined, 'resume-kind-owl-abc123')
    expect(dispatch).toHaveBeenCalledWith(
      ws,
      headlessAdapter,
      'continue',
      undefined,
      { kind: 'issue', workspaceId: 'w1', issueId: 'owned' },
      'resume-kind-owl-abc123',
    )
    expect(scanner.snapshot()!.workspaces[0].tasks[0].assignee)
      .toBe('@resume-kind-owl-abc123')
  })

  it('assigns @new-then-resume to the first fresh Session before advancing the marker', async () => {
    const ws = await makeWs('w1', [{
      id: 'sticky',
      title: 'sticky worker',
      when: { kind: 'every', every: '30m' },
      what: 'own this work from now on',
      assignee: '@new-then-resume',
    }])
    const claimFreshSession = vi.fn(async () => undefined)
    const { scanner, dispatch, markers } = scannerFor([ws], { claimFreshSession })

    await scanner.scan()

    expect(dispatch).toHaveBeenCalledWith(
      ws,
      headlessAdapter,
      'own this work from now on',
      undefined,
      { kind: 'issue', workspaceId: 'w1', issueId: 'sticky' },
      undefined,
      undefined,
      undefined,
      undefined,
      {
        kind: 'issue',
        workspaceId: 'w1',
        issueId: 'sticky',
        policy: 'new-then-resume',
        fire: 'schedule',
      },
    )
    expect(claimFreshSession).toHaveBeenCalledWith({
      issueWorkspace: ws,
      issueId: 'sticky',
      taskId: 'run-1',
      resumeId: 'resume-new-worker-a1b2c3',
      agent: 'claude',
    })
    expect(markers.get('w1', 'sticky')).toBe(NOW)
  })

  it('advances the dispatched occurrence when the Session claim write fails', async () => {
    const ws = await makeWs('w1', [{
      id: 'sticky', title: 'sticky worker', when: { kind: 'every', every: '30m' },
      what: 'own this work', assignee: '@new-then-resume',
    }])
    const claimFreshSession = vi.fn(async () => { throw new Error('claim write failed') })
    const { scanner, markers } = scannerFor([ws], { claimFreshSession })

    await scanner.scan()

    // The worker already started; retrying the due occurrence would recruit a
    // second worker immediately. The claim failure is logged independently.
    expect(markers.get('w1', 'sticky')).toBe(NOW)
  })

  it('executes an exact cross-Workspace signature while retaining the home Issue trigger', async () => {
    const home = await makeWs('home', [{
      id: 'review-report', title: 'Review report', when: { kind: 'every', every: '30m' },
      what: 'revisit your report', assignee: '@resume-peer-author',
    }])
    const execution = await makeWs('peer', [])
    const resolveAdapter = vi.fn(async () => headlessAdapter)
    const { scanner, dispatch } = scannerFor([home, execution], {
      resolveAdapter,
      resolveResumeWorkspace: () => execution,
    })
    await scanner.scan()
    expect(resolveAdapter).toHaveBeenCalledWith(execution, undefined, 'resume-peer-author')
    expect(dispatch).toHaveBeenCalledWith(
      execution,
      headlessAdapter,
      'revisit your report',
      undefined,
      { kind: 'issue', workspaceId: 'home', issueId: 'review-report' },
      'resume-peer-author',
    )
  })

  it('ignores an UNSCHEDULED issue (no when): never fires, never in the snapshot', async () => {
    const ws = await makeWs('w1', [{ id: 'work', title: 'a tracked work item' }])
    const { scanner, dispatch } = scannerFor([ws])
    await scanner.scan()
    expect(dispatch).not.toHaveBeenCalled()
    const w = scanner.snapshot()!.workspaces[0]
    expect(w.status).toBe('ok')
    expect(w.tasks).toHaveLength(0)
  })

  it('fires scheduled issues but skips unscheduled ones in the same workspace', async () => {
    const ws = await makeWs('w1', [
      { id: 'sched', title: 'scheduled', when: { kind: 'every', every: '30m' }, what: 'go' },
      { id: 'work', title: 'unscheduled work item' },
    ])
    const { scanner, dispatch } = scannerFor([ws])
    await scanner.scan()
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith(
      ws,
      headlessAdapter,
      'go',
      undefined,
      { kind: 'issue', workspaceId: 'w1', issueId: 'sched' },
      undefined,
      undefined,
      undefined,
      undefined,
      {
        kind: 'issue',
        workspaceId: 'w1',
        issueId: 'sched',
        policy: 'new-each-run',
        fire: 'schedule',
      },
    )
    expect(scanner.snapshot()!.workspaces[0].tasks.map((t) => t.id)).toEqual(['sched'])
  })

  it('sends the canonical markdown What without prepending the display title', async () => {
    const ws = await makeWs('w1', [
      { id: 't1', title: 'Do research', when: { kind: 'every', every: '30m' }, body: 'scan movers' },
    ])
    const { scanner, dispatch } = scannerFor([ws])
    await scanner.scan()
    expect(dispatch).toHaveBeenCalledWith(
      ws,
      headlessAdapter,
      'scan movers',
      undefined,
      { kind: 'issue', workspaceId: 'w1', issueId: 't1' },
      undefined,
      undefined,
      undefined,
      undefined,
      {
        kind: 'issue',
        workspaceId: 'w1',
        issueId: 't1',
        policy: 'new-each-run',
        fire: 'schedule',
      },
    )
  })

  it('fires a never-fired cron issue whose occurrence is within the last tick (not never)', async () => {
    // '* * * * *' fires every minute → an occurrence always falls in the last 60s.
    const ws = await makeWs('w1', [{ id: 'c1', title: 'i-cron', when: { kind: 'cron', cron: '* * * * *' }, what: 'tick' }])
    const { scanner, dispatch } = scannerFor([ws])
    await scanner.scan()
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('does not fire a never-fired cron whose next occurrence is far in the future', async () => {
    // Jan 1 00:00 — NOW (mid-2023) is nowhere near it.
    const ws = await makeWs('w1', [{ id: 'c1', title: 'i-ny', when: { kind: 'cron', cron: '0 0 1 1 *' }, what: 'ny' }])
    const { scanner, dispatch } = scannerFor([ws])
    await scanner.scan()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('does not re-fire within the cadence', async () => {
    const ws = await makeWs('w1', [{ id: 't1', title: 'i1', when: { kind: 'every', every: '30m' }, what: 'go' }])
    const markers = new FakeMarkers()
    await markers.set('w1', 't1', NOW)
    const { scanner, dispatch } = scannerFor([ws], { markers, now: NOW + 10 * 60_000 })
    await scanner.scan()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('re-fires once the cadence elapses', async () => {
    const ws = await makeWs('w1', [{ id: 't1', title: 'i1', when: { kind: 'every', every: '30m' }, what: 'go' }])
    const markers = new FakeMarkers()
    await markers.set('w1', 't1', NOW)
    const { scanner, dispatch } = scannerFor([ws], { markers, now: NOW + 31 * 60_000 })
    await scanner.scan()
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('skips a terminal-status (canceled) scheduled issue but still tracks it for prune', async () => {
    const ws = await makeWs('w1', [
      { id: 't1', title: 'i1', when: { kind: 'every', every: '1m' }, what: 'go', status: 'canceled' },
    ])
    const { scanner, dispatch, markers } = scannerFor([ws])
    await scanner.scan()
    expect(dispatch).not.toHaveBeenCalled()
    expect((markers as FakeMarkers).pruned?.has(markers.key('w1', 't1'))).toBe(true)
  })

  it('keeps a never-fired cron due after an admission skip', async () => {
    const ws = await makeWs('w1', [{
      id: 'c1',
      title: 'i-cron',
      when: { kind: 'cron', cron: '* * * * *' },
      what: 'tick',
    }])
    const dispatch = vi.fn(async () => {
      throw new Error('this conversation already has a running turn')
    })
    const { scanner, markers } = scannerFor([ws], { dispatch })
    await scanner.scan()
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(markers.get('w1', 'c1')).toBeUndefined()
    expect(markers.getHeld('w1', 'c1')).toBeTypeOf('number')
    await scanner.scan()
    expect(dispatch).toHaveBeenCalledTimes(2)
  })

  it('consumes every elapsed cron slot when catchUp is false', async () => {
    const ws = await makeWs('w1', [{
      id: 'c1',
      title: 'i-cron',
      when: { kind: 'cron', cron: '* * * * *', catchUp: false },
      what: 'tick',
    }])
    const dispatch = vi.fn(async () => {
      throw new Error('this conversation already has a running turn')
    })
    const markers = new FakeMarkers()
    // Simulate a previously successful fire followed by a long sleep. There
    // are several stale minute slots behind the current wall clock.
    await markers.set('w1', 'c1', NOW - 10 * 60_000)
    const { scanner } = scannerFor([ws], { dispatch, markers })
    await scanner.scan()
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(markers.getHeld('w1', 'c1')).toBe(NOW)
    expect(scanner.snapshot()?.workspaces[0]?.tasks[0]?.nextDueAtMs).toBeGreaterThan(NOW)
    await scanner.scan()
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('does not mark when dispatch hits capacity (so it retries next tick)', async () => {
    const ws = await makeWs('w1', [{ id: 't1', title: 'i1', when: { kind: 'every', every: '30m' }, what: 'go' }])
    const dispatch = vi.fn(async () => {
      throw new Error('headless capacity reached')
    })
    const { scanner, markers } = scannerFor([ws], { dispatch })
    await scanner.scan()
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(markers.get('w1', 't1')).toBeUndefined()
  })

  it('skips an issue whose resolved adapter has no headless mode', async () => {
    const ws = await makeWs('w1', [{ id: 't1', title: 'i1', when: { kind: 'every', every: '30m' }, what: 'go' }])
    const { scanner, dispatch, markers } = scannerFor([ws], { adapter: nonHeadlessAdapter })
    await scanner.scan()
    expect(dispatch).not.toHaveBeenCalled()
    expect(markers.get('w1', 't1')).toBeUndefined()
  })

  it('ignores a workspace with no issues dir', async () => {
    const dir = join(root, 'empty')
    await mkdir(dir, { recursive: true })
    const ws: WorkspaceMeta = { id: 'empty', tag: 'empty', dir, createdAt: new Date(NOW).toISOString() }
    const { scanner, dispatch } = scannerFor([ws])
    await scanner.scan()
    expect(dispatch).not.toHaveBeenCalled()
    expect(scanner.snapshot()!.workspaces[0].status).toBe('absent')
  })

  it('marks a workspace invalid (loud hint) when only the legacy issue.json exists', async () => {
    const dir = join(root, 'legacy')
    await mkdir(join(dir, '.alice'), { recursive: true })
    await writeFile(join(dir, '.alice', 'issue.json'), JSON.stringify({ issues: [] }), 'utf8')
    const ws: WorkspaceMeta = { id: 'legacy', tag: 'legacy', dir, createdAt: new Date(NOW).toISOString() }
    const { scanner, dispatch } = scannerFor([ws])
    await scanner.scan()
    expect(dispatch).not.toHaveBeenCalled()
    const w = scanner.snapshot()!.workspaces[0]
    expect(w.status).toBe('invalid')
    expect(w.error).toContain('.alice/issue.json')
  })

  it('isolates a single invalid issue file: the workspace stays ok and good issues still fire', async () => {
    const ws = await makeWs('w1', [{ id: 'good', title: 'good', when: { kind: 'every', every: '30m' }, what: 'go' }])
    // Drop an unparseable file alongside the good one.
    await writeFile(join(ws.dir, '.alice', 'issues', 'broken.md'), '---\ntitle: : :\n  - x\n---\n', 'utf8')
    const { scanner, dispatch } = scannerFor([ws])
    await scanner.scan()
    expect(dispatch).toHaveBeenCalledTimes(1)
    const w = scanner.snapshot()!.workspaces[0]
    expect(w.status).toBe('ok')
    expect(w.tasks.map((t) => t.id)).toEqual(['good'])
  })

  it('caches a snapshot of scheduled issues (incl. terminal) after a scan', async () => {
    const ws = await makeWs('w1', [
      { id: 't1', title: 'i1', when: { kind: 'every', every: '30m' }, what: 'go' },
      { id: 't2', title: 'i2', when: { kind: 'every', every: '30m' }, what: 'stop', status: 'done' },
    ])
    const { scanner } = scannerFor([ws])
    expect(scanner.snapshot()).toBeNull() // cold before the first scan
    await scanner.scan()
    const snap = scanner.snapshot()
    expect(snap).not.toBeNull()
    expect(snap!.workspaces).toHaveLength(1)
    const w = snap!.workspaces[0]
    expect(w.status).toBe('ok')
    expect(w.tasks).toHaveLength(2)
    expect(w.tasks.find((t) => t.id === 't1')!.lastFiredAtMs).toBe(NOW) // t1 fired this scan
    expect(w.tasks.find((t) => t.id === 't1')!.nextDueAtMs).toBe(NOW + 30 * 60_000) // next cadence
    expect(w.tasks.find((t) => t.id === 't2')!.enabled).toBe(false) // done → never fires
    // never-fired `every` clamps next-due to now (due-now), never an epoch/1970 instant.
    expect(w.tasks.find((t) => t.id === 't2')!.nextDueAtMs).toBe(NOW)
  })

  it('prunes markers for issues no longer declared', async () => {
    const ws = await makeWs('w1', [{ id: 't1', title: 'i1', when: { kind: 'every', every: '30m' }, what: 'go' }])
    const markers = new FakeMarkers()
    await markers.set('w1', 'removed', 123)
    const { scanner } = scannerFor([ws], { markers })
    await scanner.scan()
    expect(markers.get('w1', 'removed')).toBeUndefined()
  })
})
