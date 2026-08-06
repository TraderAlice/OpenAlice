import type { EntityGraph } from '../api/entities'

export interface GraphPoint {
  x: number
  y: number
}

export type GraphPositions = Record<string, GraphPoint>

const WIDTH = 1200
const HEIGHT = 760
const PADDING = 70

function hashUnit(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 0xffffffff
}

/**
 * Deterministic force-style layout for the small, curated Tracked graph.
 * Keeping the layout pure makes the first paint stable, avoids a canvas-only
 * dependency, and lets SVG retain keyboard-accessible nodes.
 */
export function layoutTrackedGraph(graph: EntityGraph): GraphPositions {
  if (graph.nodes.length === 0) return {}

  const nodes = graph.nodes.map((node, index) => {
    const entity = node.kind === 'entity'
    const angle = hashUnit(node.id) * Math.PI * 2
    const ring = entity ? 170 + (index % 4) * 24 : 285 + (index % 6) * 18
    return {
      id: node.id,
      entity,
      x: WIDTH / 2 + Math.cos(angle) * ring,
      y: HEIGHT / 2 + Math.sin(angle) * ring * 0.68,
      vx: 0,
      vy: 0,
    }
  })
  const byId = new Map(nodes.map((node, index) => [node.id, index]))
  const links = graph.edges.flatMap((edge) => {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    return source === undefined || target === undefined ? [] : [{ source, target }]
  })

  for (let iteration = 0; iteration < 260; iteration += 1) {
    const cooling = 1 - iteration / 300

    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i]!
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j]!
        let dx = b.x - a.x
        let dy = b.y - a.y
        let distanceSq = dx * dx + dy * dy
        if (distanceSq < 1) {
          dx = (hashUnit(`${a.id}:${b.id}`) - 0.5) * 2
          dy = (hashUnit(`${b.id}:${a.id}`) - 0.5) * 2
          distanceSq = dx * dx + dy * dy
        }
        const distance = Math.sqrt(distanceSq)
        const repulsion = (a.entity && b.entity ? 6800 : 4300) / Math.max(distanceSq, 36)
        const fx = (dx / distance) * repulsion * cooling
        const fy = (dy / distance) * repulsion * cooling
        a.vx -= fx
        a.vy -= fy
        b.vx += fx
        b.vy += fy
      }
    }

    for (const link of links) {
      const source = nodes[link.source]!
      const target = nodes[link.target]!
      const dx = target.x - source.x
      const dy = target.y - source.y
      const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
      const pull = (distance - 112) * 0.014 * cooling
      const fx = (dx / distance) * pull
      const fy = (dy / distance) * pull
      source.vx += fx
      source.vy += fy
      target.vx -= fx
      target.vy -= fy
    }

    for (const node of nodes) {
      node.vx += (WIDTH / 2 - node.x) * 0.0018
      node.vy += (HEIGHT / 2 - node.y) * 0.0024
      node.vx *= 0.82
      node.vy *= 0.82
      node.x = Math.min(WIDTH - PADDING, Math.max(PADDING, node.x + node.vx))
      node.y = Math.min(HEIGHT - PADDING, Math.max(PADDING, node.y + node.vy))
    }
  }

  return Object.fromEntries(nodes.map((node) => [node.id, { x: node.x, y: node.y }]))
}
