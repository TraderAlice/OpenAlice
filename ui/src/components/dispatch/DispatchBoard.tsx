import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  FileText,
  GitFork,
  Inbox,
  Layers,
  MessageSquare,
  Pause,
  Radio,
  RefreshCw,
  Terminal,
} from 'lucide-react'

import type {
  DispatchArtifact,
  DispatchEdge,
  DispatchEdgeKind,
  DispatchSpan,
} from '../../api/dispatch'
import { ScheduleSkipPill } from '../ScheduleSkipState'
import { CenteredLoading } from '../StateViews'
import { Button } from '../ui/button'
import {
  DispatchInspectorSheet,
  edgeKindLabel,
  type DispatchSelectedItem,
} from './DispatchInspectorSheet'
import {
  buildDispatchEpisodes,
  clampTimePct,
  clusterLaneSpans,
  collectConnectedTraceIds,
  formatBurstClockSpan,
  formatClockPoint,
  formatDurationMs,
  formatTickTime,
  formatWindowRange,
  isDifferentCalendarDay,
  layoutEdgeGeometries,
  localeForLanguage,
  resolveSpanTitle,
  type ComputedDispatchEdgeGeometry,
  type DispatchEpisode,
  type DispatchExecutionItem,
  type DispatchFocusTarget,
  type DispatchSpanCluster,
  type PackedDispatchSpan,
  type RawDispatchEdgeEndpoint,
} from './layout'
import type { DispatchWindowPreset, UseDispatchBoardResult } from './useDispatchBoard'

export type DispatchFilterKind = 'all' | 'orchestration' | 'scheduled' | 'outputs' | 'attention'

const TRACK_HEIGHT_PX = 26
const TRACK_GAP_PX = 4
const TRACK_TOP_PAD_PX = 8
const MIN_LANE_HEIGHT_PX = 64
const MAX_LANE_TRACKS = 2

function spanTitle(span: DispatchSpan, t: TFunction): string {
  const fallback =
    span.trigger.kind === 'orchestration'
      ? `${t('issues.dispatch.triggerOrchestration')} (${span.agent})`
      : span.agent
  return resolveSpanTitle(span, fallback)
}

function triggerKindLabel(kind: DispatchSpan['trigger']['kind'], t: TFunction): string {
  switch (kind) {
    case 'scheduled-issue':
      return t('issues.dispatch.triggerScheduled')
    case 'orchestration':
      return t('issues.dispatch.triggerOrchestration')
    case 'conversation':
      return t('issues.dispatch.triggerConversation')
    case 'inquiry':
      return t('issues.dispatch.triggerInquiry')
    case 'interactive':
      return t('issues.dispatch.triggerInteractive')
    case 'manual':
      return t('issues.dispatch.triggerManual')
  }
}

function SpanTriggerIcon({ trigger }: { trigger: DispatchSpan['trigger'] }) {
  switch (trigger.kind) {
    case 'scheduled-issue':
      return <Clock size={11} className="shrink-0" aria-hidden />
    case 'orchestration':
      return <GitFork size={11} className="shrink-0" aria-hidden />
    case 'conversation':
    case 'inquiry':
      return <MessageSquare size={11} className="shrink-0" aria-hidden />
    case 'interactive':
      return <Terminal size={11} className="shrink-0" aria-hidden />
    case 'manual':
      return <Radio size={11} className="shrink-0" aria-hidden />
  }
}

function SpanStatusIcon({ status }: { status: DispatchSpan['status'] }) {
  if (status === 'running') {
    return (
      <span
        className="size-2 shrink-0 rounded-full bg-primary animate-pulse motion-reduce:animate-none"
        aria-hidden
      />
    )
  }
  if (status === 'failed') {
    return <AlertTriangle size={13} className="shrink-0 text-destructive" aria-hidden />
  }
  if (status === 'interrupted') {
    return <Pause size={13} className="shrink-0 text-warning" aria-hidden />
  }
  return <CheckCircle2 size={13} className="shrink-0 text-success" aria-hidden />
}

function statusBadgeClasses(status: DispatchSpan['status']): string {
  if (status === 'running') return 'border-primary/40 bg-primary/15 text-primary'
  if (status === 'failed') return 'border-destructive/40 bg-destructive/15 text-destructive'
  if (status === 'interrupted') return 'border-warning/40 bg-warning/15 text-warning'
  return 'border-success/40 bg-success/15 text-success'
}

function statusLabel(status: DispatchSpan['status'], t: TFunction): string {
  if (status === 'running') return t('issues.dispatch.statusRunning')
  if (status === 'failed') return t('issues.dispatch.statusFailed')
  if (status === 'interrupted') return t('issues.dispatch.statusInterrupted')
  return t('issues.dispatch.statusDone')
}

function spanBarClasses(span: DispatchSpan, emphasized: boolean, dimmed: boolean): string {
  const base =
    'group absolute flex min-w-5 items-center gap-1 overflow-hidden rounded-md border px-1.5 text-left text-[11px] transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
  const tone =
    span.status === 'running'
      ? 'border-primary/60 bg-primary/15 text-foreground shadow-xs'
      : span.status === 'failed'
        ? 'border-destructive/60 bg-destructive/15 text-destructive'
        : span.status === 'interrupted'
          ? 'border-warning/60 bg-warning/15 text-warning'
          : 'border-border bg-card text-foreground hover:border-foreground/40 hover:bg-muted/60'
  const focusRing = emphasized ? 'ring-2 ring-primary/50 border-primary z-10' : 'z-[5]'
  const opacity = dimmed ? 'opacity-30' : 'opacity-100'
  return `${base} ${tone} ${focusRing} ${opacity}`
}

function clusterPillClasses(
  cluster: DispatchSpanCluster,
  emphasized: boolean,
  dimmed: boolean,
): string {
  const base =
    'group absolute inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 text-[11px] font-medium shadow-xs transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
  const tone =
    cluster.worstStatus === 'failed'
      ? 'border-destructive/60 bg-destructive/15 text-destructive hover:bg-destructive/20'
      : cluster.worstStatus === 'interrupted'
        ? 'border-warning/60 bg-warning/15 text-warning hover:bg-warning/20'
        : cluster.worstStatus === 'running'
          ? 'border-primary/60 bg-primary/15 text-primary hover:bg-primary/20'
          : 'border-border bg-card text-foreground hover:border-foreground/40 hover:bg-muted/70'
  const focusRing = emphasized ? 'ring-2 ring-primary/50 border-primary z-20' : 'z-[8]'
  const opacity = dimmed ? 'opacity-30' : 'opacity-100'
  return `${base} ${tone} ${focusRing} ${opacity}`
}

function edgeStrokeClass(kind: DispatchEdgeKind): string {
  if (kind === 'escalation') return 'stroke-destructive'
  if (kind === 'question') return 'stroke-warning'
  if (kind === 'worker_done' || kind === 'reply') return 'stroke-success'
  return 'stroke-primary'
}

function edgePillClasses(edge: DispatchEdge, emphasized: boolean, dimmed: boolean): string {
  const base =
    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium shadow-xs transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
  const tone =
    edge.kind === 'escalation'
      ? 'border-destructive/50 bg-destructive/15 text-destructive'
      : edge.kind === 'question'
        ? 'border-warning/50 bg-warning/15 text-warning'
        : edge.kind === 'worker_done' || edge.kind === 'reply'
          ? 'border-success/50 bg-success/15 text-success'
          : 'border-primary/40 bg-background text-primary'
  const ring = emphasized ? 'ring-2 ring-primary/50 z-30' : 'z-20'
  const opacity = dimmed ? 'opacity-25' : 'opacity-100'
  return `${base} ${tone} ${ring} ${opacity}`
}

function isAttentionEdge(edge: DispatchEdge): boolean {
  return (
    edge.kind === 'escalation'
    || edge.deliveryStatus === 'unread'
    || edge.taskStatus === 'waiting_parent'
    || edge.outcome === 'failed'
  )
}

function edgeConnectsSpan(edge: DispatchEdge, span: DispatchSpan): boolean {
  if (edge.taskId && span.id === edge.taskId) return true
  if (
    edge.dispatchId
    && span.trigger.kind === 'orchestration'
    && span.trigger.dispatchId === edge.dispatchId
  ) {
    return true
  }
  const slackMs = 120_000
  const spanEnd = span.finishedAt ?? Number.MAX_SAFE_INTEGER
  const inWindow = edge.at >= span.startedAt - slackMs && edge.at <= spanEnd + slackMs
  if (!inWindow) return false
  if (edge.fromResumeId && span.workspaceId === edge.fromWorkspaceId && span.resumeId === edge.fromResumeId) {
    return true
  }
  if (span.workspaceId === edge.toWorkspaceId && span.resumeId === edge.toResumeId) {
    return true
  }
  return false
}

function snippetText(span: DispatchSpan): string | undefined {
  if (span.error) return span.error
  if (span.assistantPreview) return span.assistantPreview
  const raw = span.originalPrompt ?? span.prompt
  if (!raw) return undefined
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^#+\s*/, '')
    if (trimmed) return trimmed
  }
  return undefined
}

function burstRunSessionLabel(
  span: DispatchSpan,
  runTitle: string,
  runSnippet: string | undefined,
): string | undefined {
  const raw = span.sessionLabel?.trim()
  if (!raw || raw.startsWith('#') || raw.includes('\n')) return undefined
  if (raw === runTitle || raw === runSnippet) return undefined
  return raw
}

function artifactSnippet(art: DispatchArtifact): string | undefined {
  if (art.kind === 'report') return art.summary
  const lines = art.body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const firstNonHeading = lines.find((l) => !l.startsWith('#')) ?? lines[0]
  return firstNonHeading?.replace(/^#+\s*/, '')
}

export function DispatchToolbarControls({ board }: { board: UseDispatchBoardResult }) {
  const { t, i18n } = useTranslation()
  const locale = localeForLanguage(i18n.language)
  const presets: readonly DispatchWindowPreset[] = ['1h', '6h', '24h']
  const rangeLabel = formatWindowRange(board.fromMs, board.toMs, locale)

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div
        className="inline-flex rounded-full border border-border bg-background p-0.5"
        role="group"
        aria-label={t('issues.dispatch.title')}
      >
        {presets.map((p) => (
          <Button
            key={p}
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={board.preset === p}
            onClick={() => board.setPreset(p)}
            className={`h-7 rounded-full px-2.5 text-xs ${board.preset === p ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground'}`}
          >
            {t(`issues.dispatch.window${p}` as 'issues.dispatch.window1h')}
          </Button>
        ))}
      </div>

      <div className="inline-flex items-center rounded-full border border-border bg-background px-1 py-0.5 text-xs">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-6 rounded-full"
          aria-label={t('issues.dispatch.stepBack')}
          title={t('issues.dispatch.stepBack')}
          onClick={() => board.stepWindow(-1)}
        >
          <ChevronLeft size={13} aria-hidden />
        </Button>
        <span className="px-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">
          {rangeLabel}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-6 rounded-full"
          aria-label={t('issues.dispatch.stepForward')}
          title={t('issues.dispatch.stepForward')}
          disabled={board.live}
          onClick={() => board.stepWindow(1)}
        >
          <ChevronRight size={13} aria-hidden />
        </Button>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-pressed={board.live}
        onClick={() => board.setLive(!board.live)}
        className={`h-8 rounded-full px-3 text-xs ${board.live ? 'border-primary/40 bg-primary/10 text-primary' : 'text-muted-foreground'}`}
      >
        <span
          className={`size-1.5 rounded-full ${board.live ? 'bg-primary animate-pulse motion-reduce:animate-none' : 'bg-muted-foreground/50'}`}
          aria-hidden
        />
        {board.live ? t('issues.dispatch.live') : t('issues.dispatch.paused')}
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-8 rounded-full"
        aria-label={t('issues.dispatch.refresh')}
        title={t('issues.dispatch.refresh')}
        onClick={() => { void board.refresh() }}
      >
        <RefreshCw size={13} className={board.loading ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden />
      </Button>
    </div>
  )
}

export function DispatchBoard({ board }: { board: UseDispatchBoardResult }) {
  const { t, i18n } = useTranslation()
  const locale = localeForLanguage(i18n.language)

  const [filter, setFilter] = useState<DispatchFilterKind>('all')
  const [selected, setSelected] = useState<DispatchSelectedItem>(null)
  const [hovered, setHovered] = useState<DispatchFocusTarget>(null)
  const [focusedClusterId, setFocusedClusterId] = useState<string | null>(null)
  const [focusedEpisodeId, setFocusedEpisodeId] = useState<string | null>(null)
  const [expandedBurstIds, setExpandedBurstIds] = useState<ReadonlySet<string>>(() => new Set())

  const snapshot = board.snapshot
  const fromMs = snapshot?.fromMs ?? board.fromMs
  const toMs = snapshot?.toMs ?? board.toMs

  const canvasRef = useRef<HTMLDivElement | null>(null)
  const trackRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const episodeRefs = useRef<Map<string, HTMLElement>>(new Map())
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [edgeGeometries, setEdgeGeometries] = useState<ComputedDispatchEdgeGeometry[]>([])

  const clearFocus = useCallback(() => {
    setFocusedClusterId(null)
    setFocusedEpisodeId(null)
    setHovered(null)
  }, [])

  const openInspector = useCallback(
    (item: DispatchSelectedItem) => {
      clearFocus()
      setSelected(item)
    },
    [clearFocus],
  )

  useEffect(() => {
    clearFocus()
  }, [fromMs, toMs, clearFocus])

  useEffect(() => {
    if (selected !== null || (focusedClusterId === null && focusedEpisodeId === null)) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        clearFocus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected, focusedClusterId, focusedEpisodeId, clearFocus])

  const laneLabelMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const lane of snapshot?.lanes ?? []) {
      map.set(lane.workspaceId, lane.label)
    }
    return map
  }, [snapshot?.lanes])
  const laneLabel = useCallback((wsId: string) => laneLabelMap.get(wsId) ?? wsId, [laneLabelMap])

  const connectedArtifactRunIds = useMemo(() => {
    const set = new Set<string>()
    for (const art of snapshot?.artifacts ?? []) {
      if (art.runId) set.add(art.runId)
    }
    return set
  }, [snapshot?.artifacts])

  const connectedArtifactResumes = useMemo(() => {
    const set = new Set<string>()
    for (const art of snapshot?.artifacts ?? []) {
      if (art.resumeId) set.add(`${art.workspaceId}\0${art.resumeId}`)
    }
    return set
  }, [snapshot?.artifacts])

  const visibleEdges = useMemo(() => {
    const edges = snapshot?.edges ?? []
    if (filter === 'all' || filter === 'orchestration') return edges
    if (filter === 'attention') return edges.filter(isAttentionEdge)
    return []
  }, [snapshot?.edges, filter])

  const visibleSpans = useMemo(() => {
    const spans = snapshot?.spans ?? []
    if (filter === 'all') return spans
    if (filter === 'orchestration') {
      return spans.filter(
        (span) =>
          span.trigger.kind === 'orchestration'
          || span.trigger.kind === 'conversation'
          || visibleEdges.some((edge) => edgeConnectsSpan(edge, span)),
      )
    }
    if (filter === 'scheduled') {
      return spans.filter((span) => span.trigger.kind === 'scheduled-issue')
    }
    if (filter === 'outputs') {
      return spans.filter(
        (span) =>
          connectedArtifactRunIds.has(span.id)
          || connectedArtifactResumes.has(`${span.workspaceId}\0${span.resumeId}`),
      )
    }
    return spans.filter(
      (span) =>
        span.status === 'failed'
        || span.status === 'interrupted'
        || span.toolFailures > 0
        || Boolean(span.error)
        || visibleEdges.some((edge) => edgeConnectsSpan(edge, span)),
    )
  }, [
    snapshot?.spans,
    filter,
    visibleEdges,
    connectedArtifactRunIds,
    connectedArtifactResumes,
  ])

  const visibleArtifacts = useMemo(() => {
    const artifacts = snapshot?.artifacts ?? []
    if (filter === 'all' || filter === 'outputs') return artifacts
    if (filter === 'scheduled') return artifacts.filter((a) => a.kind === 'inbox' && Boolean(a.issueId))
    if (filter === 'orchestration') {
      const orchSpanIds = new Set(visibleSpans.map((s) => s.id))
      const orchResumes = new Set(visibleSpans.map((s) => `${s.workspaceId}\0${s.resumeId}`))
      return artifacts.filter(
        (a) =>
          (a.runId && orchSpanIds.has(a.runId))
          || (!a.runId && a.resumeId && orchResumes.has(`${a.workspaceId}\0${a.resumeId}`)),
      )
    }
    return []
  }, [snapshot?.artifacts, filter, visibleSpans])

  const laneLayouts = useMemo(() => {
    const lanes = snapshot?.lanes ?? []
    return lanes.map((lane) => {
      const laneSpans = visibleSpans.filter((s) => s.workspaceId === lane.workspaceId)
      const clustered = clusterLaneSpans(laneSpans, fromMs, toMs, {
        maxTracks: MAX_LANE_TRACKS,
      })
      const laneSchedules = (snapshot?.scheduleMarkers ?? []).filter(
        (m) => m.workspaceId === lane.workspaceId,
      )
      return {
        lane,
        clustered,
        schedules: laneSchedules,
      }
    })
  }, [snapshot?.lanes, snapshot?.scheduleMarkers, visibleSpans, fromMs, toMs])

  const allClusters = useMemo(
    () => laneLayouts.flatMap((l) => l.clustered.clusters),
    [laneLayouts],
  )

  const episodes = useMemo(
    () => buildDispatchEpisodes(visibleSpans, visibleEdges, visibleArtifacts),
    [visibleSpans, visibleEdges, visibleArtifacts],
  )

  const focusedCluster = useMemo(
    () => (focusedClusterId ? allClusters.find((c) => c.id === focusedClusterId) ?? null : null),
    [allClusters, focusedClusterId],
  )

  const focusedEpisode = useMemo(
    () => (focusedEpisodeId ? episodes.find((e) => e.id === focusedEpisodeId) ?? null : null),
    [episodes, focusedEpisodeId],
  )

  const focusTarget: DispatchFocusTarget = hovered ?? (
    selected?.kind === 'span'
      ? { kind: 'span', id: selected.item.id }
      : selected?.kind === 'edge'
        ? { kind: 'edge', id: selected.item.id }
        : selected?.kind === 'artifact'
          ? { kind: 'artifact', id: selected.item.id }
          : focusedCluster
            ? {
                kind: 'group',
                spanIds: focusedCluster.spans.map((s) => s.id),
                edgeIds: [],
                artifactIds: [],
              }
            : focusedEpisode
              ? {
                  kind: 'group',
                  spanIds: focusedEpisode.spanIds,
                  edgeIds: focusedEpisode.kind === 'orchestration' ? focusedEpisode.edgeIds : [],
                  artifactIds: focusedEpisode.artifactIds,
                }
              : null
  )

  const trace = useMemo(
    () => collectConnectedTraceIds(visibleSpans, visibleEdges, visibleArtifacts, focusTarget),
    [visibleSpans, visibleEdges, visibleArtifacts, focusTarget],
  )

  const hasFocus = focusTarget !== null

  const recomputeEdges = useCallback(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) return
    const canvasRect = canvasEl.getBoundingClientRect()
    if (canvasRect.width <= 0 || canvasRect.height <= 0) {
      setCanvasSize({ width: 0, height: 0 })
      setEdgeGeometries([])
      return
    }
    setCanvasSize({ width: canvasRect.width, height: canvasRect.height })

    const trackBySpanId = new Map<string, number>()
    const spansByWorkspace = new Map<string, { span: DispatchSpan; track: number }[]>()
    for (const layout of laneLayouts) {
      const wsList: { span: DispatchSpan; track: number }[] = []
      for (const item of layout.clustered.spans) {
        trackBySpanId.set(item.span.id, item.track)
        wsList.push({ span: item.span, track: item.track })
      }
      for (const cluster of layout.clustered.clusters) {
        for (const s of cluster.spans) {
          trackBySpanId.set(s.id, cluster.track)
          wsList.push({ span: s, track: cluster.track })
        }
      }
      spansByWorkspace.set(layout.lane.workspaceId, wsList)
    }

    const findSpanTrackForEdge = (
      workspaceId: string,
      resumeId: string | undefined,
      at: number,
      taskId?: string,
    ): number => {
      if (taskId && trackBySpanId.has(taskId)) {
        return trackBySpanId.get(taskId)!
      }
      if (!resumeId) return 0
      const match = (spansByWorkspace.get(workspaceId) ?? []).find(
        ({ span }) =>
          span.resumeId === resumeId
          && at >= span.startedAt - 120_000
          && at <= (span.finishedAt ?? toMs) + 120_000,
      )
      return match?.track ?? 0
    }

    const rawEndpoints: RawDispatchEdgeEndpoint[] = []
    for (const edge of visibleEdges) {
      const fromTrackEl = trackRefs.current.get(edge.fromWorkspaceId)
      const toTrackEl = trackRefs.current.get(edge.toWorkspaceId)
      if (!fromTrackEl || !toTrackEl) continue
      const fromRect = fromTrackEl.getBoundingClientRect()
      const toRect = toTrackEl.getBoundingClientRect()
      if (fromRect.width <= 0 || toRect.width <= 0) continue

      const pct = Math.max(1, Math.min(99, clampTimePct(edge.at, fromMs, toMs))) / 100
      const fromTrackIdx = findSpanTrackForEdge(edge.fromWorkspaceId, edge.fromResumeId, edge.at)
      const toTrackIdx = findSpanTrackForEdge(
        edge.toWorkspaceId,
        edge.toResumeId,
        edge.at,
        edge.kind === 'dispatch' || edge.kind === 'conversation' ? edge.taskId : undefined,
      )

      const x1 = fromRect.left - canvasRect.left + pct * fromRect.width
      const y1 =
        fromRect.top - canvasRect.top
        + TRACK_TOP_PAD_PX
        + fromTrackIdx * (TRACK_HEIGHT_PX + TRACK_GAP_PX)
        + TRACK_HEIGHT_PX / 2
      const x2 = toRect.left - canvasRect.left + pct * toRect.width
      const y2 =
        toRect.top - canvasRect.top
        + TRACK_TOP_PAD_PX
        + toTrackIdx * (TRACK_HEIGHT_PX + TRACK_GAP_PX)
        + TRACK_HEIGHT_PX / 2

      rawEndpoints.push({ edge, x1, y1, x2, y2 })
    }
    setEdgeGeometries(layoutEdgeGeometries(rawEndpoints, canvasRect.width))
  }, [laneLayouts, visibleEdges, fromMs, toMs])

  useLayoutEffect(() => {
    recomputeEdges()
  }, [recomputeEdges])

  useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => recomputeEdges())
    observer.observe(canvasEl)
    return () => observer.disconnect()
  }, [recomputeEdges])

  const setTrackRef = useCallback((wsId: string, el: HTMLDivElement | null) => {
    if (el) trackRefs.current.set(wsId, el)
    else trackRefs.current.delete(wsId)
  }, [])

  const setEpisodeRef = useCallback((episodeId: string, el: HTMLElement | null) => {
    if (el) episodeRefs.current.set(episodeId, el)
    else episodeRefs.current.delete(episodeId)
  }, [])

  const handleFilterChange = useCallback(
    (nextFilter: DispatchFilterKind) => {
      setFilter(nextFilter)
      clearFocus()
    },
    [clearFocus],
  )

  const toggleBurstExpanded = useCallback(
    (episodeId: string) => {
      clearFocus()
      setExpandedBurstIds((prev) => {
        const next = new Set(prev)
        if (next.has(episodeId)) next.delete(episodeId)
        else next.add(episodeId)
        return next
      })
    },
    [clearFocus],
  )

  const handleClusterClick = useCallback(
    (cluster: DispatchSpanCluster) => {
      if (focusedClusterId === cluster.id) {
        const clusterRunsNewestFirst = [...cluster.spans].sort(
          (a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id),
        )
        const newestSpan = clusterRunsNewestFirst[0]
        clearFocus()
        if (newestSpan) {
          setSelected({ kind: 'span', item: newestSpan, siblings: clusterRunsNewestFirst })
        }
        return
      }

      const clusterSpanSet = new Set(cluster.spans.map((s) => s.id))
      const matchingEpisodes = episodes.filter((ep) =>
        ep.spanIds.some((id) => clusterSpanSet.has(id)),
      )

      setFocusedClusterId(cluster.id)
      const primaryEpisode = matchingEpisodes[0] ?? null
      setFocusedEpisodeId(primaryEpisode?.id ?? null)

      const burstIdsToExpand = matchingEpisodes
        .filter((ep) => ep.kind === 'burst')
        .map((ep) => ep.id)
      if (burstIdsToExpand.length > 0) {
        setExpandedBurstIds((prev) => {
          const next = new Set(prev)
          for (const id of burstIdsToExpand) next.add(id)
          return next
        })
      }

      if (primaryEpisode) {
        const el = episodeRefs.current.get(primaryEpisode.id)
        el?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
      }
    },
    [episodes, focusedClusterId, clearFocus],
  )

  if (board.loading && !snapshot) {
    return <CenteredLoading />
  }

  if (board.error && !snapshot) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-xs text-destructive">
        {t('issues.dispatch.loadError', { error: board.error })}
      </div>
    )
  }

  const ticks = [0, 0.25, 0.5, 0.75, 1]
  const spanMs = Math.max(1, toMs - fromMs)
  const nowPct = clampTimePct(Date.now(), fromMs, toMs)
  const isQuiet =
    snapshot !== null
    && snapshot.spans.length === 0
    && snapshot.edges.length === 0
    && snapshot.artifacts.length === 0

  const filterChips: readonly { id: DispatchFilterKind; label: string }[] = [
    { id: 'all', label: t('issues.dispatch.filterAll') },
    { id: 'orchestration', label: t('issues.dispatch.filterOrchestration') },
    { id: 'scheduled', label: t('issues.dispatch.filterScheduled') },
    { id: 'outputs', label: t('issues.dispatch.filterOutputs') },
    { id: 'attention', label: t('issues.dispatch.filterAttention') },
  ]

  const hasAnyVisibleItems =
    visibleSpans.length > 0 || visibleEdges.length > 0 || visibleArtifacts.length > 0

  const windowIncludeDate = isDifferentCalendarDay(fromMs, toMs) || spanMs >= 12 * 3_600_000

  const renderArtifactChip = (art: DispatchArtifact) => {
    const isEmphasized =
      selected?.kind === 'artifact' && selected.item.id === art.id
        ? true
        : hasFocus && trace.artifactIds.has(art.id)
    const isDimmed = hasFocus && !trace.artifactIds.has(art.id)
    return (
      <button
        key={art.id}
        type="button"
        data-testid={`dispatch-artifact-${art.id}`}
        onClick={() => openInspector({ kind: 'artifact', item: art })}
        onMouseEnter={() => setHovered({ kind: 'artifact', id: art.id })}
        onMouseLeave={() => setHovered(null)}
        className={`inline-flex max-w-64 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          art.kind === 'inbox'
            ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
            : 'border-border bg-background text-foreground hover:bg-muted/60'
        } ${isEmphasized ? 'ring-2 ring-primary/50' : ''} ${isDimmed ? 'opacity-40' : ''}`}
      >
        {art.kind === 'inbox' ? (
          <Inbox size={10} className="shrink-0" aria-hidden />
        ) : (
          <FileText size={10} className="shrink-0 text-muted-foreground" aria-hidden />
        )}
        {art.kind === 'inbox' && art.unread && (
          <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
        )}
        <span className="truncate">{art.kind === 'inbox' ? art.title : art.path}</span>
        <span className="shrink-0 font-mono text-[10px] opacity-75">
          {formatClockPoint(art.at, {
            includeDate: isDifferentCalendarDay(art.at, toMs),
            locale,
          })}
        </span>
      </button>
    )
  }

  const isEpisodeEmphasized = (ep: DispatchEpisode): boolean => {
    if (focusedEpisodeId === ep.id) return true
    if (!hasFocus) return false
    return (
      ep.spanIds.some((id) => trace.spanIds.has(id))
      || (ep.kind === 'orchestration' && ep.edgeIds.some((id) => trace.edgeIds.has(id)))
      || ep.artifactIds.some((id) => trace.artifactIds.has(id))
    )
  }

  return (
    <div data-testid="dispatch-board" className="@container/dispatch space-y-3 px-2 pb-6">
      {board.error && snapshot && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning">
          {t('issues.dispatch.stale')}
        </div>
      )}

      {/* Lightweight borderless filter strip & summary stats */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 py-0.5">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('issues.dispatch.title')}>
          {filterChips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              aria-pressed={filter === chip.id}
              onClick={() => handleFilterChange(chip.id)}
              className={`inline-flex h-7 items-center rounded-full px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                filter === chip.id
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {snapshot && (
          <div className="flex flex-wrap items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
            <span>{t('issues.dispatch.activeWorkspaces', { count: snapshot.summary.activeWorkspaceCount })}</span>
            <span>{t('issues.dispatch.runs', { count: snapshot.summary.totalSpanCount })}</span>
            <span>{t('issues.dispatch.messages', { count: snapshot.summary.edgeCount })}</span>
            <span>{t('issues.dispatch.outputs', { count: snapshot.summary.artifactCount })}</span>
            {snapshot.summary.errorSpanCount > 0 && (
              <span className="font-medium text-destructive">
                {t('issues.dispatch.failedCount', { count: snapshot.summary.errorSpanCount })}
              </span>
            )}
            {snapshot.summary.runningSpanCount > 0 && (
              <span className="inline-flex items-center gap-1 font-medium text-primary">
                <span className="size-1.5 rounded-full bg-primary animate-pulse motion-reduce:animate-none" aria-hidden />
                {t('issues.dispatch.runningNow', { count: snapshot.summary.runningSpanCount })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Empty active workspaces */}
      {snapshot && snapshot.lanes.length === 0 && (
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">{t('issues.dispatch.noActiveWorkspaces')}</p>
        </div>
      )}

      {/* Quiet window notice (still keeps active lanes visible below) */}
      {isQuiet && snapshot.lanes.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-muted/15 px-4 py-3 text-xs">
          <div>
            <p className="font-medium text-foreground">{t('issues.dispatch.quietTitle')}</p>
            <p className="mt-0.5 text-muted-foreground">
              {t('issues.dispatch.quietHint', {
                from: formatClockPoint(fromMs, { includeDate: windowIncludeDate, locale }),
                to: formatClockPoint(toMs, { includeDate: windowIncludeDate, locale }),
              })}
            </p>
          </div>
          {board.preset !== '24h' && (
            <Button type="button" size="sm" variant="outline" onClick={() => board.setPreset('24h')}>
              {t('issues.dispatch.expandTo24h')}
            </Button>
          )}
        </div>
      )}

      {!isQuiet && filter !== 'all' && !hasAnyVisibleItems && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-muted/15 px-4 py-3 text-xs">
          <p className="text-muted-foreground">{t('issues.dispatch.noFilterMatches')}</p>
          <Button type="button" size="sm" variant="ghost" onClick={() => handleFilterChange('all')}>
            {t('issues.dispatch.clearFilter')}
          </Button>
        </div>
      )}

      {/* Zone 1: Compact Active-Workspace Swimlane Map */}
      {snapshot && snapshot.lanes.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border/70 bg-background">
          {/* Time Ruler */}
          <div className="hidden border-b border-border/60 bg-muted/30 @[42rem]/dispatch:flex">
            <div className="w-48 shrink-0 border-r border-border/60 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
              {t('issues.dispatch.workspaceLabel')}
            </div>
            <div className="relative flex-1 py-1.5">
              <div className="relative h-4 font-mono text-[10px] tabular-nums text-muted-foreground">
                {ticks.map((frac) => {
                  const posClass =
                    frac === 0
                      ? 'left-3'
                      : frac === 1
                        ? 'right-3'
                        : '-translate-x-1/2'
                  return (
                    <span
                      key={frac}
                      className={`absolute top-0 whitespace-nowrap ${posClass}`}
                      style={frac > 0 && frac < 1 ? { left: `${frac * 100}%` } : undefined}
                    >
                      {formatTickTime(fromMs + spanMs * frac, spanMs, fromMs, toMs, locale)}
                    </span>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Lanes + SVG Overlay */}
          <div ref={canvasRef} className="relative divide-y divide-border/60">
            {laneLayouts.map(({ lane, clustered, schedules }) => {
              const laneBodyHeight = Math.max(
                MIN_LANE_HEIGHT_PX,
                TRACK_TOP_PAD_PX * 2
                  + clustered.trackCount * TRACK_HEIGHT_PX
                  + Math.max(0, clustered.trackCount - 1) * TRACK_GAP_PX,
              )
              const nextDue = schedules
                .filter((s) => s.nextDueAtMs !== null)
                .sort((a, b) => (a.nextDueAtMs ?? Infinity) - (b.nextDueAtMs ?? Infinity))[0]
              const skippedSchedule = schedules.find((s) => s.skipState)
              const showDistinctTag = Boolean(lane.tag && lane.tag !== lane.label)

              return (
                <section
                  key={lane.workspaceId}
                  data-testid={`dispatch-lane-${lane.workspaceId}`}
                  className="flex flex-col @[42rem]/dispatch:flex-row"
                >
                  {/* Compact lane header */}
                  <div className="flex shrink-0 flex-col justify-center gap-1.5 border-b border-border/50 bg-muted/15 px-3 py-2 @[42rem]/dispatch:w-48 @[42rem]/dispatch:border-b-0 @[42rem]/dispatch:border-r">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
                        <h3 className="truncate text-xs font-semibold text-foreground" title={lane.label}>
                          {lane.label}
                        </h3>
                      </div>
                      {showDistinctTag && (
                        <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                          {lane.tag}
                        </p>
                      )}
                    </div>

                    {(skippedSchedule || nextDue) && (
                      <div className="flex flex-wrap items-center gap-1">
                        {skippedSchedule?.skipState && (
                          <button
                            type="button"
                            onClick={() => openInspector({ kind: 'schedule', item: skippedSchedule })}
                            className="text-left"
                          >
                            <ScheduleSkipPill skipState={skippedSchedule.skipState} />
                          </button>
                        )}
                        {nextDue && nextDue.nextDueAtMs !== null && (
                          <button
                            type="button"
                            onClick={() => openInspector({ kind: 'schedule', item: nextDue })}
                            className="inline-flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                            title={nextDue.title}
                          >
                            <Clock size={10} className="shrink-0" aria-hidden />
                            <span className="truncate tabular-nums">
                              {t('issues.dispatch.scheduledDue', {
                                time: formatClockPoint(nextDue.nextDueAtMs, {
                                  includeDate: isDifferentCalendarDay(nextDue.nextDueAtMs, toMs),
                                  locale,
                                }),
                              })}
                            </span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Timeline track body (capped to maxTracks = 2) */}
                  <div className="min-w-0 flex-1">
                    <div
                      ref={(el) => setTrackRef(lane.workspaceId, el)}
                      className="relative w-full"
                      style={{ minHeight: laneBodyHeight }}
                    >
                      {ticks.slice(1, -1).map((frac) => (
                        <div
                          key={frac}
                          aria-hidden
                          className="pointer-events-none absolute inset-y-0 border-l border-dashed border-border/40"
                          style={{ left: `${frac * 100}%` }}
                        />
                      ))}

                      {nowPct > 0 && nowPct < 100 && (
                        <div
                          aria-hidden
                          className="pointer-events-none absolute inset-y-0 z-[1] border-l border-primary/40"
                          style={{ left: `${nowPct}%` }}
                        />
                      )}

                      {schedules.map((marker) => {
                        if (marker.nextDueAtMs === null || marker.nextDueAtMs < fromMs || marker.nextDueAtMs > toMs) {
                          return null
                        }
                        const rawPct = clampTimePct(marker.nextDueAtMs, fromMs, toMs)
                        const pct = Math.max(4, Math.min(96, rawPct))
                        const formattedDue = formatClockPoint(marker.nextDueAtMs, {
                          includeDate: isDifferentCalendarDay(marker.nextDueAtMs, toMs),
                          locale,
                        })
                        return (
                          <button
                            key={`sched-${marker.issueId}`}
                            type="button"
                            onClick={() => openInspector({ kind: 'schedule', item: marker })}
                            title={`${marker.title} · ${formattedDue}`}
                            className="absolute top-1 z-10 -translate-x-1/2 rounded-full border border-dashed border-border bg-background/90 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-foreground/50 hover:text-foreground"
                            style={{ left: `${pct}%` }}
                          >
                            <Clock size={9} className="mr-0.5 inline" aria-hidden />
                            {formattedDue}
                          </button>
                        )
                      })}

                      {/* Unclustered execution spans */}
                      {clustered.spans.map(({ span, track, leftPct, widthPct }: PackedDispatchSpan) => {
                        const isEmphasized =
                          selected?.kind === 'span' && selected.item.id === span.id
                            ? true
                            : hasFocus && trace.spanIds.has(span.id)
                        const isDimmed = hasFocus && !trace.spanIds.has(span.id)
                        const topPx = TRACK_TOP_PAD_PX + track * (TRACK_HEIGHT_PX + TRACK_GAP_PX)

                        return (
                          <button
                            key={span.id}
                            type="button"
                            data-testid={`dispatch-span-${span.id}`}
                            onClick={() => openInspector({ kind: 'span', item: span })}
                            onMouseEnter={() => setHovered({ kind: 'span', id: span.id })}
                            onMouseLeave={() => setHovered(null)}
                            className={spanBarClasses(span, isEmphasized, isDimmed)}
                            style={{
                              top: topPx,
                              height: TRACK_HEIGHT_PX,
                              left: `${leftPct}%`,
                              width: `${widthPct}%`,
                            }}
                            title={`${spanTitle(span, t)} (${span.agent})`}
                          >
                            {span.status === 'running' && (
                              <span
                                className="size-1.5 shrink-0 rounded-full bg-primary animate-pulse motion-reduce:animate-none"
                                aria-hidden
                              />
                            )}
                            {span.status === 'failed' && (
                              <AlertTriangle size={11} className="shrink-0 text-destructive" aria-hidden />
                            )}
                            <SpanTriggerIcon trigger={span.trigger} />
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {spanTitle(span, t)}
                            </span>
                          </button>
                        )
                      })}

                      {/* Collapsed burst cluster pills */}
                      {clustered.clusters.map((cluster) => {
                        const isEmphasized =
                          focusedClusterId === cluster.id
                          || (hasFocus && cluster.spans.some((s) => trace.spanIds.has(s.id)))
                        const isDimmed =
                          hasFocus && !cluster.spans.some((s) => trace.spanIds.has(s.id))
                        const topPx = TRACK_TOP_PAD_PX + cluster.track * (TRACK_HEIGHT_PX + TRACK_GAP_PX)
                        const anchorRight = cluster.leftPct > 86
                        const labelText =
                          cluster.worstStatus === 'failed' || cluster.worstStatus === 'interrupted'
                            ? `×${cluster.count}`
                            : t('issues.dispatch.clusterRuns', { count: cluster.count })
                        const titleText = t('issues.dispatch.clusterTitle', {
                          count: cluster.count,
                          status: statusLabel(cluster.worstStatus, t),
                        })

                        return (
                          <button
                            key={cluster.id}
                            type="button"
                            data-testid={`dispatch-cluster-${cluster.id}`}
                            aria-label={titleText}
                            title={titleText}
                            onClick={() => handleClusterClick(cluster)}
                            onMouseEnter={() =>
                              setHovered({
                                kind: 'group',
                                spanIds: cluster.spans.map((s) => s.id),
                                edgeIds: [],
                                artifactIds: [],
                              })
                            }
                            onMouseLeave={() => setHovered(null)}
                            className={clusterPillClasses(cluster, isEmphasized, isDimmed)}
                            style={{
                              top: topPx,
                              height: TRACK_HEIGHT_PX,
                              ...(anchorRight
                                ? { right: `${Math.max(0.5, 100 - (cluster.leftPct + cluster.widthPct))}%` }
                                : { left: `${cluster.leftPct}%` }),
                            }}
                          >
                            {cluster.worstStatus === 'failed' && (
                              <AlertTriangle size={11} className="shrink-0" aria-hidden />
                            )}
                            {cluster.worstStatus === 'interrupted' && (
                              <Pause size={11} className="shrink-0" aria-hidden />
                            )}
                            {cluster.worstStatus === 'running' && (
                              <span
                                className="size-1.5 shrink-0 rounded-full bg-primary animate-pulse motion-reduce:animate-none"
                                aria-hidden
                              />
                            )}
                            {cluster.worstStatus === 'done' && (
                              <Layers size={11} className="shrink-0 text-muted-foreground" aria-hidden />
                            )}
                            <span className="tabular-nums">{labelText}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </section>
              )
            })}

            {/* SVG Causal Curves Overlay */}
            {canvasSize.width > 0 && canvasSize.height > 0 && edgeGeometries.length > 0 && (
              <>
                <svg
                  width={canvasSize.width}
                  height={canvasSize.height}
                  className="pointer-events-none absolute inset-0 z-10 overflow-visible"
                  aria-hidden
                >
                  <defs>
                    <marker id="dispatch-arrow-primary" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" className="fill-primary" />
                    </marker>
                    <marker id="dispatch-arrow-warning" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" className="fill-warning" />
                    </marker>
                    <marker id="dispatch-arrow-success" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" className="fill-success" />
                    </marker>
                    <marker id="dispatch-arrow-destructive" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" className="fill-destructive" />
                    </marker>
                  </defs>
                  {edgeGeometries.map(({ edge, x1, y1, x2, y2, ctrlX1, ctrlX2 }) => {
                    const d = `M ${x1} ${y1} C ${ctrlX1} ${y1}, ${ctrlX2} ${y2}, ${x2} ${y2}`
                    const isDimmed = hasFocus && !trace.edgeIds.has(edge.id)
                    const markerId =
                      edge.kind === 'escalation'
                        ? 'url(#dispatch-arrow-destructive)'
                        : edge.kind === 'question'
                          ? 'url(#dispatch-arrow-warning)'
                          : edge.kind === 'worker_done' || edge.kind === 'reply'
                            ? 'url(#dispatch-arrow-success)'
                            : 'url(#dispatch-arrow-primary)'

                    return (
                      <path
                        key={edge.id}
                        d={d}
                        fill="none"
                        strokeWidth={hasFocus && trace.edgeIds.has(edge.id) ? 2.2 : 1.5}
                        strokeDasharray={edge.kind === 'conversation' ? '4 3' : undefined}
                        markerEnd={markerId}
                        className={`${edgeStrokeClass(edge.kind)} transition-opacity ${isDimmed ? 'opacity-20' : 'opacity-80'}`}
                      />
                    )
                  })}
                </svg>

                {edgeGeometries.map(({ edge, mx, my }) => {
                  const isEmphasized =
                    selected?.kind === 'edge' && selected.item.id === edge.id
                      ? true
                      : hasFocus && trace.edgeIds.has(edge.id)
                  const isDimmed = hasFocus && !trace.edgeIds.has(edge.id)
                  const pendingMailbox = edge.deliveryStatus === 'unread' || edge.deliveryStatus === 'leased'
                  return (
                    <button
                      key={`pill-${edge.id}`}
                      type="button"
                      data-testid={`dispatch-edge-${edge.id}`}
                      onClick={() => openInspector({ kind: 'edge', item: edge })}
                      onMouseEnter={() => setHovered({ kind: 'edge', id: edge.id })}
                      onMouseLeave={() => setHovered(null)}
                      style={{ left: mx, top: my }}
                      className={`absolute -translate-x-1/2 -translate-y-1/2 ${edgePillClasses(edge, isEmphasized, isDimmed)}`}
                      title={edge.subject || edge.body || edge.spec}
                    >
                      {pendingMailbox && (
                        <span className="size-1.5 rounded-full bg-warning animate-pulse motion-reduce:animate-none" aria-hidden />
                      )}
                      {edgeKindLabel(edge.kind, t)}
                    </button>
                  )
                })}
              </>
            )}
          </div>
        </div>
      )}

      {/* Zone 2: Structured Causal Episode Feed */}
      {episodes.length > 0 && (
        <section className="space-y-2" aria-label={t('issues.dispatch.feedTitle')}>
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold text-foreground">
              {t('issues.dispatch.feedTitle')}
            </h2>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {t('issues.dispatch.feedCount', { count: episodes.length })}
            </span>
          </div>

          <div className="space-y-2">
            {episodes.map((ep) => {
              const emphasized = isEpisodeEmphasized(ep)
              const cardRing = emphasized
                ? 'border-primary/60 bg-primary/[0.04] ring-1 ring-primary/30'
                : 'border-border/70 bg-background hover:border-border'
              const dimClass = hasFocus && !emphasized ? 'opacity-65' : 'opacity-100'

              if (ep.kind === 'orchestration') {
                return (
                  <article
                    key={ep.id}
                    ref={(el) => setEpisodeRef(ep.id, el)}
                    data-testid={`dispatch-episode-${ep.id}`}
                    onMouseEnter={() =>
                      setHovered({
                        kind: 'group',
                        spanIds: ep.spanIds,
                        edgeIds: ep.edgeIds,
                        artifactIds: ep.artifactIds,
                      })
                    }
                    onMouseLeave={() => setHovered(null)}
                    className={`rounded-lg border transition-all ${cardRing} ${dimClass}`}
                  >
                    {/* Episode Header / Coordinator */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
                      {ep.coordinator ? (
                        <button
                          type="button"
                          data-testid={`dispatch-feed-span-${ep.coordinator.span.id}`}
                          onClick={() => openInspector({ kind: 'span', item: ep.coordinator!.span })}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                        >
                          <GitFork size={13} className="shrink-0 text-primary" aria-hidden />
                          <SpanStatusIcon status={ep.coordinator.span.status} />
                          <span className="truncate text-xs font-semibold text-foreground">
                            {spanTitle(ep.coordinator.span, t)}
                          </span>
                          <span className="shrink-0 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                            {t('issues.dispatch.episodeOrchestration')}
                          </span>
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {laneLabel(ep.coordinator.span.workspaceId)}
                          </span>
                          <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                            {ep.coordinator.span.agent}
                            {ep.coordinator.span.model ? ` · ${ep.coordinator.span.model}` : ''}
                          </span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={clearFocus}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                        >
                          <GitFork size={13} className="shrink-0 text-primary" aria-hidden />
                          <span className="truncate text-xs font-semibold text-foreground">
                            {t('issues.dispatch.coordinatorFallback')}
                          </span>
                          <span className="shrink-0 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                            {t('issues.dispatch.episodeOrchestration')}
                          </span>
                        </button>
                      )}

                      <div className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
                        {ep.coordinator && (
                          <span>{formatDurationMs(ep.coordinator.span.durationMs)}</span>
                        )}
                        <span className="font-mono">
                          {formatClockPoint(ep.latestAt, {
                            includeDate: isDifferentCalendarDay(ep.latestAt, toMs),
                            includeSeconds: true,
                            locale,
                          })}
                        </span>
                      </div>
                    </div>

                    {/* Worker runs */}
                    {ep.workers.length > 0 && (
                      <div className="divide-y divide-border/40">
                        {ep.workers.map(({ span }) => {
                          const snippet = snippetText(span)
                          return (
                            <button
                              key={span.id}
                              type="button"
                              data-testid={`dispatch-feed-span-${span.id}`}
                              onClick={() => openInspector({ kind: 'span', item: span })}
                              className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <SpanStatusIcon status={span.status} />
                                  <span className="truncate text-xs font-medium text-foreground">
                                    {spanTitle(span, t)}
                                  </span>
                                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                    {laneLabel(span.workspaceId)}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground">
                                    {span.agent}
                                    {span.model ? ` · ${span.model}` : ''}
                                  </span>
                                </div>
                                {snippet && (
                                  <p className={`truncate text-[11px] ${span.error ? 'text-destructive' : 'text-muted-foreground'}`}>
                                    {snippet}
                                  </p>
                                )}
                              </div>
                              <div className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
                                <span>{formatDurationMs(span.durationMs)}</span>
                                <span className="font-mono">
                                  {formatClockPoint(span.startedAt, {
                                    includeDate: isDifferentCalendarDay(span.startedAt, toMs),
                                    includeSeconds: true,
                                    locale,
                                  })}
                                </span>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}

                    {/* Inline message chips + attached outputs */}
                    {(ep.edges.length > 0 || ep.artifacts.length > 0) && (
                      <div className="flex flex-wrap items-center gap-1.5 border-t border-border/50 bg-muted/15 px-3 py-2">
                        {ep.edges.map((edge, idx) => {
                          const edgeEmphasized =
                            selected?.kind === 'edge' && selected.item.id === edge.id
                              ? true
                              : hasFocus && trace.edgeIds.has(edge.id)
                          const edgeDimmed = hasFocus && !trace.edgeIds.has(edge.id)
                          return (
                            <span key={edge.id} className="inline-flex items-center gap-1">
                              {idx > 0 && (
                                <span className="text-[10px] text-muted-foreground/60" aria-hidden>
                                  →
                                </span>
                              )}
                              <button
                                type="button"
                                data-testid={`dispatch-edge-chip-${edge.id}`}
                                onClick={() => openInspector({ kind: 'edge', item: edge })}
                                onMouseEnter={() => setHovered({ kind: 'edge', id: edge.id })}
                                onMouseLeave={() => setHovered(null)}
                                className={edgePillClasses(edge, edgeEmphasized, edgeDimmed)}
                                title={edge.subject || edge.body || edge.spec}
                              >
                                <span>{edgeKindLabel(edge.kind, t)}</span>
                                <span className="font-mono text-[10px] opacity-75">
                                  {formatClockPoint(edge.at, {
                                    includeDate: isDifferentCalendarDay(edge.at, toMs),
                                    locale,
                                  })}
                                </span>
                              </button>
                            </span>
                          )
                        })}
                        {ep.edges.length > 0 && ep.artifacts.length > 0 && (
                          <span className="mx-1 h-3.5 w-px bg-border" aria-hidden />
                        )}
                        {ep.artifacts.map(renderArtifactChip)}
                      </div>
                    )}
                  </article>
                )
              }

              if (ep.kind === 'burst') {
                const isExpanded = expandedBurstIds.has(ep.id)
                const burstRange = formatBurstClockSpan(ep.startedAt, ep.endedAt, toMs, locale)
                const burstBadgeText = t('issues.dispatch.burstStatusCount', {
                  status: statusLabel(ep.status, t),
                  count: ep.runs.length,
                })
                const burstTitle =
                  ep.burstKind === 'wave'
                    ? ep.distinctIssueCount !== undefined
                      ? t('issues.dispatch.scheduledWaveTitle', { count: ep.distinctIssueCount })
                      : t('issues.dispatch.executionWaveTitle', { count: ep.runs.length })
                    : ep.title
                const burstSiblings = ep.runs.map((r) => r.span)

                return (
                  <article
                    key={ep.id}
                    ref={(el) => setEpisodeRef(ep.id, el)}
                    data-testid={`dispatch-episode-${ep.id}`}
                    onMouseEnter={() =>
                      setHovered({
                        kind: 'group',
                        spanIds: ep.spanIds,
                        edgeIds: [],
                        artifactIds: ep.artifactIds,
                      })
                    }
                    onMouseLeave={() => setHovered(null)}
                    className={`rounded-lg border transition-all ${cardRing} ${dimClass}`}
                  >
                    <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        onClick={() => toggleBurstExpanded(ep.id)}
                        className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusBadgeClasses(ep.status)}`}
                            >
                              {ep.status === 'failed' && <AlertTriangle size={11} aria-hidden />}
                              {ep.status === 'running' && (
                                <span
                                  className="size-1.5 rounded-full bg-current animate-pulse motion-reduce:animate-none"
                                  aria-hidden
                                />
                              )}
                              <span>{burstBadgeText}</span>
                            </span>
                            <span className="truncate font-semibold text-foreground">
                              {burstTitle}
                            </span>
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {laneLabel(ep.workspaceId)}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {ep.agent}
                              {ep.model ? ` · ${ep.model}` : ''}
                            </span>
                            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                              {burstRange}
                            </span>
                          </div>
                          {(ep.error || ep.preview) && (
                            <p className={`truncate text-[11px] ${ep.error ? 'text-destructive' : 'text-muted-foreground'}`}>
                              {ep.error || ep.preview}
                            </p>
                          )}
                        </div>

                        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-[11px] font-medium text-foreground">
                          {isExpanded
                            ? t('issues.dispatch.collapseRuns')
                            : t('issues.dispatch.showRuns', { count: ep.runs.length })}
                          {isExpanded ? <ChevronUp size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />}
                        </span>
                      </button>

                      {ep.artifacts.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {ep.artifacts.map(renderArtifactChip)}
                        </div>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="divide-y divide-border/50 border-t border-border/60 bg-muted/15">
                        {ep.runs.map(({ span }) => {
                          const runTitle = spanTitle(span, t)
                          const runSnippet = snippetText(span)
                          const cleanSession = burstRunSessionLabel(span, runTitle, runSnippet)
                          return (
                            <button
                              key={span.id}
                              type="button"
                              data-testid={`dispatch-feed-span-${span.id}`}
                              onClick={() => openInspector({ kind: 'span', item: span, siblings: burstSiblings })}
                              className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-xs transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <div className="flex min-w-0 flex-1 items-center gap-2">
                                <SpanStatusIcon status={span.status} />
                                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                                  {formatClockPoint(span.startedAt, {
                                    includeDate: isDifferentCalendarDay(span.startedAt, toMs),
                                    includeSeconds: true,
                                    locale,
                                  })}
                                </span>
                                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                                  {formatDurationMs(span.durationMs)}
                                </span>
                                {(ep.burstKind === 'wave' || runTitle !== burstTitle) && (
                                  <span className="max-w-52 shrink-0 truncate font-medium text-foreground">
                                    {runTitle}
                                  </span>
                                )}
                                {cleanSession && (
                                  <span className="max-w-48 shrink-0 truncate text-[11px] text-foreground/80">
                                    {cleanSession}
                                  </span>
                                )}
                                {runSnippet && (
                                  <span className={`min-w-0 flex-1 truncate text-[11px] ${span.error ? 'text-destructive' : 'text-muted-foreground'}`}>
                                    {runSnippet}
                                  </span>
                                )}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </article>
                )
              }

              if (ep.kind === 'execution') {
                const { span, artifacts: runArtifacts }: DispatchExecutionItem = ep.execution
                const snippet = snippetText(span)

                return (
                  <article
                    key={ep.id}
                    ref={(el) => setEpisodeRef(ep.id, el)}
                    data-testid={`dispatch-episode-${ep.id}`}
                    onMouseEnter={() =>
                      setHovered({
                        kind: 'group',
                        spanIds: ep.spanIds,
                        edgeIds: [],
                        artifactIds: ep.artifactIds,
                      })
                    }
                    onMouseLeave={() => setHovered(null)}
                    className={`flex flex-col gap-2 rounded-lg border px-3 py-2.5 transition-all sm:flex-row sm:items-center sm:justify-between ${cardRing} ${dimClass}`}
                  >
                    <button
                      type="button"
                      data-testid={`dispatch-feed-span-${span.id}`}
                      onClick={() => openInspector({ kind: 'span', item: span })}
                      className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <SpanStatusIcon status={span.status} />
                          <span className="truncate font-semibold text-foreground">
                            {spanTitle(span, t)}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            <SpanTriggerIcon trigger={span.trigger} />
                            {triggerKindLabel(span.trigger.kind, t)}
                          </span>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {laneLabel(span.workspaceId)}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {span.agent}
                            {span.model ? ` · ${span.model}` : ''}
                          </span>
                        </div>
                        {snippet && (
                          <p className={`truncate text-[11px] ${span.error ? 'text-destructive' : 'text-muted-foreground'}`}>
                            {snippet}
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
                        <span>{formatDurationMs(span.durationMs)}</span>
                        <span className="font-mono">
                          {formatClockPoint(span.startedAt, {
                            includeDate: isDifferentCalendarDay(span.startedAt, toMs),
                            includeSeconds: true,
                            locale,
                          })}
                        </span>
                      </div>
                    </button>

                    {runArtifacts.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0">
                        {runArtifacts.map(renderArtifactChip)}
                      </div>
                    )}
                  </article>
                )
              }

              // Standalone artifact output row
              const art = ep.artifact
              const summary = artifactSnippet(art)

              return (
                <article
                  key={ep.id}
                  ref={(el) => setEpisodeRef(ep.id, el)}
                  data-testid={`dispatch-episode-${ep.id}`}
                  onMouseEnter={() =>
                    setHovered({
                      kind: 'artifact',
                      id: art.id,
                    })
                  }
                  onMouseLeave={() => setHovered(null)}
                  className={`rounded-lg border px-3 py-2.5 transition-all ${cardRing} ${dimClass}`}
                >
                  <button
                    type="button"
                    data-testid={`dispatch-artifact-${art.id}`}
                    onClick={() => openInspector({ kind: 'artifact', item: art })}
                    className="flex w-full items-start justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        {art.kind === 'inbox' ? (
                          <Inbox size={13} className="shrink-0 text-primary" aria-hidden />
                        ) : (
                          <FileText size={13} className="shrink-0 text-muted-foreground" aria-hidden />
                        )}
                        <span className="truncate font-semibold text-foreground">
                          {art.kind === 'inbox' ? art.title : art.path}
                        </span>
                        <span className="rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {art.kind === 'inbox'
                            ? t('issues.dispatch.artifactInboxBadge')
                            : t('issues.dispatch.artifactReportBadge')}
                        </span>
                        {art.kind === 'inbox' && art.unread && (
                          <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                            {t('issues.dispatch.inboxUnread')}
                          </span>
                        )}
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {laneLabel(art.workspaceId)}
                        </span>
                      </div>
                      {summary && (
                        <p className="truncate text-[11px] text-muted-foreground">{summary}</p>
                      )}
                    </div>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                      {formatClockPoint(art.at, {
                        includeDate: isDifferentCalendarDay(art.at, toMs),
                        includeSeconds: true,
                        locale,
                      })}
                    </span>
                  </button>
                </article>
              )
            })}
          </div>
        </section>
      )}

      <DispatchInspectorSheet
        selected={selected}
        snapshot={snapshot}
        onSelect={setSelected}
        onClose={() => {
          setSelected(null)
          clearFocus()
        }}
      />
    </div>
  )
}
