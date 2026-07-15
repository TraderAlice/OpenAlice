import type { HeadlessTaskStatus } from '../headless-task-registry.js'
import type { IssueStatus } from './declaration.js'
import type { IssueRunFailure } from './run-failure.js'

/** Operational state of a scheduled Issue. This is a live projection, never a
 * field persisted into the agent-editable markdown file: workflow status says
 * whether the work item is open, while automation health says whether its
 * scheduler/worker path can currently fulfill it. */
export type IssueAutomationHealthState =
  | 'inactive'
  | 'not_started'
  | 'due'
  | 'running'
  | 'healthy'
  | 'interrupted'
  | 'failed'
  | 'blocked'

export interface IssueAutomationHealth {
  state: IssueAutomationHealthState
  message: string
  /** Latest scheduled execution, when one exists. Useful to jump from a health
   * warning to the authoritative run log without guessing from timestamps. */
  latestTaskId?: string
}

export type IssueAutomationOwnerState = 'workspace' | 'ready' | 'missing' | 'retired' | 'unbound'

export interface IssueAutomationHealthInput {
  status: IssueStatus
  nowMs: number
  nextDueAtMs: number | null
  ownerState: IssueAutomationOwnerState
  latestRun?: { taskId: string; status: HeadlessTaskStatus; failure?: IssueRunFailure }
}

/** Derive one scheduler-health answer from authoritative stores. Ordering is
 * intentional: an in-flight run is allowed to finish even if its Session is
 * retired concurrently; after that run finishes, the retired owner blocks the
 * next dispatch. A past failure remains visible until a later successful run. */
export function issueAutomationHealth(input: IssueAutomationHealthInput): IssueAutomationHealth {
  const latest = input.latestRun
  const withLatest = (health: IssueAutomationHealth): IssueAutomationHealth =>
    latest ? { ...health, latestTaskId: latest.taskId } : health

  if (input.status === 'done' || input.status === 'canceled') {
    return withLatest({ state: 'inactive', message: `Schedule stopped because the Issue is ${input.status}.` })
  }
  if (latest?.status === 'running') {
    return { state: 'running', message: 'A scheduled run is in progress.', latestTaskId: latest.taskId }
  }
  if (input.ownerState === 'missing') {
    return withLatest({ state: 'blocked', message: 'Assigned Session does not exist. Choose an active Session or @workspace.' })
  }
  if (input.ownerState === 'retired') {
    return withLatest({ state: 'blocked', message: 'Assigned Session is retired. Reassign the Issue before its next run.' })
  }
  if (input.ownerState === 'unbound') {
    return withLatest({ state: 'blocked', message: 'Assigned Session has no resumable runtime conversation yet.' })
  }
  if (latest?.status === 'interrupted' || latest?.failure?.kind === 'system_paused') {
    return {
      state: 'interrupted',
      message: latest.failure?.message ?? 'OpenAlice stopped while the latest scheduled run was active. It was not automatically retried.',
      latestTaskId: latest.taskId,
    }
  }
  if (latest?.status === 'failed') {
    return {
      state: 'failed',
      message: latest.failure?.message ?? 'Latest scheduled run failed. Inspect its Runs entry, then retry when ready.',
      latestTaskId: latest.taskId,
    }
  }
  if (input.nextDueAtMs === null) {
    return withLatest({ state: 'blocked', message: 'Schedule has no future fire. Check its expression and timestamp.' })
  }
  if (input.nextDueAtMs !== null && input.nextDueAtMs <= input.nowMs) {
    return withLatest({ state: 'due', message: 'The schedule is due and waiting to dispatch.' })
  }
  if (latest?.status === 'done') {
    return { state: 'healthy', message: 'Latest scheduled run completed.', latestTaskId: latest.taskId }
  }
  return { state: 'not_started', message: 'Schedule is valid and has not run yet.' }
}
