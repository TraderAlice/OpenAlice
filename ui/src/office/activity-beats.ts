import type { AgentRuntimeEvent } from '../api/agentRuntimeLog'

export interface OfficeActivityBeat {
  event: AgentRuntimeEvent
  count: number
  oldestSeq: number
  oldestTs: number
}

const OFFICE_ACTIVITY_BEAT_GAP_MS = 3 * 60 * 1000

function progressKey(event: AgentRuntimeEvent): string | null {
  if (event.type !== 'runtime.turn.text' && event.type !== 'runtime.turn.tool') return null
  const actor = event.payload.resumeId ?? event.payload.agent
  if (!actor) return null
  return [
    event.type,
    actor,
    event.payload.taskId ?? '',
    event.payload.workspaceId ?? '',
  ].join('\u0000')
}

/**
 * Turns the newest-first product journal into player-facing activity beats.
 * Only adjacent progress records from the same actor and task are folded; lifecycle,
 * Inbox, News, errors, and interleaved work always remain individual story events.
 */
export function officeActivityBeats(events: readonly AgentRuntimeEvent[]): OfficeActivityBeat[] {
  const beats: OfficeActivityBeat[] = []

  for (const event of events) {
    const key = progressKey(event)
    const previous = beats.at(-1)
    const previousKey = previous ? progressKey(previous.event) : null
    const closeEnough = previous
      ? Math.abs(previous.oldestTs - event.ts) <= OFFICE_ACTIVITY_BEAT_GAP_MS
      : false

    if (key && key === previousKey && closeEnough && previous) {
      previous.count += 1
      previous.oldestSeq = event.seq
      previous.oldestTs = event.ts
      continue
    }

    beats.push({
      event,
      count: 1,
      oldestSeq: event.seq,
      oldestTs: event.ts,
    })
  }

  return beats
}

export function officeActivityOverview(
  families: readonly (readonly OfficeActivityBeat[])[],
  limit = 30,
  minimumPerFamily = 8,
): OfficeActivityBeat[] {
  if (limit <= 0) return []
  const selected = new Map<number, OfficeActivityBeat>()
  for (const family of families) {
    for (const beat of family.slice(0, minimumPerFamily)) {
      selected.set(beat.event.seq, beat)
    }
  }

  const remaining = families
    .flatMap((family) => family)
    .filter((beat) => !selected.has(beat.event.seq))
    .sort((a, b) => b.event.seq - a.event.seq)
  for (const beat of remaining) {
    if (selected.size >= limit) break
    selected.set(beat.event.seq, beat)
  }

  return Array.from(selected.values())
    .sort((a, b) => b.event.seq - a.event.seq)
    .slice(0, limit)
}

export function officeActivityBeatSeq(beat: OfficeActivityBeat): string {
  const newest = String(beat.event.seq).padStart(4, '0')
  if (beat.count === 1) return `#${newest}`
  return `#${String(beat.oldestSeq).padStart(4, '0')}–${newest}`
}
