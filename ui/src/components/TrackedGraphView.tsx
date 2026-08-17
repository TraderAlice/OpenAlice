import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  FileText,
  Focus,
  Hash,
  ListChecks,
  Maximize2,
  Minus,
  Plus,
  Settings2,
  TrendingUp,
} from 'lucide-react'

import type {
  EntityGraph,
  EntityGraphArtifactNode,
  EntityGraphNode,
} from '../api/entities'
import { layoutTrackedGraph, type GraphPositions } from '../lib/tracked-graph-layout'
import { issueIdFromGraphNode, trackedIssuePath } from '../lib/tracked-issues'
import { SegmentedControl } from './SegmentedControl'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

interface ViewBox {
  x: number
  y: number
  width: number
  height: number
}

interface DragState {
  pointerId: number
  clientX: number
  clientY: number
  viewBox: ViewBox
}

interface KindFilters {
  asset: boolean
  topic: boolean
  artifact: boolean
}

const CANVAS_WIDTH = 1200
const CANVAS_HEIGHT = 760
const INITIAL_VIEW_BOX: ViewBox = { x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT }

export function TrackedGraphView({
  graph,
  selectedName,
  selectedIssue,
  onSelectEntity,
  onSelectIssue,
  onOpenEntity,
  onOpenIssue,
  onOpenArtifact,
}: {
  graph: EntityGraph
  selectedName: string | null
  selectedIssue: { workspaceId: string; issueId: string } | null
  onSelectEntity: (name: string) => void
  onSelectIssue: (issue: { workspaceId: string; issueId: string }) => void
  onOpenEntity: (name: string) => void
  onOpenIssue: (issue: { workspaceId: string; issueId: string }) => void
  onOpenArtifact: (artifact: EntityGraphArtifactNode, returnEntityName: string) => void
}) {
  const { t } = useTranslation()
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const [positions, setPositions] = useState<GraphPositions>(() => layoutTrackedGraph(graph))
  const [viewBox, setViewBox] = useState<ViewBox>(INITIAL_VIEW_BOX)
  const [canvasAspect, setCanvasAspect] = useState(CANVAS_WIDTH / CANVAS_HEIGHT)
  const [scope, setScope] = useState<'all' | 'related'>('all')
  const [showUnlinked, setShowUnlinked] = useState(true)
  const [kindFilters, setKindFilters] = useState<KindFilters>({
    asset: true,
    topic: true,
    artifact: true,
  })
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null)

  useEffect(() => {
    setPositions(layoutTrackedGraph(graph))
    setViewBox(INITIAL_VIEW_BOX)
  }, [graph])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const measure = () => {
      const rect = svg.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) setCanvasAspect(rect.width / rect.height)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])

  const nodeById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  )
  const degreeById = useMemo(() => {
    const degree = new Map<string, number>()
    for (const edge of graph.edges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
    }
    return degree
  }, [graph.edges])
  const selectedEntity = useMemo(() => {
    const node = graph.nodes.find((candidate) => candidate.kind === 'entity' && candidate.label === selectedName)
    return node?.kind === 'entity' ? node : null
  }, [graph.nodes, selectedName])
  const selectedIssueArtifact = useMemo(() => {
    if (!selectedIssue) return null
    const path = trackedIssuePath(selectedIssue.issueId)
    const node = graph.nodes.find((candidate) => candidate.kind === 'artifact'
      && candidate.artifactType === 'issue'
      && candidate.workspaceId === selectedIssue.workspaceId
      && candidate.path === path)
    return node?.kind === 'artifact' ? node : null
  }, [graph.nodes, selectedIssue])
  const selectedArtifact = useMemo(() => {
    const node = selectedArtifactId ? nodeById.get(selectedArtifactId) : undefined
    return node?.kind === 'artifact' ? node : null
  }, [nodeById, selectedArtifactId])
  const selectedNode = selectedArtifact ?? selectedIssueArtifact ?? selectedEntity
  const selectedArtifactNode = selectedNode?.kind === 'artifact' ? selectedNode : null

  useEffect(() => {
    setSelectedArtifactId(null)
  }, [selectedName])

  useEffect(() => {
    if (!selectedIssueArtifact) return
    setSelectedArtifactId(selectedIssueArtifact.id)
    setKindFilters((current) => current.artifact ? current : { ...current, artifact: true })
    setShowUnlinked(true)
  }, [selectedIssueArtifact])

  const neighborhood = useMemo(() => {
    if (!selectedNode) return null
    const ids = new Set<string>([selectedNode.id])
    let frontier = new Set<string>([selectedNode.id])
    for (let depth = 0; depth < 2; depth += 1) {
      const next = new Set<string>()
      for (const edge of graph.edges) {
        if (frontier.has(edge.source) && !ids.has(edge.target)) next.add(edge.target)
        if (frontier.has(edge.target) && !ids.has(edge.source)) next.add(edge.source)
      }
      for (const id of next) ids.add(id)
      frontier = next
    }
    return ids
  }, [graph.edges, selectedNode])

  const visibleNodes = useMemo(() => graph.nodes.filter((node) => {
    if (scope === 'related' && neighborhood && !neighborhood.has(node.id)) return false
    if (!showUnlinked && (degreeById.get(node.id) ?? 0) === 0) return false
    if (node.kind === 'artifact') return kindFilters.artifact
    return kindFilters[node.entityType]
  }), [degreeById, graph.nodes, kindFilters, neighborhood, scope, showUnlinked])
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes])
  const visibleEdges = useMemo(
    () => graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
    [graph.edges, visibleIds],
  )

  useEffect(() => {
    if (selectedArtifactId && !visibleIds.has(selectedArtifactId)) setSelectedArtifactId(null)
  }, [selectedArtifactId, visibleIds])

  const relatedEntityForArtifact = useCallback((artifactId: string): string | null => {
    const selectedId = selectedEntity?.id
    const entityIds = graph.edges.flatMap((edge) => {
      if (edge.source === artifactId) return [edge.target]
      if (edge.target === artifactId) return [edge.source]
      return []
    })
    const chosen = selectedId && entityIds.includes(selectedId) ? selectedId : entityIds[0]
    const node = chosen ? nodeById.get(chosen) : undefined
    return node?.kind === 'entity' ? node.label : null
  }, [graph.edges, nodeById, selectedEntity])

  const activateNode = useCallback((node: EntityGraphNode) => {
    if (node.kind === 'entity') {
      setSelectedArtifactId(null)
      onSelectEntity(node.label)
      return
    }
    setSelectedArtifactId(node.id)
    const issueId = issueIdFromGraphNode(node)
    if (issueId) onSelectIssue({ workspaceId: node.workspaceId, issueId })
  }, [onSelectEntity, onSelectIssue])

  const openPreviewDetails = useCallback(() => {
    if (selectedArtifactNode) {
      const issueId = issueIdFromGraphNode(selectedArtifactNode)
      if (issueId) {
        onOpenIssue({ workspaceId: selectedArtifactNode.workspaceId, issueId })
        return
      }
      const returnEntityName = relatedEntityForArtifact(selectedArtifactNode.id)
      if (returnEntityName) onOpenArtifact(selectedArtifactNode, returnEntityName)
      return
    }
    if (selectedEntity) onOpenEntity(selectedEntity.label)
  }, [onOpenArtifact, onOpenEntity, onOpenIssue, relatedEntityForArtifact, selectedArtifactNode, selectedEntity])

  const fitVisible = useCallback((preferReadable = false) => {
    const points = visibleNodes.flatMap((node) => positions[node.id] ? [positions[node.id]!] : [])
    if (points.length === 0) {
      setViewBox(INITIAL_VIEW_BOX)
      return
    }
    const minX = Math.min(...points.map((point) => point.x))
    const maxX = Math.max(...points.map((point) => point.x))
    const minY = Math.min(...points.map((point) => point.y))
    const maxY = Math.max(...points.map((point) => point.y))
    // Horizontal room also accounts for the entity labels that extend to the
    // right of their anchor; fitting only circle centers clipped long names.
    let width = Math.max(280, maxX - minX + 260)
    let height = Math.max(220, maxY - minY + 170)
    let centerX = (minX + maxX) / 2
    let centerY = (minY + maxY) / 2

    // Match the SVG's actual aspect ratio so pointer-to-graph coordinates stay
    // exact and fitting does not introduce invisible letterbox gutters.
    if (width / height > canvasAspect) height = width / canvasAspect
    else width = height * canvasAspect

    // A portrait/narrow canvas cannot make the complete wide graph readable at
    // once. Frame a legible window around the selected anchor by default and
    // leave the explicit Fit button as the true all-nodes bird's-eye view.
    if (preferReadable && canvasAspect < 0.82) {
      height = Math.min(720, Math.max(420, height))
      width = height * canvasAspect
      const selectedPoint = selectedNode ? positions[selectedNode.id] : undefined
      if (selectedPoint) {
        // Give the selected anchor's outward-facing label breathing room.
        centerX = selectedPoint.x + (selectedPoint.x < CANVAS_WIDTH / 2 ? -width * 0.14 : width * 0.14)
        centerY = selectedPoint.y
      }
    }
    setViewBox({ x: centerX - width / 2, y: centerY - height / 2, width, height })
  }, [canvasAspect, positions, selectedNode, visibleNodes])

  useEffect(() => {
    fitVisible(true)
  }, [fitVisible, kindFilters, scope, showUnlinked])

  const zoom = useCallback((factor: number, anchorX?: number, anchorY?: number) => {
    setViewBox((current) => {
      const nextWidth = Math.min(2000, Math.max(260, current.width * factor))
      const nextHeight = Math.min(1260, Math.max(165, current.height * factor))
      const xRatio = anchorX === undefined ? 0.5 : (anchorX - current.x) / current.width
      const yRatio = anchorY === undefined ? 0.5 : (anchorY - current.y) / current.height
      return {
        x: current.x + (current.width - nextWidth) * xRatio,
        y: current.y + (current.height - nextHeight) * yRatio,
        width: nextWidth,
        height: nextHeight,
      }
    })
  }, [])

  const pointerToGraph = useCallback((clientX: number, clientY: number, box = viewBox) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return null
    return {
      x: box.x + ((clientX - rect.left) / rect.width) * box.width,
      y: box.y + ((clientY - rect.top) / rect.height) * box.height,
    }
  }, [viewBox])

  const startPan = (event: ReactPointerEvent<SVGRectElement>) => {
    if (event.button !== 0) return
    svgRef.current?.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      viewBox,
    }
  }

  const movePointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return
    const dx = event.clientX - drag.clientX
    const dy = event.clientY - drag.clientY
    setViewBox({
      ...drag.viewBox,
      x: drag.viewBox.x - (dx / rect.width) * drag.viewBox.width,
      y: drag.viewBox.y - (dy / rect.height) * drag.viewBox.height,
    })
  }

  const endPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (svgRef.current?.hasPointerCapture(event.pointerId)) {
      svgRef.current.releasePointerCapture(event.pointerId)
    }
  }

  const onWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault()
    const point = pointerToGraph(event.clientX, event.clientY)
    zoom(event.deltaY > 0 ? 1.12 : 0.88, point?.x, point?.y)
  }

  const activeNodeId = hoveredNodeId ?? selectedNode?.id ?? null
  const connectedToActive = useMemo(() => {
    const ids = new Set<string>()
    if (!activeNodeId) return ids
    ids.add(activeNodeId)
    for (const edge of visibleEdges) {
      if (edge.source === activeNodeId) ids.add(edge.target)
      if (edge.target === activeNodeId) ids.add(edge.source)
    }
    return ids
  }, [activeNodeId, visibleEdges])
  const entrancePhaseById = useMemo(() => {
    const origin = selectedNode && positions[selectedNode.id]
      ? positions[selectedNode.id]!
      : { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 }
    const ordered = [...visibleNodes].sort((left, right) => {
      const leftPoint = positions[left.id] ?? origin
      const rightPoint = positions[right.id] ?? origin
      const leftDistance = Math.hypot(leftPoint.x - origin.x, leftPoint.y - origin.y)
      const rightDistance = Math.hypot(rightPoint.x - origin.x, rightPoint.y - origin.y)
      return leftDistance - rightDistance || left.id.localeCompare(right.id)
    })
    const phases = new Map<string, number>()
    const divisor = Math.max(1, ordered.length - 1)
    ordered.forEach((node, index) => phases.set(node.id, Math.min(4, Math.floor((index / divisor) * 5))))
    return { origin, phases }
  }, [positions, selectedNode, visibleNodes])

  return (
    <div className="relative h-full min-h-[360px] overflow-hidden bg-background">
      <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 sm:left-4 sm:top-4">
        <SegmentedControl
          value={scope}
          onChange={setScope}
          ariaLabel={t('tracked.graph.scopeLabel')}
          compact
          options={[
            { value: 'all', label: t('tracked.graph.all') },
            { value: 'related', label: <span className="inline-flex items-center gap-1"><Focus size={11} />{t('tracked.graph.related')}</span> },
          ]}
        />
        <Popover>
          <PopoverTrigger
            aria-label={t('tracked.graph.filters')}
            title={t('tracked.graph.filters')}
            className="oa-icon-action flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-background/90 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-accent hover:text-foreground"
          >
            <Settings2 size={14} />
          </PopoverTrigger>
          <PopoverContent align="start" side="bottom" className="w-64 gap-3">
            <div>
              <div className="text-[12px] font-semibold text-foreground">{t('tracked.graph.filters')}</div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{t('tracked.graph.filtersDescription')}</div>
            </div>
            <div className="grid gap-1">
              <FilterRow checked={kindFilters.asset} onChange={(checked) => setKindFilters((value) => ({ ...value, asset: checked }))} icon={<TrendingUp size={13} />} label={t('tracked.assets')} />
              <FilterRow checked={kindFilters.topic} onChange={(checked) => setKindFilters((value) => ({ ...value, topic: checked }))} icon={<Hash size={13} />} label={t('tracked.topics')} />
              <FilterRow checked={kindFilters.artifact} onChange={(checked) => setKindFilters((value) => ({ ...value, artifact: checked }))} icon={<FileText size={13} />} label={t('tracked.graph.materials')} />
              <div className="my-1 h-px bg-border" />
              <FilterRow checked={showUnlinked} onChange={setShowUnlinked} label={t('tracked.graph.showUnlinked')} />
            </div>
          </PopoverContent>
        </Popover>
        <div className="hidden rounded-full border border-border/60 bg-background/85 px-2.5 py-1 text-[10px] tabular-nums text-muted-foreground backdrop-blur-sm sm:block">
          {t('tracked.graph.visibleCount', { nodes: visibleNodes.length, edges: visibleEdges.length })}
        </div>
      </div>

      <div className="absolute right-3 top-3 z-10 flex items-center overflow-hidden rounded-lg border border-border/70 bg-background/90 shadow-sm backdrop-blur-sm sm:right-4 sm:top-4">
        <GraphControl label={t('tracked.graph.zoomOut')} onClick={() => zoom(1.18)}><Minus size={14} /></GraphControl>
        <GraphControl label={t('tracked.graph.fit')} onClick={() => fitVisible()}><Maximize2 size={13} /></GraphControl>
        <GraphControl label={t('tracked.graph.zoomIn')} onClick={() => zoom(0.84)}><Plus size={14} /></GraphControl>
      </div>

      <svg
        ref={svgRef}
        role="application"
        aria-label={t('tracked.graph.canvasLabel')}
        className="h-full w-full touch-none select-none outline-none"
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={movePointer}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onWheel={onWheel}
      >
        <rect x={-2000} y={-2000} width={5200} height={4760} fill="transparent" onPointerDown={startPan} />
        <g aria-hidden="true">
          {visibleEdges.map((edge) => {
            const source = positions[edge.source]
            const target = positions[edge.target]
            if (!source || !target) return null
            const emphasized = activeNodeId !== null && (edge.source === activeNodeId || edge.target === activeNodeId)
            return (
              <line
                key={edge.id}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke="var(--chart-axis)"
                strokeWidth={emphasized ? 1.8 : 1}
                opacity={activeNodeId
                  ? (emphasized ? (hoveredNodeId ? 0.82 : 0.7) : (hoveredNodeId ? 0.06 : 0.1))
                  : 0.24}
                pathLength={1}
                vectorEffect="non-scaling-stroke"
                data-enter-phase={Math.max(
                  entrancePhaseById.phases.get(edge.source) ?? 0,
                  entrancePhaseById.phases.get(edge.target) ?? 0,
                )}
                className="oa-tracked-graph-edge"
              />
            )
          })}
        </g>
        <g>
          {visibleNodes.map((node) => {
            const point = positions[node.id]
            if (!point) return null
            const selected = node.id === selectedNode?.id
            const active = connectedToActive.has(node.id)
            const faded = activeNodeId !== null && !active
            const focusState = activeNodeId === null
              ? 'idle'
              : node.id === activeNodeId ? 'active' : active ? 'related' : 'dimmed'
            const degree = degreeById.get(node.id) ?? 0
            const radius = node.kind === 'entity' ? Math.min(14, 8.5 + degree * 0.45) : node.artifactType === 'issue' ? 5.5 : 4.2
            // Entity names carry the graph's meaning and stay visible. Source
            // labels appear on hover (or in a genuinely small graph) so a
            // high-degree selected entity does not turn its cluster into text.
            const showLabel = node.kind === 'entity'
              || selected
              || (hoveredNodeId !== null && active)
              || visibleNodes.length <= 12
            const labelOnLeft = point.x < CANVAS_WIDTH / 2
            const enterX = Math.max(-54, Math.min(54, (entrancePhaseById.origin.x - point.x) * 0.18))
            const enterY = Math.max(-42, Math.min(42, (entrancePhaseById.origin.y - point.y) * 0.18))
            return (
              <g
                key={node.id}
                transform={`translate(${point.x} ${point.y})`}
                opacity={faded ? (hoveredNodeId ? 0.14 : 0.32) : 1}
                data-graph-node={node.id}
                data-focus-state={focusState}
                data-hovered={node.id === hoveredNodeId ? 'true' : 'false'}
                className="oa-tracked-graph-node"
              >
                <g
                  data-enter-phase={entrancePhaseById.phases.get(node.id) ?? 0}
                  className="oa-tracked-graph-node-enter"
                  style={{
                    '--oa-graph-enter-x': `${enterX}px`,
                    '--oa-graph-enter-y': `${enterY}px`,
                  } as CSSProperties}
                >
                  <title>{nodeTitle(node)}</title>
                  {/* Keep the visual transform independent from the fixed hit
                      target and label. Otherwise scaling a long, off-centre
                      label can move the node out from under the pointer. */}
                  <g className="oa-tracked-graph-node-mark pointer-events-none">
                    <circle
                      r={radius + 7}
                      fill="var(--accent)"
                      opacity={node.id === hoveredNodeId ? 0.72 : 0}
                      className="oa-tracked-graph-hover-halo"
                    />
                    {selected && (
                      <circle r={radius + 5} fill="none" stroke="var(--primary)" strokeWidth={2} opacity={0.45} vectorEffect="non-scaling-stroke" />
                    )}
                    <foreignObject
                      x={-(radius + 8)}
                      y={-(radius + 8)}
                      width={(radius + 8) * 2}
                      height={(radius + 8) * 2}
                    >
                      <div className="flex h-full w-full items-center justify-center">
                        <span
                          aria-hidden
                          className={node.kind === 'artifact' && node.artifactType === 'issue' ? 'rounded-[1.5px]' : 'rounded-full'}
                          style={{
                            width: radius * 2,
                            height: radius * 2,
                            backgroundColor: node.kind === 'entity'
                              ? node.entityType === 'asset' ? 'var(--chart-1)' : 'var(--chart-4)'
                              : node.artifactType === 'issue' ? 'var(--chart-3)' : 'var(--muted-foreground)',
                            boxShadow: `0 0 0 ${node.kind === 'entity' ? 2 : 1.25}px var(--background)`,
                          }}
                        />
                      </div>
                    </foreignObject>
                  </g>
                  <foreignObject
                    x={-(radius + 8)}
                    y={-(radius + 8)}
                    width={(radius + 8) * 2}
                    height={(radius + 8) * 2}
                  >
                    <button
                      type="button"
                      aria-label={node.kind === 'entity'
                        ? t('tracked.graph.entityNodeLabel', { name: node.label, count: degree })
                        : t('tracked.graph.artifactNodeLabel', { name: node.label, workspace: node.workspaceTag })}
                      title={nodeTitle(node)}
                      onPointerEnter={() => setHoveredNodeId(node.id)}
                      onPointerLeave={() => setHoveredNodeId((value) => value === node.id ? null : value)}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => activateNode(node)}
                      className="h-full w-full rounded-full bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                    >
                      <span className="sr-only">{node.label}</span>
                    </button>
                  </foreignObject>
                  <text
                    x={labelOnLeft ? -(radius + 6) : radius + 6}
                    y={node.kind === 'entity' ? 4 : 3}
                    textAnchor={labelOnLeft ? 'end' : 'start'}
                    fill="var(--foreground)"
                    fontSize={node.kind === 'entity' ? 12 : 10}
                    fontWeight={node.kind === 'entity' ? 600 : 450}
                    paintOrder="stroke"
                    stroke="var(--background)"
                    strokeWidth={4}
                    strokeLinejoin="round"
                    opacity={showLabel ? 1 : 0}
                    className="oa-tracked-graph-label pointer-events-none"
                  >
                    {node.label}
                  </text>
                </g>
              </g>
            )
          })}
        </g>
      </svg>

      <div className="pointer-events-none absolute bottom-3 left-3 hidden flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground sm:bottom-4 sm:left-4 sm:flex">
        <LegendDot color="var(--chart-1)" label={t('tracked.graph.asset')} />
        <LegendDot color="var(--chart-4)" label={t('tracked.graph.topic')} />
        <LegendDot color="var(--muted-foreground)" label={t('tracked.graph.note')} />
        <LegendDot color="var(--chart-3)" label={t('tracked.graph.issue')} square />
      </div>

      {selectedNode && (
        <div
          key={selectedNode.id}
          className="oa-tracked-graph-preview-enter absolute bottom-3 right-3 z-10 max-w-[min(420px,calc(100%-1.5rem))] rounded-lg border border-border/70 bg-background/92 px-3 py-2.5 shadow-sm backdrop-blur-sm sm:bottom-4 sm:right-4"
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 truncate font-mono text-[12px] font-semibold text-foreground">
                {selectedArtifactNode && (
                  selectedArtifactNode.artifactType === 'issue'
                    ? <ListChecks size={12} className="shrink-0 text-muted-foreground" aria-hidden />
                    : <FileText size={12} className="shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="truncate">{selectedNode.label}</span>
              </div>
              {selectedArtifactNode ? (
                <div className="mt-0.5 min-w-0 text-[11px] leading-relaxed text-muted-foreground">
                  <div className="truncate">
                    {t(selectedArtifactNode.artifactType === 'issue' ? 'tracked.graph.issue' : 'tracked.graph.note')} · {selectedArtifactNode.workspaceTag}
                  </div>
                  <div className="truncate font-mono text-[10px] opacity-80">{selectedArtifactNode.path}</div>
                </div>
              ) : (
                <div className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{selectedEntity?.description}</div>
              )}
            </div>
            <button
              type="button"
              onClick={openPreviewDetails}
              className="oa-pressable shrink-0 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:border-primary/40 hover:bg-accent"
            >
              {t('tracked.graph.openDetails')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function FilterRow({
  checked,
  onChange,
  icon,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  icon?: React.ReactNode
  label: string
}) {
  return (
    <label className="flex min-h-8 items-center gap-2 rounded-md px-2 text-[12px] text-foreground hover:bg-accent">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 accent-primary"
      />
      {icon && <span className="text-muted-foreground" aria-hidden>{icon}</span>}
      <span>{label}</span>
    </label>
  )
}

function GraphControl({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="oa-icon-action flex h-8 w-8 items-center justify-center border-l border-border/60 text-muted-foreground first:border-l-0 hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  )
}

function LegendDot({ color, label, square = false }: { color: string; label: string; square?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={square ? 'h-2 w-2 rounded-[1px]' : 'h-2 w-2 rounded-full'} style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}

function nodeTitle(node: EntityGraphNode): string {
  if (node.kind === 'entity') return `${node.label} — ${node.description}`
  return `${node.workspaceTag} · ${node.path}`
}
