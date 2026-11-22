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

export type DispatchFocusTarget =
  | { readonly kind: 'span'; readonly id: string }
  | { readonly kind: 'edge'; readonly id: string }
  | { readonly kind: 'artifact'; readonly id: string }
  | null

export interface ConnectedTraceIds {
  readonly spanIds: ReadonlySet<string>
  readonly edgeIds: ReadonlySet<string>
  readonly artifactIds: ReadonlySet<string>
}

export function clampTimePct(ts: number, fromMs: number, toMs: number): number {
  const windowMs = Math.max(1, toMs - fromMs)
  const raw = ((ts - fromMs) / windowMs) * 100
  return Math.max(0, Math.min(100, raw))
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

  const windowMs = Math.max(1, toMs - fromMs)
  const sorted = [...spans].sort(
    (a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id),
  )

  const trackEndsPct: number[] = []
  const packed: PackedDispatchSpan[] = []
  const gapPct = 0.4

  for (const span of sorted) {
    const startMs = Math.max(fromMs, Math.min(toMs, span.startedAt))
    const rawEndMs = span.finishedAt ?? toMs
    const endMs = Math.max(startMs, Math.min(toMs, rawEndMs))

    const leftPct = ((startMs - fromMs) / windowMs) * 100
    const rawWidthPct = ((endMs - startMs) / windowMs) * 100
    const widthPct = Math.max(0.8, Math.min(100 - leftPct, Math.max(minWidthPct, rawWidthPct)))
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

/**
 * Compute the connected causal trace component for a focused span, edge, or artifact.
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

  const startNode = `${focus.kind === 'artifact' ? 'art' : focus.kind}:${focus.id}`
  const visited = new Set<string>([startNode])
  const queue = [startNode]

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
