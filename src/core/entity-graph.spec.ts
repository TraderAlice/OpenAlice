import { describe, expect, it } from 'vitest'

import type { Backlink } from './entity-backlinks.js'
import { buildEntityGraph } from './entity-graph.js'
import type { Entity } from './entity-store.js'

const entities: Entity[] = [
  { name: 'stock-vst', type: 'asset', description: 'Vistra', createdAt: 2 },
  { name: 'ai-data-center-power', type: 'topic', description: 'Power demand', createdAt: 1 },
  { name: 'unlinked-topic', type: 'topic', description: 'No notes yet', createdAt: 0 },
]

const sharedNote: Backlink = {
  workspaceId: 'ws-1',
  workspaceTag: 'research',
  path: 'rotation/power.md',
}

describe('buildEntityGraph', () => {
  it('uses one artifact node to bridge every tracked entity referenced by the same note', () => {
    const graph = buildEntityGraph(entities, new Map([
      ['stock-vst', [sharedNote]],
      ['ai-data-center-power', [sharedNote]],
    ]))

    expect(graph.nodes.filter((node) => node.kind === 'entity')).toHaveLength(3)
    expect(graph.nodes.filter((node) => node.kind === 'artifact')).toEqual([
      expect.objectContaining({
        kind: 'artifact',
        label: 'power',
        artifactType: 'note',
        workspaceId: 'ws-1',
        path: 'rotation/power.md',
      }),
    ])
    expect(graph.edges).toHaveLength(2)
    expect(new Set(graph.edges.map((edge) => edge.source))).toHaveLength(1)
  })

  it('keeps unlinked entities visible and identifies issue notes', () => {
    const graph = buildEntityGraph(entities, new Map([
      ['stock-vst', [{
        workspaceId: 'ws-2',
        workspaceTag: 'daily',
        path: '.alice/issues/morning-scan.md',
      }]],
    ]))

    expect(graph.nodes).toContainEqual(expect.objectContaining({
      kind: 'entity',
      label: 'unlinked-topic',
    }))
    expect(graph.nodes).toContainEqual(expect.objectContaining({
      kind: 'artifact',
      label: 'morning-scan',
      artifactType: 'issue',
    }))
  })
})
