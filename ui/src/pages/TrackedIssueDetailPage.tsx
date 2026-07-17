import { useCallback } from 'react'

import { IssueDetail } from '../components/IssueDetail'
import { useWorkspace } from '../tabs/store'
import type { ViewSpec } from '../tabs/types'

/**
 * Issue detail rendered inside the Tracked container.
 *
 * The issue body/properties are the same component used by the global Issues
 * board, but the navigation contract is different: backlinks opened from
 * Tracked should return to Tracked, not jump up to the global board.
 */
export function TrackedIssueDetailPage({
  spec,
}: {
  spec: Extract<ViewSpec, { kind: 'tracked-issue-detail' }>
}) {
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const setSidebar = useWorkspace((s) => s.setSidebar)
  const { wsId, id } = spec.params

  const openTracked = useCallback(() => {
    setSidebar('tracked')
    openOrFocus({ kind: 'tracked', params: {} })
  }, [openOrFocus, setSidebar])



  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <IssueDetail
          wsId={wsId}
          id={id}
          backLabel="Tracked"
          onBack={openTracked}
        />
      </div>
    </div>
  )
}
