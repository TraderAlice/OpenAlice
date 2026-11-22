import type { DispatchArtifact, DispatchEdge, DispatchSpan } from '../../api/dispatch'

export interface PackedDispatchSpan {
  readonly span: DispatchSpan
  readonly track: number
  readonly leftPct: number
  readonly widthPct: number
}

export interface PackedLaneSpans {
  readonly packed: readonly PackedDispatchSpan[]
  readonly trackCount: number
}

export interface ClusterLaneOptions {
  readonly maxTracks?: number
  readonly minWidthPct?: number
  readonly clusterThresholdPct?: number
}

export interface DispatchSpanCluster {
  readonly id: string
  readonly workspaceId: string
  readonly spans: readonly DispatchSpan[]
  readonly count: number
  readonly worstStatus: DispatchSpan['status']
  readonly startedAt: number
  readonly finishedAt: number
  readonly track: number
  readonly leftPct: number
  readonly widthPct: number
}

export interface ClusteredLaneSpans {
  readonly spans: readonly PackedDispatchSpan[]
  readonly clusters: readonly DispatchSpanCluster[]
  readonly trackCount: number
}

export type DispatchFocusTarget =
  | { readonly kind: 'span'; readonly id: string }
  | { readonly kind: 'edge'; readonly id: string }
  | { readonly kind: 'artifact'; readonly id: string }
  | {
      readonly kind: 'group'
      readonly spanIds: readonly string[]
      readonly edgeIds: readonly string[]
      readonly artifactIds: readonly string[]
    }
  | null

export interface ConnectedTraceIds {
  readonly spanIds: ReadonlySet<string>
  readonly edgeIds: ReadonlySet<string>
  readonly artifactIds: ReadonlySet<string>
}

export interface DispatchExecutionItem {
  readonly span: DispatchSpan
  readonly artifacts: readonly DispatchArtifact[]
}

export type DispatchEpisode =
  | {
      readonly kind: 'orchestration'
      readonly id: string
      readonly startedAt: number
      readonly latestAt: number
      readonly coordinator?: DispatchExecutionItem
      readonly workers: readonly DispatchExecutionItem[]
      readonly edges: readonly DispatchEdge[]
      readonly artifacts: readonly DispatchArtifact[]
      readonly spanIds: readonly string[]
      readonly edgeIds: readonly string[]
      readonly artifactIds: readonly string[]
    }
  | {
      readonly kind: 'burst'
      readonly id: string
      readonly workspaceId: string
      readonly status: DispatchSpan['status']
      readonly title: string
      readonly triggerKind: DispatchSpan['trigger']['kind']
      readonly agent: string
      readonly model?: string
      readonly startedAt: number
      readonly endedAt: number
      readonly latestAt: number
      readonly error?: string
      readonly preview?: string
      readonly runs: readonly DispatchExecutionItem[]
      readonly artifacts: readonly DispatchArtifact[]
      readonly spanIds: readonly string[]
      readonly artifactIds: readonly string[]
    }
  | {
      readonly kind: 'execution'
      readonly id: string
      readonly startedAt: number
      readonly latestAt: number
      readonly execution: DispatchExecutionItem
      readonly spanIds: readonly string[]
      readonly artifactIds: readonly string[]
    }
  | {
      readonly kind: 'artifact'
      readonly id: string
      readonly startedAt: number
      readonly latestAt: number
      readonly artifact: DispatchArtifact
      readonly spanIds: readonly string[]
      readonly artifactIds: readonly string[]
    }

const STATUS_SEVERITY: Record<DispatchSpan['status'], number> = {
  failed: 3,
  interrupted: 2,
  running: 1,
  done: 0,
}

const BCP47_BY_LANGUAGE: Record<string, string> = {
  en: 'en-US',
  zh: 'zh-CN',
  ja: 'ja-JP',
  'zh-Hant': 'zh-Hant',
}

export function localeForLanguage(language?: string): string {
  if (!language) return 'en-US'
  if (BCP47_BY_LANGUAGE[language]) return BCP47_BY_LANGUAGE[language]
  if (language.startsWith('zh-TW') || language.startsWith('zh-HK') || language.startsWith('zh-Hant')) {
    return 'zh-Hant'
  }
  if (language.startsWith('zh')) return 'zh-CN'
  if (language.startsWith('ja')) return 'ja-JP'
  return 'en-US'
}

export function isDifferentCalendarDay(aMs: number, bMs: number): boolean {
  const a = new Date(aMs)
  const b = new Date(bMs)
  return (
    a.getFullYear() !== b.getFullYear()
    || a.getMonth() !== b.getMonth()
    || a.getDate() !== b.getDate()
  )
}

export function shouldIncludeDateInRange(fromMs: number, toMs: number): boolean {
  return isDifferentCalendarDay(fromMs, toMs) || toMs - fromMs >= 12 * 3_600_000
}

export function formatClockPoint(
  ms: number,
  opts: { includeDate?: boolean; includeSeconds?: boolean; locale?: string } = {},
): string {
  const locale = opts.locale ?? 'en-US'
  return new Intl.DateTimeFormat(locale, {
    ...(opts.includeDate ? { month: 'short', day: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    ...(opts.includeSeconds ? { second: '2-digit' } : {}),
    hourCycle: 'h23',
  }).format(new Date(ms))
}

export function formatWindowRange(fromMs: number, toMs: number, locale?: string): string {
  const includeDate = shouldIncludeDateInRange(fromMs, toMs)
  return `${formatClockPoint(fromMs, { includeDate, locale })} – ${formatClockPoint(toMs, { includeDate, locale })}`
}

export function formatBurstClockSpan(
  startedAt: number,
  endedAt: number,
  referenceMs?: number,
  locale?: string,
): string {
  const crossesDays = isDifferentCalendarDay(startedAt, endedAt)
  if (crossesDays) {
    return `${formatClockPoint(startedAt, { includeDate: true, locale })}–${formatClockPoint(endedAt, { includeDate: true, locale })}`
  }
  const timeRange = `${formatClockPoint(startedAt, { locale })}–${formatClockPoint(endedAt, { locale })}`
  if (referenceMs !== undefined && isDifferentCalendarDay(startedAt, referenceMs)) {
    const dayPrefix = new Intl.DateTimeFormat(locale ?? 'en-US', {
      month: 'short',
      day: 'numeric',
    }).format(new Date(startedAt))
    return `${dayPrefix}, ${timeRange}`
  }
  return timeRange
}

export function formatTickTime(
  ms: number,
  spanMs: number,
  fromMs?: number,
  toMs?: number,
  locale?: string,
): string {
  const resolvedLocale = locale ?? 'en-US'
  const showDate =
    spanMs >= 12 * 3_600_000
    || (fromMs !== undefined && toMs !== undefined && isDifferentCalendarDay(fromMs, toMs))
  if (showDate) {
    return new Intl.DateTimeFormat(resolvedLocale, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(ms))
  }
  return formatClockPoint(ms, { locale: resolvedLocale })
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const remSec = sec % 60
  if (min < 60) return remSec ? `${min}m ${remSec}s` : `${min}m`
  const hr = Math.floor(min / 60)
  const remMin = min % 60
  return remMin ? `${hr}h ${remMin}m` : `${hr}h`
}

function firstPromptLine(text: string | undefined): string | undefined {
  if (!text) return undefined
  for (const raw of text.split(/\r?\n/)) {
    const cleaned = raw.trim().replace(/^#+\s*/, '')
    if (cleaned) return cleaned
  }
  return undefined
}

export function resolveSpanTitle(span: DispatchSpan, fallback?: string): string {
  if (span.trigger.kind === 'scheduled-issue') {
    return span.trigger.issueTitle || `#${span.trigger.issueId}`
  }
  if (span.trigger.kind === 'inquiry') {
    return span.trigger.question
  }
  if (span.sessionLabel) return span.sessionLabel
  const promptHeadline = firstPromptLine(span.originalPrompt ?? span.prompt)
  if (promptHeadline) return promptHeadline
  if (fallback) return fallback
  return span.agent
}

export function spanTriggerIdentity(span: DispatchSpan): string {
  switch (span.trigger.kind) {
    case 'scheduled-issue':
      return `scheduled-issue:${span.trigger.workspaceId}:${span.trigger.issueId}`
    case 'inquiry':
      return `inquiry:${span.trigger.subjectKind}:${span.trigger.issueId ?? span.trigger.inboxEntryId ?? span.trigger.question}`
    case 'orchestration':
      return `orchestration:${span.trigger.parentWorkspaceId}:${span.trigger.dispatchId}`
    case 'conversation':
      return `conversation:${span.trigger.callerKind}:${span.trigger.callerWorkspaceId ?? ''}:${span.resumeId}`
    case 'interactive':
      return `interactive:${span.trigger.surface}:${span.resumeId}`
    case 'manual':
      return `manual:${span.resumeId}`
  }
}

export function worstSpanStatus(spans: readonly DispatchSpan[]): DispatchSpan['status'] {
  let worst: DispatchSpan['status'] = 'done'
  for (const span of spans) {
    if (STATUS_SEVERITY[span.status] > STATUS_SEVERITY[worst]) {
      worst = span.status
    }
  }
  return worst
}

export function clampTimePct(ts: number, fromMs: number, toMs: number): number {
  const windowMs = Math.max(1, toMs - fromMs)
  const raw = ((ts - fromMs) / windowMs) * 100
  return Math.max(0, Math.min(100, raw))
}

function computeSpanGeometry(
  span: DispatchSpan,
  fromMs: number,
  toMs: number,
  minWidthPct: number,
): { leftPct: number; widthPct: number } {
  const windowMs = Math.max(1, toMs - fromMs)
  const startMs = Math.max(fromMs, Math.min(toMs, span.startedAt))
  const rawEndMs = span.finishedAt ?? toMs
  const endMs = Math.max(startMs, Math.min(toMs, rawEndMs))

  const leftPct = ((startMs - fromMs) / windowMs) * 100
  const rawWidthPct = ((endMs - startMs) / windowMs) * 100
  const widthPct = Math.max(0.8, Math.min(100 - leftPct, Math.max(minWidthPct, rawWidthPct)))
  return { leftPct, widthPct }
}

/**
 * Greedy interval track packer for spans inside one active Workspace lane.
 * Ensures concurrent runs stack cleanly without overlapping bars.
 */
export function packSpansIntoTracks(
  spans: readonly DispatchSpan[],
  fromMs: number,
  toMs: number,
  minWidthPct = 1.4,
): PackedLaneSpans {
  if (spans.length === 0) {
    return { packed: [], trackCount: 1 }
  }

  const sorted = [...spans].sort(
    (a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id),
  )

  const trackEndsPct: number[] = []
  const packed: PackedDispatchSpan[] = []
  const gapPct = 0.4

  for (const span of sorted) {
    const { leftPct, widthPct } = computeSpanGeometry(span, fromMs, toMs, minWidthPct)
    const rightPct = leftPct + widthPct

    let assignedTrack = -1
    for (let i = 0; i < trackEndsPct.length; i += 1) {
      if (trackEndsPct[i]! + gapPct <= leftPct) {
        assignedTrack = i
        trackEndsPct[i] = rightPct
        break
      }
    }
    if (assignedTrack === -1) {
      assignedTrack = trackEndsPct.length
      trackEndsPct.push(rightPct)
    }

    packed.push({
      span,
      track: assignedTrack,
      leftPct,
      widthPct,
    })
  }

  return {
    packed,
    trackCount: Math.max(1, trackEndsPct.length),
  }
}

interface WorkingLaneItem {
  id: string
  spans: DispatchSpan[]
  minLeftPct: number
  maxLeftPct: number
  leftPct: number
  widthPct: number
  packWidthPct: number
}

interface PlacedWorkingItem {
  item: WorkingLaneItem
  track: number
  endPct: number
}

function tryPackWorkingItems(
  items: readonly WorkingLaneItem[],
  maxTracks: number,
  gapPct: number,
):
  | { ok: true; placements: PlacedWorkingItem[]; trackCount: number }
  | { ok: false; overflowIndex: number; placements: PlacedWorkingItem[] } {
  const trackEndsPct: number[] = []
  const placements: PlacedWorkingItem[] = []

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!
    const endPct = item.leftPct + item.packWidthPct
    let assignedTrack = -1

    for (let t = 0; t < trackEndsPct.length; t += 1) {
      if (trackEndsPct[t]! + gapPct <= item.leftPct) {
        assignedTrack = t
        trackEndsPct[t] = endPct
        break
      }
    }
    if (assignedTrack === -1 && trackEndsPct.length < maxTracks) {
      assignedTrack = trackEndsPct.length
      trackEndsPct.push(endPct)
    }

    if (assignedTrack === -1) {
      return { ok: false, overflowIndex: i, placements }
    }

    placements.push({ item, track: assignedTrack, endPct })
  }

  return { ok: true, placements, trackCount: Math.max(1, trackEndsPct.length) }
}

function intervalDistance(point: number, min: number, max: number): number {
  if (point < min) return min - point
  if (point > max) return point - max
  return 0
}

/**
 * Caps a Workspace lane to `maxTracks` (default 2) by collapsing dense
 * bursts within `clusterThresholdPct` (default 2.5%) of window width into
 * clickable cluster pills while keeping uncrowded spans directly visible.
 */
export function clusterLaneSpans(
  spans: readonly DispatchSpan[],
  fromMs: number,
  toMs: number,
  options: ClusterLaneOptions = {},
): ClusteredLaneSpans {
  const maxTracks = Math.max(1, options.maxTracks ?? 2)
  const minWidthPct = options.minWidthPct ?? 1.4
  const clusterThresholdPct = options.clusterThresholdPct ?? 2.5
  const gapPct = 0.4

  if (spans.length === 0) {
    return { spans: [], clusters: [], trackCount: 1 }
  }

  const basePacked = packSpansIntoTracks(spans, fromMs, toMs, minWidthPct)
  if (basePacked.trackCount <= maxTracks) {
    return {
      spans: basePacked.packed,
      clusters: [],
      trackCount: basePacked.trackCount,
    }
  }

  const geometryById = new Map<string, { leftPct: number; widthPct: number }>()
  let working: WorkingLaneItem[] = basePacked.packed.map((entry) => {
    geometryById.set(entry.span.id, { leftPct: entry.leftPct, widthPct: entry.widthPct })
    return {
      id: entry.span.id,
      spans: [entry.span],
      minLeftPct: entry.leftPct,
      maxLeftPct: entry.leftPct,
      leftPct: entry.leftPct,
      widthPct: entry.widthPct,
      packWidthPct: entry.widthPct,
    }
  })

  const shortThresholdPct = Math.max(minWidthPct * 2.5, clusterThresholdPct * 2)
  const clusterPillMinPct = 4.5

  const mergeIndices = (indices: ReadonlySet<number>) => {
    const mergedSpans: DispatchSpan[] = []
    const nextWorking: WorkingLaneItem[] = []

    for (let i = 0; i < working.length; i += 1) {
      if (indices.has(i)) {
        mergedSpans.push(...working[i]!.spans)
      } else {
        nextWorking.push(working[i]!)
      }
    }
    nextWorking.push(buildMergedItem(mergedSpans))

    nextWorking.sort(
      (a, b) =>
        a.leftPct - b.leftPct
        || a.spans[0]!.startedAt - b.spans[0]!.startedAt
        || a.id.localeCompare(b.id),
    )
    working = nextWorking
  }

  function buildMergedItem(rawSpans: DispatchSpan[]): WorkingLaneItem {
    const sortedSpans = [...rawSpans].sort(
      (a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id),
    )
    let minLeft = Infinity
    let maxLeft = -Infinity
    let maxRight = -Infinity
    for (const s of sortedSpans) {
      const geom = geometryById.get(s.id) ?? computeSpanGeometry(s, fromMs, toMs, minWidthPct)
      if (geom.leftPct < minLeft) minLeft = geom.leftPct
      if (geom.leftPct > maxLeft) maxLeft = geom.leftPct
      const right = geom.leftPct + geom.widthPct
      if (right > maxRight) maxRight = right
    }
    const widthPct = Math.max(minWidthPct, Math.min(100 - minLeft, maxRight - minLeft))
    const packWidthPct = Math.max(widthPct, Math.min(100 - minLeft, clusterPillMinPct))
    return {
      id: `cluster:${sortedSpans[0]!.workspaceId}:${sortedSpans[0]!.id}:${sortedSpans.length}`,
      spans: sortedSpans,
      minLeftPct: minLeft,
      maxLeftPct: maxLeft,
      leftPct: minLeft,
      widthPct,
      packWidthPct,
    }
  }

  let finalResult: { placements: PlacedWorkingItem[]; trackCount: number } | null = null
  for (let guard = 0; guard <= spans.length; guard += 1) {
    const attempt = tryPackWorkingItems(working, maxTracks, gapPct)
    if (attempt.ok) {
      finalResult = { placements: attempt.placements, trackCount: attempt.trackCount }
      break
    }

    const overflowIdx = attempt.overflowIndex
    const overflow = working[overflowIdx]!

    // Collect items within clusterThresholdPct of the overflowing item's start position.
    const nearbyIndices: number[] = []
    for (let i = 0; i < working.length; i += 1) {
      const candidate = working[i]!
      const dist = Math.min(
        intervalDistance(overflow.leftPct, candidate.minLeftPct, candidate.maxLeftPct),
        intervalDistance(candidate.leftPct, overflow.minLeftPct, overflow.maxLeftPct),
      )
      if (dist <= clusterThresholdPct) {
        nearbyIndices.push(i)
      }
    }

    const shortNearby = nearbyIndices.filter((idx) => {
      const item = working[idx]!
      return item.spans.length > 1 || item.widthPct <= shortThresholdPct
    })

    if (shortNearby.length >= 2) {
      mergeIndices(new Set(shortNearby))
      continue
    }

    if (nearbyIndices.length >= 2) {
      mergeIndices(new Set(nearbyIndices))
      continue
    }

    // Overflow caused by longer ongoing spans occupying all tracks at overflow.leftPct:
    // collapse overflow into the highest occupied track's item at that X position.
    const occupying = attempt.placements.filter((p) => p.endPct + gapPct > overflow.leftPct)
    const fallbackTarget = occupying
      .slice()
      .sort((a, b) => b.track - a.track || a.endPct - b.endPct)[0]

    if (fallbackTarget) {
      const targetIdx = working.indexOf(fallbackTarget.item)
      if (targetIdx !== -1 && targetIdx !== overflowIdx) {
        mergeIndices(new Set([targetIdx, overflowIdx]))
        continue
      }
    }

    // Absolute fallback: merge overflow with immediate predecessor so working shrinks.
    const neighborIdx = overflowIdx > 0 ? overflowIdx - 1 : 1
    mergeIndices(new Set([overflowIdx, neighborIdx]))
  }

  if (!finalResult) {
    const fallbackItem = buildMergedItem([...spans])
    finalResult = {
      placements: [{ item: fallbackItem, track: 0, endPct: fallbackItem.leftPct + fallbackItem.packWidthPct }],
      trackCount: 1,
    }
  }

  const outSpans: PackedDispatchSpan[] = []
  const outClusters: DispatchSpanCluster[] = []

  for (const { item, track } of finalResult.placements) {
    if (item.spans.length === 1) {
      outSpans.push({
        span: item.spans[0]!,
        track,
        leftPct: item.leftPct,
        widthPct: item.widthPct,
      })
    } else {
      const startedAt = Math.min(...item.spans.map((s) => s.startedAt))
      const finishedAt = Math.max(
        ...item.spans.map((s) => s.finishedAt ?? (s.durationMs > 0 ? s.startedAt + s.durationMs : s.startedAt)),
      )
      outClusters.push({
        id: item.id,
        workspaceId: item.spans[0]!.workspaceId,
        spans: item.spans,
        count: item.spans.length,
        worstStatus: worstSpanStatus(item.spans),
        startedAt,
        finishedAt,
        track,
        leftPct: item.leftPct,
        widthPct: item.widthPct,
      })
    }
  }

  return {
    spans: outSpans,
    clusters: outClusters,
    trackCount: Math.max(1, Math.min(maxTracks, finalResult.trackCount)),
  }
}

function spanMatchesTimestampForResume(
  span: DispatchSpan,
  workspaceId: string,
  resumeId: string | undefined,
  at: number,
  slackMs = 120_000,
): boolean {
  if (!resumeId || span.workspaceId !== workspaceId || span.resumeId !== resumeId) {
    return false
  }
  const end = span.finishedAt ?? Number.MAX_SAFE_INTEGER
  return at >= span.startedAt - slackMs && at <= end + slackMs
}

function buildTraceAdjacency(
  spans: readonly DispatchSpan[],
  edges: readonly DispatchEdge[],
  artifacts: readonly DispatchArtifact[],
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>()
  const link = (a: string, b: string) => {
    let setA = adjacency.get(a)
    if (!setA) {
      setA = new Set()
      adjacency.set(a, setA)
    }
    setA.add(b)
    let setB = adjacency.get(b)
    if (!setB) {
      setB = new Set()
      adjacency.set(b, setB)
    }
    setB.add(a)
  }

  const edgesByDispatchId = new Map<string, DispatchEdge[]>()
  for (const edge of edges) {
    if (!edge.dispatchId) continue
    const group = edgesByDispatchId.get(edge.dispatchId)
    if (group) group.push(edge)
    else edgesByDispatchId.set(edge.dispatchId, [edge])
  }

  for (const group of edgesByDispatchId.values()) {
    const anchor = `edge:${group[0]!.id}`
    for (let i = 1; i < group.length; i += 1) {
      link(anchor, `edge:${group[i]!.id}`)
    }
  }

  for (const edge of edges) {
    const eNode = `edge:${edge.id}`
    for (const span of spans) {
      const sNode = `span:${span.id}`
      const directTask = Boolean(edge.taskId && span.id === edge.taskId)
      const directDispatch = Boolean(
        edge.dispatchId
        && span.trigger.kind === 'orchestration'
        && span.trigger.dispatchId === edge.dispatchId,
      )
      const matchesFrom = spanMatchesTimestampForResume(
        span,
        edge.fromWorkspaceId,
        edge.fromResumeId,
        edge.at,
      )
      const matchesTo = spanMatchesTimestampForResume(
        span,
        edge.toWorkspaceId,
        edge.toResumeId,
        edge.at,
      )
      if (directTask || directDispatch || matchesFrom || matchesTo) {
        link(eNode, sNode)
      }
    }
  }

  for (const span of spans) {
    if (span.trigger.kind === 'orchestration') {
      const { parentWorkspaceId, parentResumeId } = span.trigger
      for (const candidate of spans) {
        if (candidate.id === span.id) continue
        if (spanMatchesTimestampForResume(candidate, parentWorkspaceId, parentResumeId, span.startedAt)) {
          link(`span:${span.id}`, `span:${candidate.id}`)
        }
      }
    } else if (span.trigger.kind === 'conversation' && span.trigger.callerWorkspaceId && span.trigger.callerResumeId) {
      for (const candidate of spans) {
        if (candidate.id === span.id) continue
        if (
          spanMatchesTimestampForResume(
            candidate,
            span.trigger.callerWorkspaceId,
            span.trigger.callerResumeId,
            span.startedAt,
          )
        ) {
          link(`span:${span.id}`, `span:${candidate.id}`)
        }
      }
    }
  }

  for (const artifact of artifacts) {
    const aNode = `art:${artifact.id}`
    for (const span of spans) {
      const sNode = `span:${span.id}`
      if (artifact.runId && span.id === artifact.runId) {
        link(aNode, sNode)
        continue
      }
      if (
        !artifact.runId
        && spanMatchesTimestampForResume(span, artifact.workspaceId, artifact.resumeId, artifact.at, 60_000)
      ) {
        link(aNode, sNode)
      }
    }
  }

  return adjacency
}

/**
 * Compute the connected causal trace component for a focused span, edge,
 * artifact, or group of items.
 */
export function collectConnectedTraceIds(
  spans: readonly DispatchSpan[],
  edges: readonly DispatchEdge[],
  artifacts: readonly DispatchArtifact[],
  focus: DispatchFocusTarget,
): ConnectedTraceIds {
  const spanIds = new Set<string>()
  const edgeIds = new Set<string>()
  const artifactIds = new Set<string>()

  if (!focus) {
    return { spanIds, edgeIds, artifactIds }
  }

  const adjacency = buildTraceAdjacency(spans, edges, artifacts)
  const visited = new Set<string>()
  const queue: string[] = []

  if (focus.kind === 'group') {
    for (const id of focus.spanIds) {
      const node = `span:${id}`
      if (!visited.has(node)) {
        visited.add(node)
        queue.push(node)
      }
    }
    for (const id of focus.edgeIds) {
      const node = `edge:${id}`
      if (!visited.has(node)) {
        visited.add(node)
        queue.push(node)
      }
    }
    for (const id of focus.artifactIds) {
      const node = `art:${id}`
      if (!visited.has(node)) {
        visited.add(node)
        queue.push(node)
      }
    }
  } else {
    const startNode = `${focus.kind === 'artifact' ? 'art' : focus.kind}:${focus.id}`
    visited.add(startNode)
    queue.push(startNode)
  }

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current.startsWith('span:')) spanIds.add(current.slice(5))
    else if (current.startsWith('edge:')) edgeIds.add(current.slice(5))
    else if (current.startsWith('art:')) artifactIds.add(current.slice(4))

    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue
      visited.add(next)
      queue.push(next)
    }
  }

  return { spanIds, edgeIds, artifactIds }
}

function spanEndTimestamp(span: DispatchSpan): number {
  if (span.finishedAt !== null) return span.finishedAt
  return span.durationMs > 0 ? span.startedAt + span.durationMs : span.startedAt
}

function isWorkerSpanInEpisode(span: DispatchSpan, compEdges: readonly DispatchEdge[]): boolean {
  if (span.trigger.kind === 'orchestration') return true
  if (span.trigger.kind === 'conversation') return true
  return compEdges.some(
    (edge) =>
      (edge.kind === 'dispatch' || edge.kind === 'conversation')
      && (
        edge.taskId === span.id
        || (
          span.workspaceId === edge.toWorkspaceId
          && span.resumeId === edge.toResumeId
        )
      ),
  )
}

/**
 * Builds the Zone 2 Causal Episode Feed from visible spans, edges, and artifacts,
 * sorted newest-first:
 * 1. Orchestration episodes (Coordinator + Worker(s) + inline edges + attached artifacts)
 * 2. Collapsed consecutive same-Workspace, same-trigger-identity, same-status retry/burst groups
 * 3. Single execution runs and standalone artifact outputs
 */
export function buildDispatchEpisodes(
  spans: readonly DispatchSpan[],
  edges: readonly DispatchEdge[],
  artifacts: readonly DispatchArtifact[],
): readonly DispatchEpisode[] {
  const spanById = new Map(spans.map((s) => [s.id, s]))
  const edgeById = new Map(edges.map((e) => [e.id, e]))
  const adjacency = buildTraceAdjacency(spans, edges, [])

  const visitedNodes = new Set<string>()
  const consumedSpanIds = new Set<string>()
  const consumedEdgeIds = new Set<string>()
  const consumedArtifactIds = new Set<string>()
  const episodes: DispatchEpisode[] = []

  // Helper: attach artifacts to a subset of candidate spans without double-claiming.
  const claimArtifactsForSpans = (candidateSpans: readonly DispatchSpan[]): Map<string, DispatchArtifact[]> => {
    const bySpan = new Map<string, DispatchArtifact[]>()
    for (const s of candidateSpans) bySpan.set(s.id, [])

    const candidateById = new Map(candidateSpans.map((s) => [s.id, s]))

    // Pass 1: exact runId match
    for (const art of artifacts) {
      if (consumedArtifactIds.has(art.id)) continue
      if (art.runId && candidateById.has(art.runId)) {
        consumedArtifactIds.add(art.id)
        bySpan.get(art.runId)!.push(art)
      }
    }

    // Pass 2: resumeId + timestamp match for artifacts lacking an in-window runId match
    for (const art of artifacts) {
      if (consumedArtifactIds.has(art.id)) continue
      if (art.runId && spanById.has(art.runId)) continue
      let bestSpan: DispatchSpan | null = null
      let bestDelta = Infinity
      for (const s of candidateSpans) {
        if (!spanMatchesTimestampForResume(s, art.workspaceId, art.resumeId, art.at, 60_000)) continue
        const delta = Math.abs((s.finishedAt ?? s.startedAt) - art.at)
        if (delta < bestDelta) {
          bestDelta = delta
          bestSpan = s
        }
      }
      if (bestSpan) {
        consumedArtifactIds.add(art.id)
        bySpan.get(bestSpan.id)!.push(art)
      }
    }

    for (const list of bySpan.values()) {
      list.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    }
    return bySpan
  }

  // 1) Orchestration / Cross-workspace connected components
  const seedNodes = [
    ...edges.map((e) => `edge:${e.id}`),
    ...spans
      .filter((s) => s.trigger.kind === 'orchestration' || s.trigger.kind === 'conversation')
      .map((s) => `span:${s.id}`),
  ]

  for (const seed of seedNodes) {
    if (visitedNodes.has(seed)) continue
    const compSpans: DispatchSpan[] = []
    const compEdges: DispatchEdge[] = []
    const queue = [seed]
    visitedNodes.add(seed)

    while (queue.length > 0) {
      const node = queue.shift()!
      if (node.startsWith('span:')) {
        const s = spanById.get(node.slice(5))
        if (s) compSpans.push(s)
      } else if (node.startsWith('edge:')) {
        const e = edgeById.get(node.slice(5))
        if (e) compEdges.push(e)
      }
      for (const next of adjacency.get(node) ?? []) {
        if (visitedNodes.has(next)) continue
        visitedNodes.add(next)
        queue.push(next)
      }
    }

    const isOrchestrationComponent =
      compEdges.length > 0 || compSpans.some((s) => s.trigger.kind === 'orchestration')
    if (!isOrchestrationComponent) continue

    compSpans.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
    compEdges.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))

    const spanArtifacts = claimArtifactsForSpans(compSpans)
    const epArtifacts: DispatchArtifact[] = []
    for (const s of compSpans) {
      consumedSpanIds.add(s.id)
      epArtifacts.push(...(spanArtifacts.get(s.id) ?? []))
    }
    for (const e of compEdges) consumedEdgeIds.add(e.id)
    epArtifacts.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))

    const workers: DispatchExecutionItem[] = []
    const coordinatorCandidates: DispatchSpan[] = []
    for (const s of compSpans) {
      if (isWorkerSpanInEpisode(s, compEdges)) {
        workers.push({ span: s, artifacts: spanArtifacts.get(s.id) ?? [] })
      } else {
        coordinatorCandidates.push(s)
      }
    }

    const primaryCoord = coordinatorCandidates[0]
    const coordinator: DispatchExecutionItem | undefined = primaryCoord
      ? { span: primaryCoord, artifacts: spanArtifacts.get(primaryCoord.id) ?? [] }
      : undefined
    for (let i = 1; i < coordinatorCandidates.length; i += 1) {
      const extra = coordinatorCandidates[i]!
      workers.push({ span: extra, artifacts: spanArtifacts.get(extra.id) ?? [] })
    }
    workers.sort((a, b) => a.span.startedAt - b.span.startedAt || a.span.id.localeCompare(b.span.id))

    const allStartTs = [
      ...compSpans.map((s) => s.startedAt),
      ...compEdges.map((e) => e.at),
      ...epArtifacts.map((a) => a.at),
    ]
    const allEndTs = [
      ...compSpans.map(spanEndTimestamp),
      ...compEdges.map((e) => e.at),
      ...epArtifacts.map((a) => a.at),
    ]

    const anchorId = compSpans[0]?.id ?? compEdges[0]!.id
    episodes.push({
      kind: 'orchestration',
      id: `orch:${anchorId}`,
      startedAt: Math.min(...allStartTs),
      latestAt: Math.max(...allEndTs),
      ...(coordinator ? { coordinator } : {}),
      workers,
      edges: compEdges,
      artifacts: epArtifacts,
      spanIds: compSpans.map((s) => s.id),
      edgeIds: compEdges.map((e) => e.id),
      artifactIds: epArtifacts.map((a) => a.id),
    })
  }

  // 2) Remaining spans: attach remaining artifacts, then collapse consecutive same-workspace
  //    runs sharing trigger identity and status into burst groups.
  const remainingSpans = spans.filter((s) => !consumedSpanIds.has(s.id))
  const remainingArtifactBySpan = claimArtifactsForSpans(remainingSpans)

  const spansByWorkspace = new Map<string, DispatchSpan[]>()
  for (const s of remainingSpans) {
    const list = spansByWorkspace.get(s.workspaceId)
    if (list) list.push(s)
    else spansByWorkspace.set(s.workspaceId, [s])
  }

  for (const [workspaceId, wsSpans] of spansByWorkspace) {
    wsSpans.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))

    let cursor = 0
    while (cursor < wsSpans.length) {
      const first = wsSpans[cursor]!
      const identity = spanTriggerIdentity(first)
      const status = first.status
      let endCursor = cursor + 1

      while (endCursor < wsSpans.length) {
        const candidate = wsSpans[endCursor]!
        if (candidate.status !== status || spanTriggerIdentity(candidate) !== identity) {
          break
        }
        endCursor += 1
      }

      const group = wsSpans.slice(cursor, endCursor)
      if (group.length >= 2) {
        const groupArtifacts: DispatchArtifact[] = []
        for (const s of group) {
          groupArtifacts.push(...(remainingArtifactBySpan.get(s.id) ?? []))
        }
        groupArtifacts.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))

        const runs: DispatchExecutionItem[] = [...group]
          .reverse()
          .map((s) => ({ span: s, artifacts: remainingArtifactBySpan.get(s.id) ?? [] }))

        const latestSpan = runs[0]!.span
        const endedAt = Math.max(
          ...group.map(spanEndTimestamp),
          ...groupArtifacts.map((a) => a.at),
        )
        const error = runs.find((r) => r.span.error)?.span.error
        const preview = error ? undefined : runs.find((r) => r.span.assistantPreview)?.span.assistantPreview

        episodes.push({
          kind: 'burst',
          id: `burst:${workspaceId}:${group[0]!.id}:${group.length}`,
          workspaceId,
          status,
          title: resolveSpanTitle(latestSpan),
          triggerKind: latestSpan.trigger.kind,
          agent: latestSpan.agent,
          ...(runs.find((r) => r.span.model)?.span.model
            ? { model: runs.find((r) => r.span.model)!.span.model }
            : {}),
          startedAt: group[0]!.startedAt,
          endedAt,
          latestAt: endedAt,
          ...(error ? { error } : {}),
          ...(preview ? { preview } : {}),
          runs,
          artifacts: groupArtifacts,
          spanIds: group.map((s) => s.id),
          artifactIds: groupArtifacts.map((a) => a.id),
        })
      } else {
        const art = remainingArtifactBySpan.get(first.id) ?? []
        const latestAt = Math.max(spanEndTimestamp(first), ...art.map((a) => a.at))
        episodes.push({
          kind: 'execution',
          id: `exec:${first.id}`,
          startedAt: first.startedAt,
          latestAt,
          execution: { span: first, artifacts: art },
          spanIds: [first.id],
          artifactIds: art.map((a) => a.id),
        })
      }

      cursor = endCursor
    }
  }

  // 3) Standalone artifacts that did not match any in-window span
  for (const art of artifacts) {
    if (consumedArtifactIds.has(art.id)) continue
    episodes.push({
      kind: 'artifact',
      id: `art:${art.id}`,
      startedAt: art.at,
      latestAt: art.at,
      artifact: art,
      spanIds: [],
      artifactIds: [art.id],
    })
  }

  episodes.sort(
    (a, b) =>
      b.latestAt - a.latestAt
      || b.startedAt - a.startedAt
      || a.id.localeCompare(b.id),
  )

  return episodes
}
