/**
 * Bridges scheduled headless run completion back into the issue board state.
 *
 * The scheduler intentionally only knows how to FIRE due issues; it does not
 * wait for an agent process to finish. This helper runs at the later headless
 * completion boundary and applies the only automatic state transition we want:
 * a one-shot (`when.kind: at`) issue becomes `done` after its owning run exits
 * cleanly. Repeating schedules keep their status, and failed/interrupted runs
 * stay visible for human inspection.
 */

import type { HeadlessTaskStatus } from '../headless-task-registry.js'
import { isTerminalStatus, readWorkspaceIssues, type IssueStatus } from './declaration.js'
import { updateIssueFields } from './mutate.js'

export interface OneShotIssueCompletionInput {
  wsDir: string
  /** Present only for headless runs fired by ScheduleScanner. */
  issueId?: string
  status: HeadlessTaskStatus
  exitCode?: number | null
  killed?: boolean
}

export type OneShotIssueCompletionResult =
  | { updated: true; issueId: string; previousStatus: IssueStatus }
  | {
      updated: false
      reason:
        | 'not_issue_run'
        | 'not_success'
        | 'issues_unavailable'
        | 'not_found'
        | 'not_one_shot'
        | 'terminal'
        | 'mutation_failed'
      issueId?: string
      status?: IssueStatus
      error?: string
    }

export async function completeOneShotIssueAfterRun(
  input: OneShotIssueCompletionInput,
): Promise<OneShotIssueCompletionResult> {
  const issueId = input.issueId?.trim()
  if (!issueId) return { updated: false, reason: 'not_issue_run' }
  if (input.status !== 'done' || input.exitCode !== 0 || input.killed === true) {
    return { updated: false, reason: 'not_success', issueId }
  }

  const res = await readWorkspaceIssues(input.wsDir)
  if (!res.ok) {
    return {
      updated: false,
      reason: 'issues_unavailable',
      issueId,
      ...(res.reason === 'invalid' ? { error: res.error } : {}),
    }
  }

  const issue = res.issues.find((i) => i.id === issueId)
  if (!issue) return { updated: false, reason: 'not_found', issueId }
  if (issue.when?.kind !== 'at') return { updated: false, reason: 'not_one_shot', issueId }
  if (isTerminalStatus(issue.status)) {
    return { updated: false, reason: 'terminal', issueId, status: issue.status }
  }

  const updated = await updateIssueFields(input.wsDir, issueId, { status: 'done' })
  if (!updated.ok) {
    return {
      updated: false,
      reason: 'mutation_failed',
      issueId,
      error: updated.reason === 'invalid' ? updated.error : updated.reason,
    }
  }
  return { updated: true, issueId, previousStatus: issue.status }
}
