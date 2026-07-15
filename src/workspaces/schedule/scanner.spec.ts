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
  pruned: Set<string> | null = null
  key(w: string, t: string): string {
    return `${w} ${t}`
  }
  get(w: string, t: string): number | undefined {
    return this.m.get(this.key(w, t))
  }
  async set(w: string, t: string, ts: number): Promise<void> {
    this.m.set(this.key(w, t), ts)
  }
  async prune(seen: Set<string>): Promise<void> {
    this.pruned = seen
    for (const k of [...this.m.keys()]) if (!seen.has(k)) this.m.delete(k)
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
  assignee?: string
  body?: string
}

/** Serialize one issue spec to its `.alice/issues/<id>.md` frontmatter form. */
function issueMd(spec: IssueSpec): string {
  const lines = [`title: ${spec.title}`]
  if (spec.status) lines.push(`status: ${spec.status}`)
  if (spec.priority) lines.push(`priority: ${spec.priority}`)
  if (spec.what) lines.push(`what: ${spec.what}`)
  if (spec.agent) lines.push(`agent: ${spec.agent}`)
  if (spec.assignee) lines.push(`assignee: ${JSON.stringify(spec.assignee)}`)
  if (spec.when) {
    const w = spec.when
    const inner =
      w.kind === 'at'
        ? `kind: at, at: "${w.at}"`
        : w.kind === 'every'
          ? `kind: every, every: "${w.every}"`
          : `kind: cron, cron: "${w.cron}"`
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
  return { id, tag: id, dir, createdAt: new Date(NOW).toISOString(), agents: ['claude'] }
}

function scannerFor(
  workspaces: WorkspaceMeta[],
  opts: {
    dispatch?: (
      m: WorkspaceMeta,
      a: CliAdapter,
      p: string,
      t: number,
      trigger?: import('../headless-task-registry.js').HeadlessTaskTrigger,
      resumeId?: string,
    ) => Promise<{ taskId: string }>
    markers?: MarkerStore
    now?: number
    adapter?: CliAdapter
    resolveAdapter?: ScheduleScannerDeps['resolveAdapter']
    resolveResumeWorkspace?: ScheduleScannerDeps['resolveResumeWorkspace']
  } = {},
) {
  const dispatch = opts.dispatch ?? vi.fn(async () => ({ taskId: 'run-1' }))
  const markers = opts.markers ?? new FakeMarkers()
  const scanner = new ScheduleScanner({
    registry: {
      list: () => workspaces,
      get: (id: string) => workspaces.find((workspace) => workspace.id === id),
    } as unknown as WorkspaceRegistry,
    resolveResumeWorkspace: opts.resolveResumeWorkspace ?? (() => workspaces[0]),
    resolveAdapter: opts.resolveAdapter ?? (() => opts.adapter ?? headlessAdapter),
    dispatch,
    markers,
    logger: noopLogger,
    now: () => opts.now ?? NOW,
  })
  return { scanner, dispatch, markers }
}

describe('ScheduleScanner', () => {
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
      30 * 60_000,
      { kind: 'issue', workspaceId: 'w1', issueId: 'retry-me' },
    )
    expect(markers.get('w1', 'retry-me')).toBeUndefined()
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
    expect(dispatch).toHaveBeenCalledWith(ws, headlessAdapter, 'go', expect.any(Number), {
      kind: 'issue', workspaceId: 'w1', issueId: 't1',
    })
    expect(markers.get('w1', 't1')).toBe(NOW)
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
      expect.any(Number),
      { kind: 'issue', workspaceId: 'w1', issueId: 'owned' },
      'resume-kind-owl-abc123',
    )
    expect(scanner.snapshot()!.workspaces[0].tasks[0].assignee)
      .toBe('@resume-kind-owl-abc123')
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
      expect.any(Number),
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
    expect(dispatch).toHaveBeenCalledWith(ws, headlessAdapter, 'go', expect.any(Number), {
      kind: 'issue', workspaceId: 'w1', issueId: 'sched',
    })
    expect(scanner.snapshot()!.workspaces[0].tasks.map((t) => t.id)).toEqual(['sched'])
  })

  it('sends the canonical markdown What without prepending the display title', async () => {
    const ws = await makeWs('w1', [
      { id: 't1', title: 'Do research', when: { kind: 'every', every: '30m' }, body: 'scan movers' },
    ])
    const { scanner, dispatch } = scannerFor([ws])
    await scanner.scan()
    expect(dispatch).toHaveBeenCalledWith(ws, headlessAdapter, 'scan movers', expect.any(Number), {
      kind: 'issue', workspaceId: 'w1', issueId: 't1',
    })
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
    const ws: WorkspaceMeta = { id: 'empty', tag: 'empty', dir, createdAt: new Date(NOW).toISOString(), agents: ['claude'] }
    const { scanner, dispatch } = scannerFor([ws])
    await scanner.scan()
    expect(dispatch).not.toHaveBeenCalled()
    expect(scanner.snapshot()!.workspaces[0].status).toBe('absent')
  })

  it('marks a workspace invalid (loud hint) when only the legacy issue.json exists', async () => {
    const dir = join(root, 'legacy')
    await mkdir(join(dir, '.alice'), { recursive: true })
    await writeFile(join(dir, '.alice', 'issue.json'), JSON.stringify({ issues: [] }), 'utf8')
    const ws: WorkspaceMeta = { id: 'legacy', tag: 'legacy', dir, createdAt: new Date(NOW).toISOString(), agents: ['claude'] }
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
