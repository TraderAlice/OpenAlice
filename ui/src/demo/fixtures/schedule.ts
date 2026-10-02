import type { ScheduleSnapshot } from '../../api/schedule'
import { demoIssueDetail, demoIssuesSnapshot } from './issues'

/** Same issue declarations as the board/detail; cadence edits must not leave a
 * second stale schedule definition in the demo. */
export function demoScheduleSnapshot(): ScheduleSnapshot {
  return {
    workspaces: demoIssuesSnapshot.workspaces.map((workspace) => ({
      wsId: workspace.wsId,
      tag: workspace.tag,
      status: workspace.status,
      tasks: workspace.issues.flatMap((issue) => issue.when ? [{
        id: issue.id,
        issue: issue.title,
        when: issue.when,
        what: demoIssueDetail(workspace.wsId, issue.id)?.issue.what ?? issue.title,
        assignee: issue.assignee,
        agent: issue.agent,
        credential: issue.credential,
        model: issue.model,
        effort: issue.effort,
        timeout: issue.timeout,
        enabled: issue.status !== 'done' && issue.status !== 'canceled',
        lastFiredAtMs: issue.lastFiredAtMs ?? null,
        nextDueAtMs: issue.nextDueAtMs ?? null,
      }] : []),
    })),
  }
}
