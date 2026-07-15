import type { HeadlessTaskRecord } from '../headless-task-registry.js'

/** Scheduled Issue runs share one watchdog budget. Keeping the value here lets
 * dispatch and the read-side failure projection explain the same deadline. */
export const SCHEDULED_ISSUE_RUN_TIMEOUT_MS = 30 * 60_000

/** A watchdog that fires this far after its own deadline did not merely time
 * out: the launcher's event loop was paused (most commonly system sleep). */
export const SCHEDULED_ISSUE_WATCHDOG_LATE_GRACE_MS = 60_000

export type IssueRunFailureKind =
  | 'system_paused'
  | 'launcher_restarted'
  | 'timeout'
  | 'launch_error'
  | 'process_exit'
  | 'runtime_error'

/** Read-side explanation derived from the durable execution record. It is not
 * persisted, so old runs immediately gain better diagnostics without a data
 * migration and the inference can evolve independently of registry format. */
export interface IssueRunFailure {
  kind: IssueRunFailureKind
  title: string
  message: string
  retryable: boolean
}

function compactDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  if (minutes === 0) return `${seconds}s`
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`
}

/** Explain why a scheduled Issue run did not complete. The classification is
 * deliberately conservative: an overdue watchdog says the system/launcher was
 * paused, not that sleep is proven; SIGKILL near the deadline is a real timeout. */
export function issueRunFailure(
  task: Pick<
    HeadlessTaskRecord,
    'status' | 'durationMs' | 'exitCode' | 'signal' | 'killed' | 'error'
  >,
  timeoutMs = SCHEDULED_ISSUE_RUN_TIMEOUT_MS,
): IssueRunFailure | undefined {
  if (task.status === 'running' || task.status === 'done') return undefined

  if (task.status === 'interrupted') {
    return {
      kind: 'launcher_restarted',
      title: 'Launcher restarted',
      message: 'OpenAlice stopped while this run was active. It was not automatically retried.',
      retryable: true,
    }
  }

  if (task.killed) {
    const durationMs = task.durationMs ?? timeoutMs
    const lateByMs = durationMs - timeoutMs
    if (lateByMs >= SCHEDULED_ISSUE_WATCHDOG_LATE_GRACE_MS) {
      return {
        kind: 'system_paused',
        title: 'Computer or launcher was paused',
        message: `The ${compactDuration(timeoutMs)} watchdog ran ${compactDuration(lateByMs)} late. The computer likely slept or OpenAlice was paused; this run was not automatically retried.`,
        retryable: true,
      }
    }
    return {
      kind: 'timeout',
      title: 'Run timed out',
      message: `The agent did not finish within the ${compactDuration(timeoutMs)} execution limit.`,
      retryable: true,
    }
  }

  if (task.error) {
    return {
      kind: 'launch_error',
      title: 'Agent could not start',
      message: task.error,
      retryable: true,
    }
  }

  if (task.signal || (task.exitCode !== undefined && task.exitCode !== null && task.exitCode !== 0)) {
    const detail = task.signal
      ? `signal ${task.signal}`
      : `exit code ${task.exitCode}`
    return {
      kind: 'process_exit',
      title: 'Agent process exited',
      message: `The agent process ended with ${detail} before completing the work.`,
      retryable: true,
    }
  }

  return {
    kind: 'runtime_error',
    title: 'Agent reported an error',
    message: 'The agent runtime ended without a successful final response. Inspect the run output, then retry when ready.',
    retryable: true,
  }
}
