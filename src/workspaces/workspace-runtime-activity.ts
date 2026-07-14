import type { ChildProcess } from 'node:child_process'

export interface WorkspaceInteractiveActivity {
  readonly sessionId: string
  readonly resumeId: string
  readonly name: string
  readonly agent: string
  readonly surface: 'terminal' | 'webpi'
  readonly startedAt: number | null
}

export interface WorkspaceHeadlessActivity {
  readonly taskId: string | null
  readonly agent: string
  readonly startedAt: number
}

/** Exact runtime work that must stop before shared Workspace instructions move. */
export interface WorkspaceRuntimeActivity {
  readonly busy: boolean
  readonly sessions: readonly WorkspaceInteractiveActivity[]
  readonly headless: readonly WorkspaceHeadlessActivity[]
}

interface TrackedHeadlessActivity extends WorkspaceHeadlessActivity {
  readonly token: symbol
  child?: ChildProcess
}

export interface WorkspaceHeadlessActivityLease {
  /** Attach the actual child so an exited process cannot leave a zombie blocker. */
  attach(child: ChildProcess): void
  release(): void
}

/**
 * In-memory liveness for both recorded automation runs and synchronous
 * `wait:true` calls.
 *
 * A plain per-Workspace counter can become permanently non-zero when the
 * child exits but a surrounding promise fails to settle. Keeping the child
 * handle lets every read prune that impossible state from process evidence.
 * The registry remains the durable history; this tracker answers only "is
 * something executing right now?".
 */
export class WorkspaceHeadlessActivityTracker {
  private readonly byWorkspace = new Map<string, Map<symbol, TrackedHeadlessActivity>>()

  begin(input: {
    readonly workspaceId: string
    readonly agent: string
    readonly taskId?: string
    readonly startedAt?: number
  }): WorkspaceHeadlessActivityLease {
    const token = Symbol(input.taskId ?? `${input.agent}-headless`)
    const activity: TrackedHeadlessActivity = {
      token,
      taskId: input.taskId ?? null,
      agent: input.agent,
      startedAt: input.startedAt ?? Date.now(),
    }
    let entries = this.byWorkspace.get(input.workspaceId)
    if (!entries) {
      entries = new Map()
      this.byWorkspace.set(input.workspaceId, entries)
    }
    entries.set(token, activity)
    let released = false
    return {
      attach: (child) => {
        if (!released) activity.child = child
      },
      release: () => {
        if (released) return
        released = true
        this.remove(input.workspaceId, token)
      },
    }
  }

  list(workspaceId: string): WorkspaceHeadlessActivity[] {
    const entries = this.byWorkspace.get(workspaceId)
    if (!entries) return []
    for (const [token, activity] of entries) {
      if (activity.child && processHasExited(activity.child)) this.remove(workspaceId, token)
    }
    const live = this.byWorkspace.get(workspaceId)
    return live
      ? [...live.values()].map(({ taskId, agent, startedAt }) => ({ taskId, agent, startedAt }))
      : []
  }

  has(workspaceId: string): boolean {
    return this.list(workspaceId).length > 0
  }

  private remove(workspaceId: string, token: symbol): void {
    const entries = this.byWorkspace.get(workspaceId)
    if (!entries) return
    entries.delete(token)
    if (entries.size === 0) this.byWorkspace.delete(workspaceId)
  }
}

function processHasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}
