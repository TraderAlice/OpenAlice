import { describe, expect, it } from 'vitest'

import type { EntityGraph } from '../api/entities'
import type { IssueSnapshot } from '../api/issues'
import { graphWithTrackedIssues, trackedIssueAnchors, trackedIssueGraphNodeId } from './tracked-issues'

const snapshot: IssueSnapshot = {
  workspaces: [{
    wsId: 'workspace-1',
    tag: 'research',
    status: 'ok',
    issues: [
      { id: 'linked', title: 'Linked Issue', status: 'todo', priority: 'medium', assignee: '@human' },
      { id: 'unlinked', title: 'Unlinked Issue', status: 'todo', priority: 'low', assignee: '@human' },
    ],
  }],
}

const graph: EntityGraph = {
  nodes: [{
    id: trackedIssueGraphNodeId('workspace-1', 'linked'),
    kind: 'artifact',
    label: 'linked',
    artifactType: 'issue',
    workspaceId: 'workspace-1',
    workspaceTag: 'research',
    path: '.alice/issues/linked.md',
  }],
  edges: [],
}

describe('graphWithTrackedIssues', () => {
  it('enriches linked Issue nodes and adds unlinked Issues once', () => {
    const result = graphWithTrackedIssues(graph, trackedIssueAnchors(snapshot))

    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: trackedIssueGraphNodeId('workspace-1', 'linked'),
        label: 'Linked Issue',
      }),
      expect.objectContaining({
        id: trackedIssueGraphNodeId('workspace-1', 'unlinked'),
        label: 'Unlinked Issue',
      }),
    ]))
    expect(result.nodes).toHaveLength(2)
    expect(result.edges).toBe(graph.edges)
  })
})
