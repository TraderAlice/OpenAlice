import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../api'
import type { OfficeRoutineFollowUp } from '../api/office'

export type OfficeRoutineFollowUpStatus = 'loading' | 'ready' | 'error'

const OFFICE_ROUTINE_FOLLOW_UP_POLL_MS = 15_000
const OFFICE_ROUTINE_FOLLOW_UP_CHANNEL = 'openalice:office-routine-follow-ups'

export interface OfficeRoutineFollowUpsState {
  readonly status: OfficeRoutineFollowUpStatus
  readonly followUps: readonly OfficeRoutineFollowUp[]
  /** Latest authoritative list request started by this hook. */
  readonly requestEpoch: number
  /** Request-start epoch of the latest validated list accepted by this hook. */
  readonly successEpoch: number
  carry(inboxEntryId: string): Promise<void>
  resolve(inboxEntryId: string): Promise<void>
  refresh(): Promise<void>
}

type RoutineFollowUpMutation = 'carry' | 'resolve'

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
  const candidate = value as Record<string, unknown>
  return isExactIdentity(candidate.inboxEntryId)
    && isTimestamp(candidate.reportTs)
    && isExactIdentity(candidate.issueWorkspaceId)
    && isExactIdentity(candidate.issueId)
    && isTimestamp(candidate.createdAt)
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
      setFollowUps((current) => {
        const currentById = new Map(current.map((followUp) => [followUp.inboxEntryId, followUp]))
        const merged = serverFollowUps.filter((followUp) =>
          (entryCommitVersionRef.current.get(followUp.inboxEntryId) ?? 0)
            <= startedAtMutationVersion)
        for (const [inboxEntryId, committedAt] of entryCommitVersionRef.current) {
          if (committedAt <= startedAtMutationVersion) continue
          const locallyConfirmed = currentById.get(inboxEntryId)
          if (locallyConfirmed) merged.push(locallyConfirmed)
          // No local row means a resolve committed after this GET began; omit
          // the stale server copy while still accepting unrelated server rows.
        }
        return orderFollowUps(merged)
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
    const key = `${mutation}:${inboxEntryId}`
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
        if (mutation === 'carry') {
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
          const response = await api.office.resolveRoutineFollowUp(inboxEntryId)
          if (response.ok !== true || typeof response.removed !== 'boolean') {
            throw new Error('Invalid Office routine follow-up response')
          }
          if (!mountedRef.current
            || entryIntentGenerationRef.current.get(inboxEntryId) !== generation) return
          mutationCommitVersionRef.current += 1
          entryCommitVersionRef.current.set(
            inboxEntryId,
            mutationCommitVersionRef.current,
          )
          // `removed: false` is still authoritative: the server confirms this
          // exact key is absent, so a stale local copy must disappear too.
          setFollowUps((current) => current.filter(
            (followUp) => followUp.inboxEntryId !== inboxEntryId,
          ))
        }
        errorTokensRef.current.delete(`entry:${inboxEntryId}`)
        channelRef.current?.postMessage({ mutation, inboxEntryId })
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
    (inboxEntryId: string) => mutate('carry', inboxEntryId),
    [mutate],
  )
  const resolve = useCallback(
    (inboxEntryId: string) => mutate('resolve', inboxEntryId),
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
    requestEpoch,
    successEpoch,
    carry,
    resolve,
    refresh,
  }
}
