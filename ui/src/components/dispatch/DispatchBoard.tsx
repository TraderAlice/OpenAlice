import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  GitFork,
  Inbox,
  MessageSquare,
  Radio,
  RefreshCw,
  Terminal,
} from 'lucide-react'

import type {
  DispatchArtifact,
  DispatchBoardSnapshot,
  DispatchEdge,
  DispatchEdgeKind,
  DispatchLane,
  DispatchScheduleMarker,
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
  clampTimePct,
  collectConnectedTraceIds,
  packSpansIntoTracks,
  type DispatchFocusTarget,
  type PackedDispatchSpan,
} from './layout'
import type { DispatchWindowPreset, UseDispatchBoardResult } from './useDispatchBoard'

export type DispatchFilterKind = 'all' | 'orchestration' | 'scheduled' | 'outputs' | 'attention'

const TRACK_HEIGHT_PX = 28
const TRACK_GAP_PX = 4
const TRACK_TOP_PAD_PX = 6

function formatClockRange(ms: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms))
}

function formatTickTime(ms: number, spanMs: number): string {
  const date = new Date(ms)
  if (spanMs >= 18 * 60 * 60_000) {
    return new Intl.DateTimeFormat(undefined, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date)
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function spanTitle(span: DispatchSpan, t: TFunction): string {
  if (span.trigger.kind === 'scheduled-issue') {
    return span.trigger.issueTitle || `#${span.trigger.issueId}`
  }
  if (span.trigger.kind === 'inquiry') {
    return span.trigger.question
  }
  if (span.sessionLabel) return span.sessionLabel
  if (span.trigger.kind === 'orchestration') {
    return `${t('issues.dispatch.triggerOrchestration')} (${span.agent})`
  }
  return span.agent
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

function matchesSpanFilter(
  span: DispatchSpan,
  filter: DispatchFilterKind,
  connectedArtifactRunIds: ReadonlySet<string>,
  connectedArtifactResumes: ReadonlySet<string>,
): boolean {
  if (filter === 'all') return true
  if (filter === 'orchestration') {
    return span.trigger.kind === 'orchestration' || span.trigger.kind === 'conversation'
  }
  if (filter === 'scheduled') {
    return span.trigger.kind === 'scheduled-issue'
  }
  if (filter === 'outputs') {
    return connectedArtifactRunIds.has(span.id)
      || connectedArtifactResumes.has(`${span.workspaceId}\0${span.resumeId}`)
  }
  if (filter === 'attention') {
    return span.status === 'failed' || span.status === 'interrupted' || span.toolFailures > 0
  }
  return true
}

function matchesEdgeFilter(edge: DispatchEdge, filter: DispatchFilterKind): boolean {
  if (filter === 'all') return true
  if (filter === 'orchestration') return true
  if (filter === 'attention') {
    return edge.kind === 'escalation'
      || edge.deliveryStatus === 'unread'
      || edge.taskStatus === 'waiting_parent'
      || edge.outcome === 'failed'
  }
  return false
}

export function DispatchToolbarControls({ board }: { board: UseDispatchBoardResult }) {
  const { t } = useTranslation()
  const presets: readonly DispatchWindowPreset[] = ['1h', '6h', '24h']
  const rangeLabel = `${formatClockRange(board.fromMs)} – ${formatClockRange(board.toMs)}`

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="inline-flex rounded-full border border-border bg-background p-0.5" role="group" aria-label={t('issues.dispatch.title')}>
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

interface ComputedEdgeGeometry {
  readonly edge: DispatchEdge
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
  readonly mx: number
  readonly my: number
}

export function DispatchBoard({ board }: { board: UseDispatchBoardResult }) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<DispatchFilterKind>('all')
  const [selected, setSelected] = useState<DispatchSelectedItem>(null)
  const [hovered, setHovered] = useState<DispatchFocusTarget>(null)

  const snapshot = board.snapshot
  const fromMs = snapshot?.fromMs ?? board.fromMs
  const toMs = snapshot?.toMs ?? board.toMs

  const canvasRef = useRef<HTMLDivElement | null>(null)
  const trackRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [edgeGeometries, setEdgeGeometries] = useState<ComputedEdgeGeometry[]>([])

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

  const visibleSpans = useMemo(() => {
    const spans = snapshot?.spans ?? []
    return spans.filter((span) =>
      matchesSpanFilter(span, filter, connectedArtifactRunIds, connectedArtifactResumes),
    )
  }, [snapshot?.spans, filter, connectedArtifactRunIds, connectedArtifactResumes])

  const visibleEdges = useMemo(() => {
    const edges = snapshot?.edges ?? []
    return edges.filter((edge) => matchesEdgeFilter(edge, filter))
  }, [snapshot?.edges, filter])

  const visibleArtifacts = useMemo(() => {
    const artifacts = snapshot?.artifacts ?? []
    if (filter === 'all' || filter === 'outputs') return artifacts
    if (filter === 'scheduled') return artifacts.filter((a) => a.kind === 'inbox' && Boolean(a.issueId))
    if (filter === 'orchestration') {
      const orchSpanIds = new Set(visibleSpans.map((s) => s.id))
      return artifacts.filter((a) => a.runId && orchSpanIds.has(a.runId))
    }
    return []
  }, [snapshot?.artifacts, filter, visibleSpans])

  const laneLayouts = useMemo(() => {
    const lanes = snapshot?.lanes ?? []
    return lanes.map((lane) => {
      const laneSpans = visibleSpans.filter((s) => s.workspaceId === lane.workspaceId)
      const packed = packSpansIntoTracks(laneSpans, fromMs, toMs)
      const laneArtifacts = visibleArtifacts.filter((a) => a.workspaceId === lane.workspaceId)
      const laneSchedules = (snapshot?.scheduleMarkers ?? []).filter(
        (m) => m.workspaceId === lane.workspaceId,
      )
      return {
        lane,
        packed,
        artifacts: laneArtifacts,
        schedules: laneSchedules,
      }
    })
  }, [snapshot?.lanes, snapshot?.scheduleMarkers, visibleSpans, visibleArtifacts, fromMs, toMs])

  const focusTarget: DispatchFocusTarget = hovered ?? (
    selected?.kind === 'span'
      ? { kind: 'span', id: selected.item.id }
      : selected?.kind === 'edge'
        ? { kind: 'edge', id: selected.item.id }
        : selected?.kind === 'artifact'
          ? { kind: 'artifact', id: selected.item.id }
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

    const trackBySpanId = new Map<string, PackedDispatchSpan>()
    for (const layout of laneLayouts) {
      for (const item of layout.packed.packed) {
        trackBySpanId.set(item.span.id, item)
      }
    }

    const findSpanTrackForEdge = (
      workspaceId: string,
      resumeId: string | undefined,
      at: number,
      taskId?: string,
    ): number => {
      if (taskId && trackBySpanId.has(taskId)) {
        return trackBySpanId.get(taskId)!.track
      }
      if (!resumeId) return 0
      const match = laneLayouts
        .find((l) => l.lane.workspaceId === workspaceId)
        ?.packed.packed.find((item) =>
          item.span.resumeId === resumeId
          && at >= item.span.startedAt - 120_000
          && at <= (item.span.finishedAt ?? toMs) + 120_000,
        )
      return match?.track ?? 0
    }

    const out: ComputedEdgeGeometry[] = []
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
        edge.kind === 'dispatch' ? edge.taskId : undefined,
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

      out.push({
        edge,
        x1,
        y1,
        x2,
        y2,
        mx: (x1 + x2) / 2,
        my: (y1 + y2) / 2,
      })
    }
    setEdgeGeometries(out)
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

  return (
    <div data-testid="dispatch-board" className="@container/dispatch space-y-3 px-2 pb-6">
      {board.error && snapshot && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning">
          {t('issues.dispatch.stale')}
        </div>
      )}

      {/* Filter & summary bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('issues.dispatch.title')}>
          {filterChips.map((chip) => (
            <Button
              key={chip.id}
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={filter === chip.id}
              onClick={() => setFilter(chip.id)}
              className={`h-7 rounded-full px-2.5 text-xs ${filter === chip.id ? 'bg-background font-medium text-foreground shadow-xs' : 'border-transparent bg-transparent text-muted-foreground hover:bg-muted/60'}`}
            >
              {chip.label}
            </Button>
          ))}
        </div>

        {snapshot && (
          <div className="flex flex-wrap items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
            <span>{t('issues.dispatch.activeWorkspaces', { count: snapshot.summary.activeWorkspaceCount })}</span>
            <span>{t('issues.dispatch.runs', { count: snapshot.summary.totalSpanCount })}</span>
            <span>{t('issues.dispatch.messages', { count: snapshot.summary.edgeCount })}</span>
            <span>{t('issues.dispatch.outputs', { count: snapshot.summary.artifactCount })}</span>
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
                from: formatClockRange(fromMs),
                to: formatClockRange(toMs),
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
          <Button type="button" size="sm" variant="ghost" onClick={() => setFilter('all')}>
            {t('issues.dispatch.clearFilter')}
          </Button>
        </div>
      )}

      {/* Main Swimlane Canvas */}
      {snapshot && snapshot.lanes.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border/70 bg-background">
          {/* Time Ruler */}
          <div className="hidden border-b border-border/60 bg-muted/30 @[42rem]/dispatch:flex">
            <div className="w-48 shrink-0 border-r border-border/60 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
              {t('issues.dispatch.workspaceLabel')}
            </div>
            <div className="relative flex-1 px-2 py-1.5">
              <div className="flex justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
                {ticks.map((frac) => (
                  <span key={frac}>{formatTickTime(fromMs + spanMs * frac, spanMs)}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Lanes + SVG Overlay */}
          <div ref={canvasRef} className="relative divide-y divide-border/60">
            {laneLayouts.map(({ lane, packed, artifacts, schedules }) => {
              const laneBodyHeight =
                TRACK_TOP_PAD_PX * 2
                + packed.trackCount * TRACK_HEIGHT_PX
                + Math.max(0, packed.trackCount - 1) * TRACK_GAP_PX
              const nextDue = schedules
                .filter((s) => s.nextDueAtMs !== null)
                .sort((a, b) => (a.nextDueAtMs ?? Infinity) - (b.nextDueAtMs ?? Infinity))[0]
              const skippedSchedule = schedules.find((s) => s.skipState)

              return (
                <section
                  key={lane.workspaceId}
                  data-testid={`dispatch-lane-${lane.workspaceId}`}
                  className="flex flex-col @[42rem]/dispatch:flex-row"
                >
                  {/* Sticky/fixed lane header */}
                  <div className="flex shrink-0 flex-col justify-start gap-2 border-b border-border/50 bg-muted/15 px-3 py-2.5 @[42rem]/dispatch:w-48 @[42rem]/dispatch:border-b-0 @[42rem]/dispatch:border-r">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
                        <h3 className="truncate text-xs font-semibold text-foreground" title={lane.label}>
                          {lane.label}
                        </h3>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {t('issues.dispatch.activeBadge')}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                        {lane.tag}
                      </p>
                    </div>

                    {(skippedSchedule || nextDue) && (
                      <div className="flex flex-wrap items-center gap-1">
                        {skippedSchedule?.skipState && (
                          <button
                            type="button"
                            onClick={() => setSelected({ kind: 'schedule', item: skippedSchedule })}
                            className="text-left"
                          >
                            <ScheduleSkipPill skipState={skippedSchedule.skipState} />
                          </button>
                        )}
                        {nextDue && nextDue.nextDueAtMs !== null && (
                          <button
                            type="button"
                            onClick={() => setSelected({ kind: 'schedule', item: nextDue })}
                            className="inline-flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                            title={nextDue.title}
                          >
                            <Clock size={10} className="shrink-0" aria-hidden />
                            <span className="truncate">
                              {t('issues.dispatch.scheduledDue', { time: formatClockRange(nextDue.nextDueAtMs) })}
                            </span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Timeline track body */}
                  <div className="min-w-0 flex-1">
                    <div
                      ref={(el) => setTrackRef(lane.workspaceId, el)}
                      className="relative w-full"
                      style={{ minHeight: laneBodyHeight }}
                    >
                      {/* Subtle grid guide lines */}
                      {ticks.slice(1, -1).map((frac) => (
                        <div
                          key={frac}
                          aria-hidden
                          className="pointer-events-none absolute inset-y-0 border-l border-dashed border-border/40"
                          style={{ left: `${frac * 100}%` }}
                        />
                      ))}

                      {/* Current time indicator */}
                      {nowPct > 0 && nowPct < 100 && (
                        <div
                          aria-hidden
                          className="pointer-events-none absolute inset-y-0 z-[1] border-l border-primary/40"
                          style={{ left: `${nowPct}%` }}
                        />
                      )}

                      {/* Upcoming schedule due ticks inside window */}
                      {schedules.map((marker) => {
                        if (marker.nextDueAtMs === null || marker.nextDueAtMs < fromMs || marker.nextDueAtMs > toMs) {
                          return null
                        }
                        const pct = clampTimePct(marker.nextDueAtMs, fromMs, toMs)
                        return (
                          <button
                            key={`sched-${marker.issueId}`}
                            type="button"
                            onClick={() => setSelected({ kind: 'schedule', item: marker })}
                            title={`${marker.title} · ${formatClockRange(marker.nextDueAtMs)}`}
                            className="absolute top-1 z-10 -translate-x-1/2 rounded-full border border-dashed border-border bg-background/90 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-foreground/50 hover:text-foreground"
                            style={{ left: `${pct}%` }}
                          >
                            <Clock size={9} className="inline mr-0.5" aria-hidden />
                            {formatClockRange(marker.nextDueAtMs)}
                          </button>
                        )
                      })}

                      {/* Packed execution spans */}
                      {packed.packed.map(({ span, track, leftPct, widthPct }) => {
                        const spanArtifacts = artifacts.filter(
                          (art) => art.runId === span.id || (!art.runId && art.resumeId === span.resumeId),
                        )
                        const inboxCount = spanArtifacts.filter((a) => a.kind === 'inbox').length
                        const reportCount = spanArtifacts.filter((a) => a.kind === 'report').length
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
                            onClick={() => setSelected({ kind: 'span', item: span })}
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
                              <span className="size-1.5 shrink-0 rounded-full bg-primary animate-pulse motion-reduce:animate-none" aria-hidden />
                            )}
                            {span.status === 'failed' && (
                              <AlertTriangle size={11} className="shrink-0 text-destructive" aria-hidden />
                            )}
                            <SpanTriggerIcon trigger={span.trigger} />
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {spanTitle(span, t)}
                            </span>
                            {inboxCount > 0 && (
                              <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-primary/15 px-1 py-0.5 text-[10px] font-medium text-primary">
                                <Inbox size={9} aria-hidden />
                                {inboxCount}
                              </span>
                            )}
                            {reportCount > 0 && (
                              <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                                <FileText size={9} aria-hidden />
                                {reportCount}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>

                    {/* Outputs / Inbox & Report milestones rail for this Workspace */}
                    {artifacts.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 border-t border-border/40 bg-muted/10 px-2.5 py-1.5">
                        {artifacts.map((art) => {
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
                              onClick={() => setSelected({ kind: 'artifact', item: art })}
                              onMouseEnter={() => setHovered({ kind: 'artifact', id: art.id })}
                              onMouseLeave={() => setHovered(null)}
                              className={`inline-flex max-w-60 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                                art.kind === 'inbox'
                                  ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
                                  : 'border-border bg-background text-foreground hover:bg-muted/60'
                              } ${isEmphasized ? 'ring-2 ring-primary/50' : ''} ${isDimmed ? 'opacity-30' : ''}`}
                            >
                              {art.kind === 'inbox' ? (
                                <Inbox size={10} className="shrink-0" aria-hidden />
                              ) : (
                                <FileText size={10} className="shrink-0 text-muted-foreground" aria-hidden />
                              )}
                              <span className="truncate">
                                {art.kind === 'inbox' ? art.title : art.path}
                              </span>
                              <span className="shrink-0 font-mono text-[10px] opacity-75">
                                {formatClockRange(art.at)}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </section>
              )
            })}

            {/* SVG Causal Curves Overlay (renders when measured layout > 0) */}
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
                  {edgeGeometries.map(({ edge, x1, y1, x2, y2 }) => {
                    const dx = Math.max(24, Math.abs(y2 - y1) * 0.25)
                    const ctrlX1 = x1 + (edge.kind === 'question' || edge.kind === 'worker_done' ? -dx : dx)
                    const ctrlX2 = x2 + (edge.kind === 'question' || edge.kind === 'worker_done' ? -dx : dx)
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
                      onClick={() => setSelected({ kind: 'edge', item: edge })}
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

          {/* Compact interactive message ribbon for keyboard/narrow screens or test fallback */}
          {visibleEdges.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 bg-muted/20 px-3 py-2">
              <span className="mr-1 text-[11px] font-medium text-muted-foreground">
                {t('issues.dispatch.relatedMessagesTitle')}:
              </span>
              {visibleEdges.map((edge) => {
                const isEmphasized =
                  selected?.kind === 'edge' && selected.item.id === edge.id
                    ? true
                    : hasFocus && trace.edgeIds.has(edge.id)
                const isDimmed = hasFocus && !trace.edgeIds.has(edge.id)
                return (
                  <button
                    key={`chip-${edge.id}`}
                    type="button"
                    data-testid={`dispatch-edge-chip-${edge.id}`}
                    onClick={() => setSelected({ kind: 'edge', item: edge })}
                    onMouseEnter={() => setHovered({ kind: 'edge', id: edge.id })}
                    onMouseLeave={() => setHovered(null)}
                    className={edgePillClasses(edge, isEmphasized, isDimmed)}
                  >
                    <span>{edgeKindLabel(edge.kind, t)}</span>
                    <span className="font-mono text-[10px] opacity-75">{formatClockRange(edge.at)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      <DispatchInspectorSheet
        selected={selected}
        snapshot={snapshot}
        onSelect={setSelected}
        onClose={() => setSelected(null)}
      />
    </div>
  )
}
