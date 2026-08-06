import type { Backlink } from './entity-backlinks.js'
import type { Entity } from './entity-store.js'

export type EntityGraphArtifactType = 'note' | 'issue'

export interface EntityGraphEntityNode {
  id: string
  kind: 'entity'
  label: string
  entityType: Entity['type']
  description: string
  createdAt: number
}

export interface EntityGraphArtifactNode {
  id: string
  kind: 'artifact'
  label: string
  artifactType: EntityGraphArtifactType
  workspaceId: string
  workspaceTag: string
  path: string
}

export type EntityGraphNode = EntityGraphEntityNode | EntityGraphArtifactNode

export interface EntityGraphEdge {
  id: string
  source: string
  target: string
}

export interface EntityGraph {
  nodes: EntityGraphNode[]
  edges: EntityGraphEdge[]
}

const ISSUE_NOTE_PREFIX = '.alice/issues/'

function entityNodeId(name: string): string {
  return `entity:${encodeURIComponent(name.trim().toLowerCase())}`
}

function artifactNodeId(backlink: Backlink): string {
  return `artifact:${encodeURIComponent(backlink.workspaceId)}:${encodeURIComponent(backlink.path)}`
}

function artifactLabel(path: string): { label: string; artifactType: EntityGraphArtifactType } {
  if (path.startsWith(ISSUE_NOTE_PREFIX) && path.endsWith('.md')) {
    return {
      label: path.slice(ISSUE_NOTE_PREFIX.length, -'.md'.length),
      artifactType: 'issue',
    }
  }
  const basename = path.split('/').at(-1) ?? path
  return {
    label: basename.endsWith('.md') ? basename.slice(0, -'.md'.length) : basename,
    artifactType: 'note',
  }
}

/**
 * Project the canonical tracked-entity store and authored `[[name]]` backlink
 * index into a bipartite graph. Entity nodes remain present when unlinked;
 * artifact nodes are deduplicated so one note that links several entities is
 * the bridge between those anchors instead of appearing several times.
 */
export function buildEntityGraph(
  entities: readonly Entity[],
  backlinks: ReadonlyMap<string, readonly Backlink[]>,
): EntityGraph {
  const nodes: EntityGraphNode[] = []
  const artifactNodes = new Map<string, EntityGraphArtifactNode>()
  const edges: EntityGraphEdge[] = []

  for (const entity of entities) {
    const entityId = entityNodeId(entity.name)
    nodes.push({
      id: entityId,
      kind: 'entity',
      label: entity.name,
      entityType: entity.type,
      description: entity.description,
      createdAt: entity.createdAt,
    })

    for (const backlink of backlinks.get(entity.name.trim().toLowerCase()) ?? []) {
      const artifactId = artifactNodeId(backlink)
      if (!artifactNodes.has(artifactId)) {
        const { label, artifactType } = artifactLabel(backlink.path)
        artifactNodes.set(artifactId, {
          id: artifactId,
          kind: 'artifact',
          label,
          artifactType,
          workspaceId: backlink.workspaceId,
          workspaceTag: backlink.workspaceTag,
          path: backlink.path,
        })
      }
      edges.push({
        id: `${artifactId}->${entityId}`,
        source: artifactId,
        target: entityId,
      })
    }
  }

  return { nodes: [...nodes, ...artifactNodes.values()], edges }
}
