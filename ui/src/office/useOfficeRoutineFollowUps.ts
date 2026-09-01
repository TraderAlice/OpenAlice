import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../api'
import type {
  OfficeRoutineDecision,
  OfficeRoutineDecisionInput,
  OfficeRoutineFollowUp,
} from '../api/office'

export type OfficeRoutineFollowUpStatus = 'loading' | 'ready' | 'error'

const OFFICE_ROUTINE_FOLLOW_UP_POLL_MS = 15_000
const OFFICE_ROUTINE_FOLLOW_UP_CHANNEL = 'openalice:office-routine-follow-ups'

export interface OfficeRoutineFollowUpsState {
  readonly status: OfficeRoutineFollowUpStatus
  readonly followUps: readonly OfficeRoutineFollowUp[]
  readonly decisions: readonly OfficeRoutineDecision[]
  /** Latest authoritative list request started by this hook. */
  readonly requestEpoch: number
  /** Request-start epoch of the latest validated list accepted by this hook. */
  readonly successEpoch: number
  carry(inboxEntryId: string): Promise<void>
  decide(inboxEntryId: string, input: OfficeRoutineDecisionInput): Promise<void>
  refresh(): Promise<void>
}

type RoutineFollowUpMutation =
  | { readonly kind: 'carry' }
  | { readonly kind: 'decide'; readonly input: OfficeRoutineDecisionInput }

interface InflightMutation {
  readonly generation: number
  readonly promise: Promise<void>
}

function isExactIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 0
}

function isRoutineFollowUp(value: unknown): value is OfficeRoutineFollowUp {
  if (!value || typeof value !== 'object') return false
  const candidate = value as unknown as Record<string, unknown>
  return isExactIdentity(candidate.inboxEntryId)
    && isTimestamp(candidate.reportTs)
    && isExactIdentity(candidate.issueWorkspaceId)
    && isExactIdentity(candidate.issueId)
    && isTimestamp(candidate.createdAt)
}

function isRoutineDecision(value: unknown): value is OfficeRoutineDecision {
  if (!isRoutineFollowUp(value) || !value || typeof value !== 'object') return false
  const candidate = value as unknown as Record<string, unknown>
  const outcome = candidate.outcome
  const noteValid = candidate.note === undefined
    || (typeof candidate.note === 'string'
      && candidate.note.length >= 1
      && candidate.note.length <= 280
      && candidate.note.trim() === candidate.note)
  return (outcome === 'maintain-plan'
      || outcome === 'revise-plan'
      || outcome === 'evidence-unavailable')
    && noteValid
    && (outcome === 'revise-plan' ? typeof candidate.note === 'string' : candidate.note === undefined)
    && isTimestamp(candidate.decidedAt)
}

function validatedFollowUps(value: unknown): OfficeRoutineFollowUp[] {
  if (!Array.isArray(value) || !value.every(isRoutineFollowUp)) {
    throw new Error('Invalid Office routine follow-up response')
  }
  const ids = new Set(value.map((followUp) => followUp.inboxEntryId))
  if (ids.size !== value.length) {
    throw new Error('Invalid Office routine follow-up response')
  }
  return value
}

function validatedDecisions(value: unknown): OfficeRoutineDecision[] {
  if (!Array.isArray(value) || !value.every(isRoutineDecision)) {
    throw new Error('Invalid Office routine decision response')
  }
  const ids = new Set(value.map((decision) => decision.inboxEntryId))
  if (ids.size !== value.length) {
    throw new Error('Invalid Office routine decision response')
  }
  return value
}

function orderFollowUps(
  followUps: readonly OfficeRoutineFollowUp[],
): OfficeRoutineFollowUp[] {
  return [...followUps].sort((left, right) =>
    left.createdAt - right.createdAt
    || left.reportTs - right.reportTs
    || left.inboxEntryId.localeCompare(right.inboxEntryId))
}

function upsertFollowUp(
  followUps: readonly OfficeRoutineFollowUp[],
  next: OfficeRoutineFollowUp,
): OfficeRoutineFollowUp[] {
  return orderFollowUps([
    ...followUps.filter((followUp) => followUp.inboxEntryId !== next.inboxEntryId),
    next,
  ])
}

function orderDecisions(
  decisions: readonly OfficeRoutineDecision[],
): OfficeRoutineDecision[] {
  return [...decisions].sort((left, right) =>
    right.decidedAt - left.decidedAt
    || right.reportTs - left.reportTs
    || left.inboxEntryId.localeCompare(right.inboxEntryId))
}

function upsertDecision(
  decisions: readonly OfficeRoutineDecision[],
  next: OfficeRoutineDecision,
): OfficeRoutineDecision[] {
  return orderDecisions([
    ...decisions.filter((decision) => decision.inboxEntryId !== next.inboxEntryId),
    next,
  ])
}

/**
 * Durable, server-authoritative decision-desk facts for Office.
 *
 * Reads and writes intentionally fail closed: pending or failed requests never
 * invent or remove a follow-up locally. Successful mutation responses publish
 * immediately, while generations prevent an older refresh or superseded
 * per-entry write from restoring stale state.
 */
export function useOfficeRoutineFollowUps(): OfficeRoutineFollowUpsState {
  const [status, setStatus] = useState<OfficeRoutineFollowUpStatus>('loading')
  const [followUps, setFollowUps] = useState<OfficeRoutineFollowUp[]>([])
  const [decisions, setDecisions] = useState<OfficeRoutineDecision[]>([])
  const [requestEpoch, setRequestEpoch] = useState(0)
  const [successEpoch, setSuccessEpoch] = useState(0)
  const mountedRef = useRef(true)
  const listRequestEpochRef = useRef(0)
  const requestTokenRef = useRef(0)
  const pendingRequestTokensRef = useRef(new Set<number>())
  const errorVersionRef = useRef(0)
  const errorTokensRef = useRef(new Map<string, number>())
  const refreshGenerationRef = useRef(0)
  const mutationCommitVersionRef = useRef(0)
  const entryCommitVersionRef = useRef(new Map<string, number>())
  const mutationGenerationRef = useRef(0)
  const entryIntentGenerationRef = useRef(new Map<string, number>())
  const entryMutationTailsRef = useRef(new Map<string, Promise<void>>())
  const inflightMutationsRef = useRef(new Map<string, InflightMutation>())
  const channelRef = useRef<BroadcastChannel | null>(null)

  const beginRequest = useCallback((): number => {
    const token = requestTokenRef.current + 1
    requestTokenRef.current = token
    pendingRequestTokensRef.current.add(token)
    if (mountedRef.current) setStatus('loading')
    return token
  }, [])

  const finishRequest = useCallback((token: number): void => {
    pendingRequestTokensRef.current.delete(token)
    if (mountedRef.current && pendingRequestTokensRef.current.size === 0) {
      setStatus(errorTokensRef.current.size > 0 ? 'error' : 'ready')
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const listRequestEpoch = listRequestEpochRef.current + 1
    listRequestEpochRef.current = listRequestEpoch
    if (mountedRef.current) setRequestEpoch(listRequestEpoch)
    const generation = refreshGenerationRef.current + 1
    refreshGenerationRef.current = generation
    const startedAtMutationVersion = mutationCommitVersionRef.current
    const startedAtErrorVersion = errorVersionRef.current
    const requestToken = beginRequest()

    try {
      const response = await api.office.listRoutineFollowUps()
      if (!mountedRef.current
        || refreshGenerationRef.current !== generation) return
      const serverFollowUps = validatedFollowUps(response.followUps)
      const serverDecisions = validatedDecisions(response.decisions)
      setFollowUps((current) => {
        const currentById = new Map(current.map((followUp) => [followUp.inboxEntryId, followUp]))
        const merged = serverFollowUps.filter((followUp) =>
          (entryCommitVersionRef.current.get(followUp.inboxEntryId) ?? 0)
            <= startedAtMutationVersion)
        for (const [inboxEntryId, committedAt] of entryCommitVersionRef.current) {
          if (committedAt <= startedAtMutationVersion) continue
          const locallyConfirmed = currentById.get(inboxEntryId)
          if (locallyConfirmed) merged.push(locallyConfirmed)
          // No local row means a decision committed after this GET began; omit
          // the stale server copy while still accepting unrelated server rows.
        }
        return orderFollowUps(merged)
      })
      setDecisions((current) => {
        const currentById = new Map(current.map((decision) => [decision.inboxEntryId, decision]))
        const merged = serverDecisions.filter((decision) =>
          (entryCommitVersionRef.current.get(decision.inboxEntryId) ?? 0)
            <= startedAtMutationVersion)
        for (const [inboxEntryId, committedAt] of entryCommitVersionRef.current) {
          if (committedAt <= startedAtMutationVersion) continue
          const locallyConfirmed = currentById.get(inboxEntryId)
          if (locallyConfirmed) merged.push(locallyConfirmed)
        }
        return orderDecisions(merged)
      })
      // This full read recovers only failures that predate it. A mutation may
      // fail after the GET took its snapshot; that newer uncertainty must keep
      // the hook closed until a later authoritative read.
      for (const [token, failedAt] of errorTokensRef.current) {
        if (failedAt <= startedAtErrorVersion) errorTokensRef.current.delete(token)
      }
      setSuccessEpoch((current) => Math.max(current, listRequestEpoch))
    } catch {
      if (!mountedRef.current
        || refreshGenerationRef.current !== generation) return
      // Keep the last server-confirmed list visible, but advertise that it is
      // not currently safe to treat it as a complete control-plane snapshot.
      errorVersionRef.current += 1
      errorTokensRef.current.set('refresh', errorVersionRef.current)
    } finally {
      finishRequest(requestToken)
    }
  }, [beginRequest, finishRequest])

  const mutate = useCallback((
    mutation: RoutineFollowUpMutation,
    inboxEntryId: string,
  ): Promise<void> => {
    const key = mutation.kind === 'carry'
      ? `carry:${inboxEntryId}`
      : `decide:${inboxEntryId}:${JSON.stringify(mutation.input)}`
    const existing = inflightMutationsRef.current.get(key)
    const currentEntryGeneration = entryIntentGenerationRef.current.get(inboxEntryId)
    if (existing && existing.generation === currentEntryGeneration) {
      return existing.promise
    }

    const generation = mutationGenerationRef.current + 1
    mutationGenerationRef.current = generation
    entryIntentGenerationRef.current.set(inboxEntryId, generation)
    const requestToken = beginRequest()
    const previous = entryMutationTailsRef.current.get(inboxEntryId) ?? Promise.resolve()
    const promise = previous.catch(() => undefined).then(async () => {
      try {
        // A queued operation superseded before it reached the server is a
        // no-op. If it already reached the server, the newer exact-entry intent
        // waits on this promise and therefore reaches the server afterwards.
        if (entryIntentGenerationRef.current.get(inboxEntryId) !== generation) return
        if (mutation.kind === 'carry') {
          const response = await api.office.carryRoutineFollowUp(inboxEntryId)
          if (!isRoutineFollowUp(response.followUp)
            || response.followUp.inboxEntryId !== inboxEntryId
            || typeof response.created !== 'boolean') {
            throw new Error('Invalid Office routine follow-up response')
          }
          if (!mountedRef.current
            || entryIntentGenerationRef.current.get(inboxEntryId) !== generation) return
          mutationCommitVersionRef.current += 1
          entryCommitVersionRef.current.set(
            inboxEntryId,
            mutationCommitVersionRef.current,
          )
          setFollowUps((current) => upsertFollowUp(current, response.followUp))
        } else {
          const response = await api.office.decideRoutineFollowUp(inboxEntryId, mutation.input)
          if (!isRoutineDecision(response.decision)
            || response.decision.inboxEntryId !== inboxEntryId
            || response.decision.outcome !== mutation.input.outcome
            || (response.decision.note ?? undefined) !== (
              mutation.input.outcome === 'revise-plan' ? mutation.input.note : undefined
            )
            || typeof response.created !== 'boolean') {
            throw new Error('Invalid Office routine decision response')
          }
          if (!mountedRef.current
            || entryIntentGenerationRef.current.get(inboxEntryId) !== generation) return
          mutationCommitVersionRef.current += 1
          entryCommitVersionRef.current.set(
            inboxEntryId,
            mutationCommitVersionRef.current,
          )
          // A decision receipt is authoritative: the exact carry is no longer
          // active, so a stale local copy must disappear too.
          setFollowUps((current) => current.filter(
            (followUp) => followUp.inboxEntryId !== inboxEntryId,
          ))
          setDecisions((current) => upsertDecision(current, response.decision))
        }
        errorTokensRef.current.delete(`entry:${inboxEntryId}`)
        channelRef.current?.postMessage({ mutation: mutation.kind, inboxEntryId })
      } catch (cause) {
        if (mountedRef.current
          && entryIntentGenerationRef.current.get(inboxEntryId) === generation) {
          errorVersionRef.current += 1
          errorTokensRef.current.set(`entry:${inboxEntryId}`, errorVersionRef.current)
        }
        throw cause
      } finally {
        const inflight = inflightMutationsRef.current.get(key)
        if (inflight?.generation === generation) {
          inflightMutationsRef.current.delete(key)
        }
        finishRequest(requestToken)
      }
    })

    inflightMutationsRef.current.set(key, { generation, promise })
    const tail = promise.then(() => undefined, () => undefined)
    entryMutationTailsRef.current.set(inboxEntryId, tail)
    void tail.then(() => {
      if (entryMutationTailsRef.current.get(inboxEntryId) === tail) {
        entryMutationTailsRef.current.delete(inboxEntryId)
      }
    })
    return promise
  }, [beginRequest, finishRequest])

  const carry = useCallback(
    (inboxEntryId: string) => mutate({ kind: 'carry' }, inboxEntryId),
    [mutate],
  )
  const decide = useCallback(
    (inboxEntryId: string, input: OfficeRoutineDecisionInput) => (
      mutate({ kind: 'decide', input }, inboxEntryId)
    ),
    [mutate],
  )

  useEffect(() => {
    mountedRef.current = true
    void refresh()
    const intervalId = window.setInterval(
      () => void refresh(),
      OFFICE_ROUTINE_FOLLOW_UP_POLL_MS,
    )
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const refreshFocused = () => void refresh()
    document.addEventListener('visibilitychange', refreshVisible)
    window.addEventListener('focus', refreshFocused)
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(OFFICE_ROUTINE_FOLLOW_UP_CHANNEL)
      channel.onmessage = () => void refresh()
      channelRef.current = channel
    }
    return () => {
      mountedRef.current = false
      refreshGenerationRef.current += 1
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', refreshVisible)
      window.removeEventListener('focus', refreshFocused)
      channelRef.current?.close()
      channelRef.current = null
      pendingRequestTokensRef.current.clear()
      errorTokensRef.current.clear()
      entryIntentGenerationRef.current.clear()
      entryMutationTailsRef.current.clear()
      inflightMutationsRef.current.clear()
    }
  }, [refresh])

  return {
    status,
    followUps,
    decisions,
    requestEpoch,
    successEpoch,
    carry,
    decide,
    refresh,
  }
}
