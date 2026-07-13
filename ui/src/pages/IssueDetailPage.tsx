import { IssueDetail } from '../components/IssueDetail'
import type { ViewSpec } from '../tabs/types'

/**
 * Read-only issue detail surface (Phase 2a). Opened by clicking a board row;
 * routed as `/issues/:wsId/:id`. The detail itself (title + markdown body +
 * Activity feed + Properties rail) lives in `IssueDetail`; this page just
 * provides the scroll container.
 */
export function IssueDetailPage({ spec }: { spec: Extract<ViewSpec, { kind: 'issue-detail' }> }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <IssueDetail wsId={spec.params.wsId} id={spec.params.id} />
      </div>
    </div>
  )
}
