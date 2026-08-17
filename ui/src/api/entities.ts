import { fetchJson } from './client'

export type EntityType = 'asset' | 'topic'

export interface Entity {
  name: string
  description: string
  type: EntityType
  createdAt: number
}

export interface EntityListItem extends Entity {
  /** How many notes reference this entity via `[[name]]`. */
  backlinkCount: number
}

export interface Backlink {
  workspaceId: string
  workspaceTag: string
  /** Path of the note, relative to the workspace root. */
  path: string
}

export interface EntityDetail {
  entity: Entity
  backlinks: Backlink[]
}

export interface EntityGraphEntityNode {
  id: string
  kind: 'entity'
  label: string
  entityType: EntityType
  description: string
  createdAt: number
}

export interface EntityGraphArtifactNode {
  id: string
  kind: 'artifact'
  label: string
  artifactType: 'note' | 'issue'
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

export const entitiesApi = {
  async list(): Promise<{ entities: EntityListItem[] }> {
    return fetchJson('/api/entities')
  },
  async graph(): Promise<EntityGraph> {
    return fetchJson('/api/entities/relationships/graph')
  },
  async get(name: string): Promise<EntityDetail> {
    return fetchJson(`/api/entities/${encodeURIComponent(name)}`)
  },
}
