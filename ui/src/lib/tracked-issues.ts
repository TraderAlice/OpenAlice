import type { IssueListItem, IssueSnapshot } from '../api/issues'

export interface TrackedIssueAnchor {
  workspaceId: string
  workspaceTag: string
  issue: IssueListItem
}

const STATUS_ORDER: Record<IssueListItem['status'], number> = {
  in_progress: 0,
  todo: 1,
  backlog: 2,
  done: 3,
  canceled: 4,
}

/** Flatten the Workspace-owned Issue board into stable Tracked anchors. */
export function trackedIssueAnchors(snapshot: IssueSnapshot | null): TrackedIssueAnchor[] {
  if (!snapshot) return []
  return (snapshot.workspaces ?? [])
    .filter((workspace) => workspace.status === 'ok')
    .flatMap((workspace) => (workspace.issues ?? []).map((issue) => ({
      workspaceId: workspace.wsId,
      workspaceTag: workspace.tag,
      issue,
    })))
    .sort((a, b) => STATUS_ORDER[a.issue.status] - STATUS_ORDER[b.issue.status]
      || a.issue.title.localeCompare(b.issue.title)
      || a.workspaceTag.localeCompare(b.workspaceTag))
}
