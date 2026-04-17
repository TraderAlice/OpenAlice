import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { api, type TopologyResponse, type EventLogEntry } from '../api'
import { useSSE } from '../hooks/useSSE'
import { PageLoading, EmptyState } from '../components/StateViews'

// ==================== Layout ====================

const COL_X = {
  inputs: 40,
  listeners: 360,
  outputs: 680,
}
const ROW_HEIGHT = 80
const PULSE_MS = 800

function buildGraph(topology: TopologyResponse): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  // Partition event types into "inputs" (subscribed by some listener) and
  // "outputs" (emitted by some listener). A type can be both — in that
  // case we render it in inputs only (it's a producer-facing node).
  const subscribedTo = new Set(topology.listeners.map((l) => l.eventType))
  const emitted = new Set<string>()
  for (const l of topology.listeners) for (const e of l.emits) emitted.add(e)

  const inputs = topology.eventTypes.filter((t) => subscribedTo.has(t))
  const outputs = topology.eventTypes.filter((t) => emitted.has(t) && !subscribedTo.has(t))

  // Input event nodes (left column)
  inputs.forEach((type, i) => {
    nodes.push({
      id: `event:${type}`,
      type: 'default',
      data: { label: type },
      position: { x: COL_X.inputs, y: 20 + i * ROW_HEIGHT },
      className: 'flow-event-node',
      sourcePosition: 'right' as any,
      targetPosition: 'left' as any,
    })
  })

  // Listener nodes (middle column)
  topology.listeners.forEach((l, i) => {
    nodes.push({
      id: `listener:${l.name}`,
      type: 'default',
      data: { label: l.name },
      position: { x: COL_X.listeners, y: 20 + i * ROW_HEIGHT },
      className: 'flow-listener-node',
      sourcePosition: 'right' as any,
      targetPosition: 'left' as any,
    })
  })

  // Output event nodes (right column)
  outputs.forEach((type, i) => {
    nodes.push({
      id: `event:${type}`,
      type: 'default',
      data: { label: type },
      position: { x: COL_X.outputs, y: 20 + i * ROW_HEIGHT },
      className: 'flow-event-node',
      sourcePosition: 'right' as any,
      targetPosition: 'left' as any,
    })
  })

  // Subscribe edges: eventType → listener
  for (const l of topology.listeners) {
    edges.push({
      id: `sub:${l.eventType}->${l.name}`,
      source: `event:${l.eventType}`,
      target: `listener:${l.name}`,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: '#58a6ff', strokeWidth: 1.5 },
    })
  }

  // Emit edges: listener → eventType
  for (const l of topology.listeners) {
    for (const e of l.emits) {
      edges.push({
        id: `emit:${l.name}->${e}`,
        source: `listener:${l.name}`,
        target: `event:${e}`,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: '#3fb950', strokeWidth: 1.5, strokeDasharray: '4 3' },
      })
    }
  }

  return { nodes, edges }
}

// ==================== Component ====================

export function AutomationFlowSection() {
  const [topology, setTopology] = useState<TopologyResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Track which nodes are currently pulsing (key: node id)
  const [pulsing, setPulsing] = useState<Set<string>>(new Set())
  const pulseTimers = useRef<Map<string, number>>(new Map())

  // Fetch topology
  useEffect(() => {
    api.topology.get()
      .then(setTopology)
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
  }, [])

  // Pulse the event-type node when an event of that type arrives
  const handleSSE = useCallback((entry: EventLogEntry) => {
    const nodeId = `event:${entry.type}`
    setPulsing((prev) => {
      if (prev.has(nodeId)) return prev
      const next = new Set(prev)
      next.add(nodeId)
      return next
    })
    // Clear after PULSE_MS
    const existing = pulseTimers.current.get(nodeId)
    if (existing) window.clearTimeout(existing)
    const t = window.setTimeout(() => {
      setPulsing((prev) => {
        if (!prev.has(nodeId)) return prev
        const next = new Set(prev)
        next.delete(nodeId)
        return next
      })
      pulseTimers.current.delete(nodeId)
    }, PULSE_MS)
    pulseTimers.current.set(nodeId, t as unknown as number)
  }, [])

  useSSE({
    url: '/api/events/stream',
    onMessage: handleSSE,
  })

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      pulseTimers.current.forEach((t) => window.clearTimeout(t))
      pulseTimers.current.clear()
    }
  }, [])

  // Build graph + overlay pulse class
  const { nodes, edges } = useMemo(() => {
    if (!topology) return { nodes: [] as Node[], edges: [] as Edge[] }
    const g = buildGraph(topology)
    g.nodes = g.nodes.map((n) => {
      if (pulsing.has(n.id)) {
        return { ...n, className: `${n.className ?? ''} flow-pulse` }
      }
      return n
    })
    return g
  }, [topology, pulsing])

  if (loadError) {
    return <EmptyState title="Failed to load topology" description={loadError} />
  }
  if (!topology) return <PageLoading />

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="rounded-lg border border-border/50 bg-bg-secondary/50 px-4 py-3">
        <p className="text-[13px] text-text-muted leading-relaxed">
          Alice's async lifecycle as a graph. Left column: event types Alice listens to. Middle: registered
          listeners. Right: event types they emit. Solid blue arrows are subscriptions, dashed green arrows are
          emissions. Nodes pulse in real time when events flow through the system.
        </p>
      </div>

      <div className="flex-1 min-h-0 rounded-lg border border-border bg-bg overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Background color="#30363d" gap={16} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  )
}
