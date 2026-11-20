import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Schedule } from '../../core/schedule-expr.js'
import type { CliAdapter } from '../cli-adapter.js'
import type { Logger } from '../logger.js'
import type { WorkspaceMeta, WorkspaceRegistry } from '../workspace-registry.js'

import { SessionAdmissionError } from '../session-admission.js'
import { HeadlessCapacityError, HeadlessResumeError } from '../service.js'
import {
  BACKOFF_STEPS_MS,
  classifyScheduleSkip,
  ScheduleDispatchError,
  ScheduledIssueRunNowError,
  ScheduleScanner,
  type MarkerStore,
  type ScheduleScannerDeps,
} from './scanner.js'

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
    dispatch?: ScheduleScannerDeps['dispatch']
    logger?: Logger
    markers?: MarkerStore
    now?: number
    adapter?: CliAdapter
    resolveAdapter?: ScheduleScannerDeps['resolveAdapter']
    resolveResumeWorkspace?: ScheduleScannerDeps['resolveResumeWorkspace']
    claimFreshSession?: ScheduleScannerDeps['claimFreshSession']
    canRetryIssueRun?: ScheduleScannerDeps['canRetryIssueRun']
    isIssueRunning?: ScheduleScannerDeps['isIssueRunning']
    isSessionBlocked?: ScheduleScannerDeps['isSessionBlocked']
    observeIssues?: ScheduleScannerDeps['observeIssues']
    reconcileSessionRuntimeBindings?: ScheduleScannerDeps['reconcileSessionRuntimeBindings']
  } = {},
) {
  const dispatch = vi.fn(opts.dispatch ?? (async () => ({ taskId: 'run-1', resumeId: 'resume-new-worker-a1b2c3' })))
  const markers = opts.markers ?? new FakeMarkers()
  const scanner = new ScheduleScanner({
    canRetryIssueRun: opts.canRetryIssueRun,
    isIssueRunning: opts.isIssueRunning,
    isSessionBlocked: opts.isSessionBlocked,
    registry: {
      list: () => workspaces,
      get: (id: string) => workspaces.find((workspace) => workspace.id === id),
    } as unknown as WorkspaceRegistry,
    resolveResumeWorkspace: opts.resolveResumeWorkspace ?? (() => workspaces[0]),
    resolveAdapter: opts.resolveAdapter ?? (() => opts.adapter ?? headlessAdapter),
    dispatch,
    claimFreshSession: opts.claimFreshSession,
    observeIssues: opts.observeIssues,
    reconcileSessionRuntimeBindings: opts.reconcileSessionRuntimeBindings,
    markers,
    logger: opts.logger ?? noopLogger,
    now: () => opts.now ?? NOW,
  })
  return { scanner, dispatch, markers }
}

describe('ScheduleScanner', () => {
  it('runs Session dossier reconciliation on the infrastructure scan tick', async () => {
    const ws = await makeWs('w1', [])
    const reconcileSessionRuntimeBindings = vi.fn(async () => undefined)
    const { scanner } = scannerFor([ws], { reconcileSessionRuntimeBindings })

    await scanner.scan()

    expect(reconcileSessionRuntimeBindings).toHaveBeenCalledOnce()
  })

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
    expect(vi.mocked(dispatch).mock.calls[0]?.[5]).toEqual({
      kind: 'issue',
      workspaceId: 'w1',
      issueId: 'telegram-phone-desk',
      metadata: {
        kind: 'connector-cron-issue',
        connectorId: 'telegram',
      },
    })

    await scanner.runIssueNow('w1', 'telegram-phone-desk')
    expect(vi.mocked(dispatch).mock.calls[1]?.[5]).toEqual({
      kind: 'issue',
      workspaceId: 'w1',
      issueId: 'telegram-phone-desk',
      metadata: {
        kind: 'connector-cron-issue',
        connectorId: 'telegram',
      },
    })
  })

  it('rejects a manual run while an occurrence is still running', async () => {
    const ws = await makeWs('w1', [{ id: 'busy', title: 'Busy', when: { kind: 'every', every: '30m' } }])
    const { scanner, dispatch, markers } = scannerFor([ws], { isIssueRunning: () => true })
    await expect(scanner.runIssueNow('w1', 'busy')).rejects.toMatchObject({ code: 'already_running' })
    expect(dispatch).not.toHaveBeenCalled()
    expect(markers.get('w1', 'busy')).toBeUndefined()
  })

  it('revalidates retry lineage under the dispatch guard', async () => {
    const ws = await makeWs('w1', [{ id: 'daily', title: 'Daily', when: { kind: 'every', every: '30m' } }])
    const { scanner, dispatch } = scannerFor([ws], { canRetryIssueRun: () => false })
    await expect(scanner.runIssueNow('w1', 'daily', 'stale-run')).rejects.toMatchObject({ code: 'not_retryable' })
    expect(dispatch).not.toHaveBeenCalled()
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

    await expect(scanner.runIssueNow('w1', 'retry-me', 'run-failed')).resolves.toEqual({ taskId: 'run-1' })
    expect(dispatch).toHaveBeenCalledWith(
      ws,
      headlessAdapter,
      'same exact prompt', expect.objectContaining({ entry: expect.any(String), kind: expect.any(String) }),
      undefined,
      { kind: 'issue', workspaceId: 'w1', issueId: 'retry-me', retryOfTaskId: 'run-failed' },
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
      'go', expect.objectContaining({ entry: expect.any(String), kind: expect.any(String) }),
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
      'go', expect.objectContaining({ entry: expect.any(String), kind: expect.any(String) }),
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
      'go', expect.objectContaining({ entry: expect.any(String), kind: expect.any(String) }),
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
        fire: 'manual',
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

  it('surfaces real validation errors from runIssueNow for invalid issue files or declarations', async () => {
    const ws = await makeWs('w1', [])
    await mkdir(join(ws.dir, '.alice', 'issues'), { recursive: true })
    await writeFile(
      join(ws.dir, '.alice', 'issues', 'bad-issue.md'),
      '---\ntitle: Bad\nstatus: bogus_status\n---\nBody\n',
      'utf8',
    )
    const { scanner } = scannerFor([ws])
    await expect(scanner.runIssueNow('w1', 'bad-issue')).rejects.toMatchObject({
      code: 'invalid',
      message: expect.stringContaining('bad-issue'),
    })

    const legacyDir = join(root, 'w2-legacy')
    await mkdir(join(legacyDir, '.alice'), { recursive: true })
    await writeFile(join(legacyDir, '.alice', 'issue.json'), '{}', 'utf8')
    const legacyWs: WorkspaceMeta = { id: 'w2', tag: 'w2', dir: legacyDir, createdAt: new Date(NOW).toISOString() }
    const { scanner: legacyScanner } = scannerFor([legacyWs])
    await expect(legacyScanner.runIssueNow('w2', 'anything')).rejects.toMatchObject({
      code: 'invalid',
      message: expect.stringContaining('Issue declaration is invalid'),
    })
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
      'go', expect.objectContaining({ entry: expect.any(String), kind: expect.any(String) }),
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
      'go', expect.objectContaining({ entry: expect.any(String), kind: expect.any(String) }),
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
      'go', expect.objectContaining({ entry: expect.any(String), kind: expect.any(String) }),
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
      'continue', expect.objectContaining({ entry: expect.any(String), kind: expect.any(String) }),
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
      'own this work from now on', expect.objectContaining({ entry: expect.any(String), kind: expect.any(String) }),
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
      'revisit your report', expect.objectContaining({ entry: expect.any(String), kind: expect.any(String) }),
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
      'go', expect.objectContaining({ entry: expect.any(String), kind: expect.any(String) }),
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
      'scan movers', expect.objectContaining({ entry: expect.any(String), kind: expect.any(String) }),
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
      throw new HeadlessResumeError('busy', 'this conversation already has a running turn')
    })
    const { scanner, markers } = scannerFor([ws], { dispatch })
    await scanner.scan()
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(markers.get('w1', 'c1')).toBeUndefined()
    expect(markers.getHeld('w1', 'c1')).toBeTypeOf('number')
    expect(scanner.snapshot()?.workspaces[0]?.tasks[0]?.skipState).toBeUndefined()
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
      throw new HeadlessResumeError('busy', 'this conversation already has a running turn')
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
      throw new HeadlessCapacityError(8)
    })
    const { scanner, markers } = scannerFor([ws], { dispatch })
    await scanner.scan()
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(markers.get('w1', 't1')).toBeUndefined()
    expect(markers.getHeld('w1', 't1')).toBeUndefined()
    expect(scanner.snapshot()?.workspaces[0]?.tasks[0]?.skipState).toBeUndefined()
    await scanner.scan()
    expect(dispatch).toHaveBeenCalledTimes(2)
  })

  it('skips an issue whose resolved adapter has no headless mode', async () => {
    const ws = await makeWs('w1', [{ id: 't1', title: 'i1', when: { kind: 'every', every: '30m' }, what: 'go' }])
    const { scanner, dispatch, markers } = scannerFor([ws], { adapter: nonHeadlessAdapter })
    await scanner.scan()
    expect(dispatch).not.toHaveBeenCalled()
    expect(markers.get('w1', 't1')).toBeUndefined()
    expect(markers.getHeld('w1', 't1')).toBeUndefined()
    expect(scanner.snapshot()?.workspaces[0]?.tasks[0]?.skipState).toEqual({
      kind: 'parked',
      code: 'adapter_no_headless',
      reason: 'agent runtime does not support headless work: shell',
      sinceMs: NOW,
    })
  })

  describe('DispatchGate, skip classification, auto-recovery, and log deduplication', () => {
    it('classifies structured errors into retry_next_tick, defer, and park', () => {
      expect(classifyScheduleSkip(new HeadlessCapacityError(8), NOW)).toMatchObject({
        disposition: 'retry_next_tick',
        code: 'headless_capacity',
      })
      expect(classifyScheduleSkip(new HeadlessResumeError('busy', 'busy'), NOW)).toMatchObject({
        disposition: 'retry_next_tick',
        code: 'busy',
      })
      expect(classifyScheduleSkip(new HeadlessResumeError('takeover_declined', 'declined'), NOW)).toMatchObject({
        disposition: 'retry_next_tick',
        code: 'takeover_declined',
      })
      expect(classifyScheduleSkip(new ScheduledIssueRunNowError('already_running', 'running'), NOW)).toMatchObject({
        disposition: 'retry_next_tick',
        code: 'already_running',
      })
      expect(classifyScheduleSkip(new ScheduleDispatchError('dispatch_in_progress', 'in progress'), NOW)).toMatchObject({
        disposition: 'retry_next_tick',
        code: 'dispatch_in_progress',
      })

      const cooldown = new SessionAdmissionError([{
        id: 'b1', resumeId: 'resume-1', kind: 'user-cooldown', createdAt: NOW,
        expiresAt: NOW + 10 * 60_000, executionId: 'e1',
        actor: { kind: 'user', entry: 'control' },
        reason: 'User interrupted this Session; new starts are cooling down.',
      }])
      expect(classifyScheduleSkip(cooldown, NOW)).toEqual({
        disposition: 'defer',
        code: 'session_blocked',
        reason: 'User interrupted this Session; new starts are cooling down.',
        retryAtMs: NOW + 10 * 60_000,
        sessionBlocked: true,
      })

      // Past retryAt clamps to nowMs.
      const expiredCooldown = new SessionAdmissionError([{
        id: 'b1', resumeId: 'resume-1', kind: 'user-cooldown', createdAt: NOW - 10_000,
        expiresAt: NOW - 1_000, executionId: 'e1',
        actor: { kind: 'user', entry: 'control' },
        reason: 'cooling down',
      }])
      expect(classifyScheduleSkip(expiredCooldown, NOW)).toMatchObject({
        disposition: 'defer',
        code: 'session_blocked',
        retryAtMs: NOW,
        sessionBlocked: true,
      })

      const fault = new SessionAdmissionError([{
        id: 'b2', resumeId: 'resume-1', kind: 'execution-fault', createdAt: NOW,
        executionId: 'e2', actor: { kind: 'system', entry: 'session-failure-policy' },
        reason: 'Three consecutive executions failed.',
      }])
      expect(classifyScheduleSkip(fault, NOW)).toEqual({
        disposition: 'park',
        code: 'session_blocked',
        reason: 'Three consecutive executions failed.',
        sessionBlocked: true,
      })

      expect(classifyScheduleSkip(new HeadlessResumeError('not_ready', 'not ready'), NOW)).toEqual({
        disposition: 'defer',
        code: 'not_ready',
        reason: 'not ready',
        backoff: true,
      })
      expect(classifyScheduleSkip(new Error('unexpected failure'), NOW)).toEqual({
        disposition: 'defer',
        code: 'unknown_error',
        reason: 'unexpected failure',
        backoff: true,
      })

      for (const code of ['not_found', 'wrong_workspace', 'wrong_agent', 'retired', 'deleted'] as const) {
        expect(classifyScheduleSkip(new HeadlessResumeError(code, `resume ${code}`), NOW)).toEqual({
          disposition: 'park',
          code,
          reason: `resume ${code}`,
        })
      }

      for (const code of [
        'issue_not_found',
        'no_agent_owner',
        'assignee_workspace_unavailable',
        'adapter_no_headless',
        'workspace_not_active',
        'invalid_runtime_settings',
        'claim_persistence_unsupported',
      ] as const) {
        expect(classifyScheduleSkip(new ScheduleDispatchError(code, `err ${code}`), NOW)).toEqual({
          disposition: 'park',
          code,
          reason: `err ${code}`,
        })
      }
    })

    it('defers at and every schedules on user-cooldown without advancing markers or consuming at', async () => {
      const ws = await makeWs('w1', [
        { id: 'once', title: 'one-shot', when: { kind: 'at', at: new Date(NOW).toISOString() }, what: 'once', assignee: '@resume-1' },
        { id: 'six-hr', title: 'every 6h', when: { kind: 'every', every: '6h' }, what: 'go', assignee: '@resume-1' },
      ])
      const retryAt = NOW + 10 * 60_000
      let coolingDown = true
      const dispatch = vi.fn(async () => {
        if (coolingDown) {
          throw new SessionAdmissionError([{
            id: 'b-cool', resumeId: 'resume-1', kind: 'user-cooldown', createdAt: NOW,
            expiresAt: retryAt, executionId: 'e1',
            actor: { kind: 'user', entry: 'control' },
            reason: 'User interrupted this Session; new starts are cooling down.',
          }])
        }
        return { taskId: 'run-ok', resumeId: 'resume-1' }
      })
      const info = vi.fn()
      const logger = { ...noopLogger, info } as unknown as Logger
      const markers = new FakeMarkers()
      await markers.set('w1', 'six-hr', NOW - 6 * 60 * 60_000)
      const opts = {
        dispatch,
        markers,
        logger,
        now: NOW,
        isSessionBlocked: (_resumeId: string, nowMs: number) => coolingDown && nowMs < retryAt,
      }
      const { scanner } = scannerFor([ws], opts)
      const skipped = () => info.mock.calls.filter(([event]) => event === 'schedule.fire_skipped')

      await scanner.scan()
      expect(dispatch).toHaveBeenCalledTimes(2)
      // Schedule clock untouched: `at` is NOT consumed and `every: 6h` keeps its true lastFired.
      expect(markers.get('w1', 'once')).toBeUndefined()
      expect(markers.getHeld('w1', 'once')).toBeUndefined()
      expect(markers.get('w1', 'six-hr')).toBe(NOW - 6 * 60 * 60_000)
      expect(markers.getHeld('w1', 'six-hr')).toBeUndefined()
      expect(skipped()).toHaveLength(2)
      expect(skipped()[0]?.[1]).toMatchObject({
        disposition: 'defer',
        code: 'session_blocked',
        retryAtMs: retryAt,
      })
      expect(scanner.snapshot()!.workspaces[0].tasks.find((t) => t.id === 'once')?.skipState).toEqual({
        kind: 'deferred',
        code: 'session_blocked',
        reason: 'User interrupted this Session; new starts are cooling down.',
        retryAtMs: retryAt,
        sinceMs: NOW,
      })

      // Mid-cooldown: neither dispatches and no duplicate logs.
      opts.now = NOW + 5 * 60_000
      await scanner.scan()
      expect(dispatch).toHaveBeenCalledTimes(2)
      expect(skipped()).toHaveLength(2)

      // Cooldown expires at +10m: BOTH `at` and `every: 6h` fire immediately (not +6h10m!).
      coolingDown = false
      opts.now = retryAt
      await scanner.scan()
      expect(dispatch).toHaveBeenCalledTimes(4)
      expect(markers.get('w1', 'once')).toBe(retryAt)
      expect(markers.get('w1', 'six-hr')).toBe(retryAt)
      const snap = scanner.snapshot()!.workspaces[0]
      expect(snap.tasks.find((t) => t.id === 'once')?.skipState).toBeUndefined()
      expect(snap.tasks.find((t) => t.id === 'once')?.nextDueAtMs).toBeNull()
      expect(snap.tasks.find((t) => t.id === 'six-hr')?.skipState).toBeUndefined()
    })

    it('recovers a deferred cooldown gate early when isSessionBlocked flips to false', async () => {
      const ws = await makeWs('w1', [
        { id: 'cool', title: 'cooling', when: { kind: 'every', every: '1h' }, what: 'go', assignee: '@resume-1' },
      ])
      let blocked = true
      const dispatch = vi.fn(async () => {
        if (blocked) {
          throw new SessionAdmissionError([{
            id: 'b-cool', resumeId: 'resume-1', kind: 'user-cooldown', createdAt: NOW,
            expiresAt: NOW + 10 * 60_000, executionId: 'e1',
            actor: { kind: 'user', entry: 'control' },
            reason: 'Cooling down.',
          }])
        }
        return { taskId: 'run-ok', resumeId: 'resume-1' }
      })
      const opts = { dispatch, now: NOW, isSessionBlocked: () => blocked }
      const { scanner, markers } = scannerFor([ws], opts)

      await scanner.scan()
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(scanner.snapshot()!.workspaces[0].tasks[0].skipState?.kind).toBe('deferred')

      // User releases cooldown after only 2m (well before the 10m retryAtMs).
      blocked = false
      opts.now = NOW + 2 * 60_000
      await scanner.scan()
      expect(dispatch).toHaveBeenCalledTimes(2)
      expect(markers.get('w1', 'cool')).toBe(NOW + 2 * 60_000)
      expect(scanner.snapshot()!.workspaces[0].tasks[0].skipState).toBeUndefined()
    })

    it('parks execution-fault session blocks and auto-recovers when isSessionBlocked flips to false', async () => {
      const ws = await makeWs('w1', [
        { id: 'ev', title: 'blocked every', when: { kind: 'every', every: '5m' }, what: 'go', assignee: '@resume-1' },
      ])
      let blocked = true
      const dispatch = vi.fn(async () => {
        if (blocked) {
          throw new SessionAdmissionError([{
            id: 'b1', resumeId: 'resume-1', kind: 'execution-fault', createdAt: NOW - 1000,
            executionId: 'e1', actor: { kind: 'system', entry: 'session-failure-policy' },
            reason: 'Three consecutive executions failed.',
          }])
        }
        return { taskId: 'run-recovered', resumeId: 'resume-1' }
      })
      const info = vi.fn()
      const logger = { ...noopLogger, info } as unknown as Logger
      const opts = { dispatch, logger, now: NOW, isSessionBlocked: () => blocked }
      const { scanner, markers } = scannerFor([ws], opts)
      const skipped = () => info.mock.calls.filter(([event]) => event === 'schedule.fire_skipped')

      await scanner.scan()
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(markers.get('w1', 'ev')).toBeUndefined()
      expect(markers.getHeld('w1', 'ev')).toBeUndefined()
      expect(skipped()).toHaveLength(1)
      expect(skipped()[0]?.[1]).toEqual({
        wsId: 'w1',
        taskId: 'ev',
        disposition: 'park',
        code: 'session_blocked',
        reason: 'Three consecutive executions failed.',
      })
      expect(scanner.snapshot()!.workspaces[0].tasks[0].skipState).toEqual({
        kind: 'parked',
        code: 'session_blocked',
        reason: 'Three consecutive executions failed.',
        sinceMs: NOW,
      })

      // Even hours later while blocked, it remains parked with zero extra dispatch attempts or logs.
      opts.now = NOW + 2 * 60 * 60_000
      await scanner.scan()
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(skipped()).toHaveLength(1)

      // Block released -> auto-recovers on next tick.
      blocked = false
      opts.now = NOW + 2 * 60 * 60_000 + 60_000
      await scanner.scan()
      expect(dispatch).toHaveBeenCalledTimes(2)
      expect(markers.get('w1', 'ev')).toBe(NOW + 2 * 60 * 60_000 + 60_000)
      expect(scanner.snapshot()!.workspaces[0].tasks[0].skipState).toBeUndefined()
    })

    it('applies capped exponential backoff (1m -> 5m -> 15m -> 60m cap) for not_ready and unknown errors and dedupes logs', async () => {
      const ws = await makeWs('w1', [
        { id: 'flaky', title: 'flaky', when: { kind: 'every', every: '1m' }, what: 'go', assignee: '@resume-1' },
      ])
      let failWith: Error | null = new HeadlessResumeError('not_ready', 'Session is not eligible for background takeover')
      const dispatch = vi.fn(async () => {
        if (failWith) throw failWith
        return { taskId: 'run-ok', resumeId: 'resume-1' }
      })
      const info = vi.fn()
      const logger = { ...noopLogger, info } as unknown as Logger
      const opts = { dispatch, logger, now: NOW }
      const { scanner, markers } = scannerFor([ws], opts)
      const skipped = () => info.mock.calls.filter(([event]) => event === 'schedule.fire_skipped')

      // Attempt 1 -> 1m backoff
      await scanner.scan()
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(markers.getHeld('w1', 'flaky')).toBeUndefined()
      expect(skipped()).toHaveLength(1)
      expect(skipped()[0]?.[1]).toMatchObject({
        disposition: 'defer',
        code: 'not_ready',
        retryAtMs: NOW + BACKOFF_STEPS_MS[0],
      })
      expect(scanner.snapshot()!.workspaces[0].tasks[0].skipState).toEqual({
        kind: 'deferred',
        code: 'not_ready',
        reason: 'Session is not eligible for background takeover',
        retryAtMs: NOW + BACKOFF_STEPS_MS[0],
        sinceMs: NOW,
      })

      // Before 1m -> gated
      opts.now = NOW + 30_000
      await scanner.scan()
      expect(dispatch).toHaveBeenCalledTimes(1)

      // Walk through 5m -> 15m -> 60m -> 60m cap
      let cursor = NOW + BACKOFF_STEPS_MS[0]
      for (const expectedDelay of [BACKOFF_STEPS_MS[1], BACKOFF_STEPS_MS[2], BACKOFF_STEPS_MS[3], BACKOFF_STEPS_MS[3]]) {
        opts.now = cursor
        await scanner.scan()
        expect(scanner.snapshot()!.workspaces[0].tasks[0].skipState).toEqual({
          kind: 'deferred',
          code: 'not_ready',
          reason: 'Session is not eligible for background takeover',
          retryAtMs: cursor + expectedDelay,
          sinceMs: NOW,
        })
        cursor += expectedDelay
      }
      expect(dispatch).toHaveBeenCalledTimes(5)
      // Same (disposition, code, reason) -> logged only once across the entire backoff ladder!
      expect(skipped()).toHaveLength(1)

      // Changing to an unknown error logs once and restarts its own backoff streak from 1m.
      failWith = new Error('transient socket reset')
      opts.now = cursor
      await scanner.scan()
      expect(dispatch).toHaveBeenCalledTimes(6)
      expect(skipped()).toHaveLength(2)
      expect(skipped()[1]?.[1]).toMatchObject({
        disposition: 'defer',
        code: 'unknown_error',
        reason: 'transient socket reset',
        retryAtMs: cursor + BACKOFF_STEPS_MS[0],
      })

      // Recovery on next retry clears gate and re-arms logging.
      failWith = null
      opts.now = cursor + BACKOFF_STEPS_MS[0]
      await scanner.scan()
      expect(dispatch).toHaveBeenCalledTimes(7)
      expect(markers.get('w1', 'flaky')).toBe(cursor + BACKOFF_STEPS_MS[0])
      expect(scanner.snapshot()!.workspaces[0].tasks[0].skipState).toBeUndefined()
    })

    it('parks structural errors and auto-recovers when Issue fields change', async () => {
      const ws = await makeWs('w1', [
        { id: 'orphan', title: 'orphaned', when: { kind: 'every', every: '30m' }, what: 'go', assignee: '@resume-missing-ws' },
      ])
      const info = vi.fn()
      const logger = { ...noopLogger, info } as unknown as Logger
      const opts = { logger, resolveResumeWorkspace: () => undefined, now: NOW }
      const { scanner, dispatch, markers } = scannerFor([ws], opts)
      const skipped = () => info.mock.calls.filter(([event]) => event === 'schedule.fire_skipped')

      await scanner.scan()
      expect(dispatch).not.toHaveBeenCalled()
      expect(markers.get('w1', 'orphan')).toBeUndefined()
      expect(markers.getHeld('w1', 'orphan')).toBeUndefined()
      expect(skipped()).toHaveLength(1)
      expect(skipped()[0]?.[1]).toEqual({
        wsId: 'w1',
        taskId: 'orphan',
        disposition: 'park',
        code: 'assignee_workspace_unavailable',
        reason: 'assigned Session Workspace is unavailable: resume-missing-ws',
      })
      expect(scanner.snapshot()!.workspaces[0].tasks[0].skipState).toEqual({
        kind: 'parked',
        code: 'assignee_workspace_unavailable',
        reason: 'assigned Session Workspace is unavailable: resume-missing-ws',
        sinceMs: NOW,
      })

      // Still parked on later ticks.
      opts.now = NOW + 60 * 60_000
      await scanner.scan()
      expect(dispatch).not.toHaveBeenCalled()
      expect(skipped()).toHaveLength(1)

      // User fixes the Issue's assignee -> fingerprint changes -> gate clears and fires immediately.
      await writeFile(
        join(ws.dir, '.alice', 'issues', 'orphan.md'),
        issueMd({ id: 'orphan', title: 'orphaned', when: { kind: 'every', every: '30m' }, what: 'go', assignee: '@new-each-run' }),
        'utf8',
      )
      opts.now = NOW + 61 * 60_000
      await scanner.scan()
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(markers.get('w1', 'orphan')).toBe(NOW + 61 * 60_000)
      expect(scanner.snapshot()!.workspaces[0].tasks[0].skipState).toBeUndefined()
    })

    it('clears a parked gate when manual runIssueNow succeeds and updates the cached snapshot', async () => {
      const ws = await makeWs('w1', [
        { id: 'paused', title: 'paused', when: { kind: 'every', every: '30m' }, what: 'go' },
      ])
      let active = false
      const dispatch = vi.fn(async () => {
        if (!active) throw new ScheduleDispatchError('workspace_not_active', 'workspace is not active: w1')
        return { taskId: 'run-manual', resumeId: 'resume-1' }
      })
      const opts = { dispatch, now: NOW }
      const { scanner } = scannerFor([ws], opts)

      await scanner.scan()
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(scanner.snapshot()!.workspaces[0].tasks[0].skipState?.kind).toBe('parked')

      // Workspace becomes active and operator triggers manual run.
      active = true
      await scanner.runIssueNow('w1', 'paused')
      expect(dispatch).toHaveBeenCalledTimes(2)
      // Cached snapshot immediately clears skipState without waiting for the next scan.
      expect(scanner.snapshot()!.workspaces[0].tasks[0].skipState).toBeUndefined()

      // Next scheduled scan fires cleanly.
      opts.now = NOW + 60_000
      await scanner.scan()
      expect(dispatch).toHaveBeenCalledTimes(3)
    })

    it('prunes dispatch gates and log dedup state when an Issue disappears or becomes terminal', async () => {
      const ws = await makeWs('w1', [
        { id: 'vanish', title: 'vanish', when: { kind: 'every', every: '30m' }, what: 'go' },
      ])
      const info = vi.fn()
      const logger = { ...noopLogger, info } as unknown as Logger
      const dispatch = vi.fn(async () => {
        throw new ScheduleDispatchError('workspace_not_active', 'workspace is not active: w1')
      })
      const opts = { dispatch, logger, now: NOW }
      const { scanner } = scannerFor([ws], opts)
      const skipped = () => info.mock.calls.filter(([event]) => event === 'schedule.fire_skipped')

      await scanner.scan()
      expect(skipped()).toHaveLength(1)
      expect(scanner.snapshot()!.workspaces[0].tasks[0].skipState?.kind).toBe('parked')

      // Mark terminal -> clears skipState.
      await writeFile(
        join(ws.dir, '.alice', 'issues', 'vanish.md'),
        issueMd({ id: 'vanish', title: 'vanish', when: { kind: 'every', every: '30m' }, what: 'go', status: 'done' }),
        'utf8',
      )
      await scanner.scan()
      expect(scanner.snapshot()!.workspaces[0].tasks[0].skipState).toBeUndefined()

      // Remove issue file -> pruned; re-adding logs again cleanly.
      await rm(join(ws.dir, '.alice', 'issues', 'vanish.md'))
      await scanner.scan()

      await writeFile(
        join(ws.dir, '.alice', 'issues', 'vanish.md'),
        issueMd({ id: 'vanish', title: 'vanish', when: { kind: 'every', every: '30m' }, what: 'go' }),
        'utf8',
      )
      await scanner.scan()
      expect(skipped()).toHaveLength(2)
    })

    it('reconciles skipState on scan(false) whether async fire settles before or after snapshot publish', async () => {
      const ws1 = await makeWs('w1', [
        { id: 'fast-fail', title: 'fast fail', when: { kind: 'every', every: '30m' }, what: 'go', assignee: '@resume-1' },
        { id: 'slow-fail', title: 'slow fail', when: { kind: 'every', every: '30m' }, what: 'go', assignee: '@resume-2' },
      ])
      let rejectSlow!: (err: Error) => void
      const slowPromise = new Promise<{ taskId: string; resumeId: string }>((_, reject) => {
        rejectSlow = reject
      })
      const dispatch = vi.fn(async (_ws, _adapter, _prompt, _origin, _timeout, trigger) => {
        if (trigger?.kind === 'issue' && trigger.issueId === 'fast-fail') {
          throw new ScheduleDispatchError('workspace_not_active', 'workspace is not active: w1')
        }
        return slowPromise
      })
      const { scanner } = scannerFor([ws1], { dispatch, now: NOW })

      // First scan (cold lastSnapshot === null) in non-blocking tick mode:
      // fast-fail settles BEFORE scan(false) assigns lastSnapshot; slow-fail settles AFTER.
      await scanner.scan(false)
      expect(scanner.snapshot()?.workspaces[0]?.tasks.find((t) => t.id === 'fast-fail')?.skipState).toEqual({
        kind: 'parked',
        code: 'workspace_not_active',
        reason: 'workspace is not active: w1',
        sinceMs: NOW,
      })

      rejectSlow(new SessionAdmissionError([{
        id: 'b-slow', resumeId: 'resume-2', kind: 'user-cooldown', createdAt: NOW,
        expiresAt: NOW + 10 * 60_000, executionId: 'e-slow',
        actor: { kind: 'user', entry: 'control' },
        reason: 'Cooling down.',
      }]))
      await scanner.waitForDispatches()
      expect(scanner.snapshot()?.workspaces[0]?.tasks.find((t) => t.id === 'slow-fail')?.skipState).toEqual({
        kind: 'deferred',
        code: 'session_blocked',
        reason: 'Cooling down.',
        retryAtMs: NOW + 10 * 60_000,
        sinceMs: NOW,
      })
    })
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

describe('comment owner handoff', () => {
  it('uses the Issue runtime, claims once, and preserves the schedule marker', async () => {
    const spec: IssueSpec = { id: 'desk', title: 'Desk', when: { kind: 'every', every: '4h' },
      assignee: '@new-then-resume', agent: 'codex', credentialSource: 'native', model: 'gpt-5.6-sol', effort: 'medium' }
    const ws = await makeWs('w1', [spec])
    const claimFreshSession = vi.fn(async ({ resumeId }: { resumeId: string }) => {
      await writeFile(join(ws.dir, '.alice/issues/desk.md'), issueMd({ ...spec, assignee: '@' + resumeId, agent: undefined, credentialSource: undefined, model: undefined, effort: undefined }))
    })
    const { scanner, dispatch, markers } = scannerFor([ws], { claimFreshSession })
    await scanner.runIssueComment({ workspaceId: 'w1', issueId: 'desk', prompt: 'Hello', commentId: 'c1' })
    const first = dispatch.mock.calls[0]
    expect(first[5]).toBeUndefined() // never a cron turn: no no-reply suppression
    expect(first[6]).toBeUndefined()
    expect(first[7]).toMatchObject({ subject: { relation: 'owner', commentId: 'c1' } })
    expect(first[8]).toMatchObject({ credentialSource: 'native', model: 'gpt-5.6-sol', reasoningEffort: 'medium' })
    expect(first[10]).toMatchObject({ kind: 'issue', fire: 'comment', policy: 'new-then-resume' })
    expect(claimFreshSession).toHaveBeenCalledTimes(1)
    expect(markers.get('w1', 'desk')).toBeUndefined()
    await scanner.runIssueComment({ workspaceId: 'w1', issueId: 'desk', prompt: 'Again', commentId: 'c2' })
    expect(dispatch.mock.calls[1][6]).toBe('resume-new-worker-a1b2c3')
    expect(claimFreshSession).toHaveBeenCalledTimes(1)
  })

  it('excludes a scheduled fire while the comment is creating the owner', async () => {
    const ws = await makeWs('w1', [{ id: 'desk', title: 'Desk', when: { kind: 'every', every: '4h' }, assignee: '@new-then-resume' }])
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const held = new Promise<void>((resolve) => { release = resolve })
    const dispatch = vi.fn(async () => { entered(); await held; return { taskId: 'run-1', resumeId: 'resume-new' } })
    const { scanner, markers } = scannerFor([ws], { dispatch, claimFreshSession: async () => undefined })
    const comment = scanner.runIssueComment({ workspaceId: 'w1', issueId: 'desk', prompt: 'Hello', commentId: 'c1' })
    await started
    await scanner.scan()
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(markers.get('w1', 'desk')).toBeUndefined()
    release()
    await comment
  })
})

it('keeps ticking and dispatching other Issues while one admission awaits approval', async () => {
  const ws = await makeWs('approval', [
    { id: 'a', title: 'Waiting', when: { kind: 'every', every: '1m' }, what: 'A' },
    { id: 'b', title: 'Independent', when: { kind: 'every', every: '1m' }, what: 'B' },
  ])
  let approve!: (value: { taskId: string; resumeId: string }) => void
  const gate = new Promise<{ taskId: string; resumeId: string }>(resolve => { approve = resolve })
  const { scanner, dispatch, markers } = scannerFor([ws], {
    dispatch: async (_ws, _adapter, _prompt, _origin, _timeout, trigger) => trigger?.kind === 'issue' && trigger.issueId === 'a' ? gate : { taskId: 'independent', resumeId: 'independent' },
  })
  await scanner.scan(false)
  await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2))
  await vi.waitFor(() => expect(markers.get(ws.id, 'b')).toBe(NOW))
  await scanner.scan(false)
  expect(dispatch).toHaveBeenCalledTimes(2)
  approve({ taskId: 'approved', resumeId: 'approved' })
  await scanner.waitForDispatches()
  expect(markers.get(ws.id, 'a')).toBe(NOW)
})
