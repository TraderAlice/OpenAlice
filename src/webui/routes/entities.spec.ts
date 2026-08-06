import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createMemoryEntityStore } from '../../core/entity-store.js'
import type { WorkspaceRegistry } from '../../workspaces/workspace-registry.js'
import { createEntityRoutes } from './entities.js'

describe('entity routes graph', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'oa-entity-routes-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('projects shared authored backlinks through GET /relationships/graph', async () => {
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    await writeFile(join(workspace, 'power.md'), 'Connect [[stock-vst]] with [[ai-power]].')
    const entityStore = createMemoryEntityStore()
    await entityStore.upsert({ name: 'stock-vst', type: 'asset', description: 'Vistra' })
    await entityStore.upsert({ name: 'ai-power', type: 'topic', description: 'Power demand' })
    const registry = {
      list: () => [{ id: 'ws-1', tag: 'research', dir: workspace }],
    } as unknown as WorkspaceRegistry

    const app = createEntityRoutes({ entityStore, registry })
    const response = await app.request('/relationships/graph')
    expect(response.status).toBe(200)
    const graph = await response.json() as {
      nodes: Array<{ kind: string; label: string }>
      edges: Array<{ source: string; target: string }>
    }
    expect(graph.nodes.filter((node) => node.kind === 'entity')).toHaveLength(2)
    expect(graph.nodes.filter((node) => node.kind === 'artifact')).toEqual([
      expect.objectContaining({ label: 'power' }),
    ])
    expect(graph.edges).toHaveLength(2)
    expect(new Set(graph.edges.map((edge) => edge.source))).toHaveLength(1)
  })
})
