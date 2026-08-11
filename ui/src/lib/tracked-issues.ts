import type { IssueListItem, IssueSnapshot } from '../api/issues'
import type { EntityGraph, EntityGraphArtifactNode } from '../api/entities'

export interface TrackedIssueAnchor {
  workspaceId: string
  workspaceTag: string
  issue: IssueListItem
}

const ISSUE_NOTE_PREFIX = '.alice/issues/'

export function trackedIssuePath(issueId: string): string {
  return `${ISSUE_NOTE_PREFIX}${issueId}.md`
}

export function trackedIssueGraphNodeId(workspaceId: string, issueId: string): string {
  return `artifact:${encodeURIComponent(workspaceId)}:${encodeURIComponent(trackedIssuePath(issueId))}`
}

export function issueIdFromGraphNode(node: EntityGraphArtifactNode): string | null {
  if (node.artifactType !== 'issue' || !node.path.startsWith(ISSUE_NOTE_PREFIX) || !node.path.endsWith('.md')) {
    return null
  }
  const issueId = node.path.slice(ISSUE_NOTE_PREFIX.length, -'.md'.length)
  return issueId && !issueId.includes('/') ? issueId : null
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

/**
 * Add the complete live Issue index to the relationship graph. The backend
 * graph already contains Issue notes that link an entity; this projection
 * enriches those nodes with their human title and adds unlinked Issues so the
 * sidebar and graph share one selection model.
 */
export function graphWithTrackedIssues(
  graph: EntityGraph,
  anchors: readonly TrackedIssueAnchor[],
): EntityGraph {
  const anchorsByKey = new Map<string, TrackedIssueAnchor>(
    anchors.map((anchor) => [`${anchor.workspaceId}:${anchor.issue.id}`, anchor] as const),
  )
  const seen = new Set<string>()
  const nodes = graph.nodes.map((node) => {
    if (node.kind !== 'artifact') return node
    const issueId = issueIdFromGraphNode(node)
    if (!issueId) return node
    const key = `${node.workspaceId}:${issueId}`
    const anchor = anchorsByKey.get(key)
    if (!anchor) return node
    seen.add(key)
    return {
      ...node,
      label: anchor.issue.title,
      workspaceTag: anchor.workspaceTag,
    }
  })

  for (const anchor of anchors) {
    const key = `${anchor.workspaceId}:${anchor.issue.id}`
    if (seen.has(key)) continue
    nodes.push({
      id: trackedIssueGraphNodeId(anchor.workspaceId, anchor.issue.id),
      kind: 'artifact',
      label: anchor.issue.title,
      artifactType: 'issue',
      workspaceId: anchor.workspaceId,
      workspaceTag: anchor.workspaceTag,
      path: trackedIssuePath(anchor.issue.id),
    })
  }

  return { nodes, edges: graph.edges }
}
