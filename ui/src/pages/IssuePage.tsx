import { PageHeader } from '../components/PageHeader'
import { IssuesBoard } from '../components/IssuesBoard'

/**
 * Issues — the global, Linear-style board aggregating every workspace's issues
 * (`.alice/issues/<id>.md`). Read-only in Phase 1: scheduled issues (those with
 * a `when`) still fire headless runs via the scanner; unscheduled ones are
 * tracked work items. Creation/edit is a coding task inside the workspace, not
 * a route here.
 */
export function IssuePage() {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title="Issues"
        description="Work tracked across every workspace — what each agent is doing, and what's scheduled to run."
      />
      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-5">
        <IssuesBoard />
      </div>
    </div>
  )
}
