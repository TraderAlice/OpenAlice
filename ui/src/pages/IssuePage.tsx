import { Settings } from 'lucide-react'

import { PageHeader } from '../components/PageHeader'
import { IssuesBoard } from '../components/IssuesBoard'
import { useWorkspace } from '../tabs/store'

/**
 * Issues — the global, Linear-style board aggregating every workspace's issues
 * (`.alice/issues/<id>.md`). Read-only in Phase 1: scheduled issues (those with
 * a `when`) still fire headless runs via the scanner; unscheduled ones are
 * tracked work items. Creation/edit is a coding task inside the workspace, not
 * a route here.
 */
export function IssuePage() {
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title="Issues"
        description="Work tracked across every workspace — what each agent is doing, and what's scheduled to run."
        right={
          <button
            type="button"
            onClick={() => openOrFocus({ kind: 'settings', params: { category: 'issues' } })}
            title="Issue settings"
            aria-label="Issue settings"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-secondary text-muted transition-colors hover:border-accent/50 hover:text-text"
          >
            <Settings size={15} aria-hidden />
          </button>
        }
      />
      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-5">
        <IssuesBoard />
      </div>
    </div>
  )
}
