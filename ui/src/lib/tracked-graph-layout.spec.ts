import { describe, expect, it } from 'vitest'

import type { EntityGraph } from '../api/entities'
import { layoutTrackedGraph } from './tracked-graph-layout'

const graph: EntityGraph = {
  nodes: [
    { id: 'entity:a', kind: 'entity', label: 'a', entityType: 'asset', description: 'A', createdAt: 1 },
    { id: 'entity:b', kind: 'entity', label: 'b', entityType: 'topic', description: 'B', createdAt: 1 },
    {
      id: 'artifact:n', kind: 'artifact', label: 'note', artifactType: 'note',
      workspaceId: 'w', workspaceTag: 'research', path: 'note.md',
    },
  ],
  edges: [
    { id: 'n-a', source: 'artifact:n', target: 'entity:a' },
    { id: 'n-b', source: 'artifact:n', target: 'entity:b' },
  ],
}

describe('layoutTrackedGraph', () => {
  it('returns stable finite coordinates for every graph node', () => {
    const first = layoutTrackedGraph(graph)
    const second = layoutTrackedGraph(graph)
    expect(first).toEqual(second)
    expect(Object.keys(first)).toHaveLength(graph.nodes.length)
    for (const point of Object.values(first)) {
      expect(Number.isFinite(point.x)).toBe(true)
      expect(Number.isFinite(point.y)).toBe(true)
      expect(point.x).toBeGreaterThan(0)
      expect(point.y).toBeGreaterThan(0)
    }
  })

  it('handles an empty graph', () => {
    expect(layoutTrackedGraph({ nodes: [], edges: [] })).toEqual({})
  })
})
