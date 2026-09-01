import { useCallback, useEffect, useMemo } from 'react'
import { create } from 'zustand'

import { preferencesApi } from '../api/preferences'
import { useBackendRecoverySignal } from '../auth/AuthContext'
import {
  getAgentRuntimeReadiness,
  listAgents,
  probeAgentRuntimeReadiness,
  type AgentInfo,
  type AgentRuntimeReadinessSnapshot,
} from '../components/workspace/api'
import {
  normalizeAgentRuntimeQuickAccessIds,
  projectAgentRuntimeQuickAccess,
  type AgentRuntimeQuickAccessProjection,
} from '../lib/agentRuntimeQuickAccess'

export interface AgentRuntimesState extends AgentRuntimeQuickAccessProjection {
  /** Complete adapter inventory, including utility adapters. */
  readonly agents: readonly AgentInfo[]
  readonly readiness: AgentRuntimeReadinessSnapshot | null
  readonly quickAccessIds: readonly string[]
  readonly recentAgentIds: readonly string[]
  readonly loading: boolean
  readonly refreshing: boolean
  readonly error: string | null
  /** Cheap host rediscovery: GET inventory + cached readiness, never a probe. */
  rediscover(): Promise<void>
  refresh(agent?: string): Promise<void>
  saveQuickAccess(ids: readonly string[]): Promise<void>
  recordSuccessfulUse(agentId: string): Promise<void>
}

interface AgentRuntimesStore {
  agents: AgentInfo[]
  readiness: AgentRuntimeReadinessSnapshot | null
  quickAccessIds: readonly string[]
  confirmedQuickAccessIds: readonly string[]
  recentAgentIds: readonly string[]
  confirmedRecentAgentIds: readonly string[]
  loading: boolean
  refreshing: boolean
  error: string | null
  loaded: boolean
  inflight: Promise<void> | null
  rediscoveryInflight: Promise<void> | null
  refreshInflight: Promise<void> | null
  publicationEpoch: number
  observedBackendRecoveryGeneration: number
  backendRecoveryInflightGeneration: number | null
  backendRecoveryInflight: Promise<void> | null
  saveGeneration: number
  saveQueue: Promise<unknown>
  recentGeneration: number
  recentQueue: Promise<unknown>
  ensureLoaded(options?: AgentRuntimeDiscoveryOptions): Promise<void>
  rediscover(options?: AgentRuntimeDiscoveryOptions): Promise<void>
  recoverAfterBackend(generation: number): Promise<void>
  refresh(agent?: string): Promise<void>
  saveQuickAccess(ids: readonly string[]): Promise<void>
  recordSuccessfulUse(agentId: string): Promise<void>
}

interface AgentRuntimeDiscoveryOptions {
  readonly supersedePending?: boolean
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function asSettled<T>(work: () => Promise<T>): Promise<PromiseSettledResult<T>> {
  return Promise.resolve()
    .then(work)
    .then(
      (value): PromiseSettledResult<T> => ({ status: 'fulfilled', value }),
      (reason): PromiseSettledResult<T> => ({ status: 'rejected', reason }),
    )
}

const emptyStoreSlice = {
  agents: [] as AgentInfo[],
  readiness: null as AgentRuntimeReadinessSnapshot | null,
  quickAccessIds: [] as readonly string[],
  confirmedQuickAccessIds: [] as readonly string[],
  recentAgentIds: [] as readonly string[],
  confirmedRecentAgentIds: [] as readonly string[],
  loading: true,
  refreshing: false,
  error: null as string | null,
  loaded: false,
  inflight: null as Promise<void> | null,
  rediscoveryInflight: null as Promise<void> | null,
  refreshInflight: null as Promise<void> | null,
  backendRecoveryInflightGeneration: null as number | null,
  backendRecoveryInflight: null as Promise<void> | null,
}

export const useAgentRuntimesStore = create<AgentRuntimesStore>((set, get) => ({
  ...emptyStoreSlice,
  publicationEpoch: 0,
  observedBackendRecoveryGeneration: 0,
  saveGeneration: 0,
  saveQueue: Promise.resolve(),
  recentGeneration: 0,
  recentQueue: Promise.resolve(),

  async ensureLoaded(options) {
    const supersedePending = options?.supersedePending === true
    if (get().loaded && !supersedePending) return
    const refreshInflight = get().refreshInflight
    if (refreshInflight && !supersedePending) return refreshInflight
    const inflight = get().inflight
    if (inflight && !supersedePending) return inflight
    const epoch = get().publicationEpoch + 1
    set({
      publicationEpoch: epoch,
      loading: true,
      ...(supersedePending ? {
        inflight: null,
        rediscoveryInflight: null,
        refreshInflight: null,
        refreshing: false,
      } : {}),
    })
    let request!: Promise<void>
    request = (async () => {
      const [listed, snapshot, preferences] = await Promise.all([
        asSettled(() => listAgents()),
        asSettled(() => getAgentRuntimeReadiness()),
        asSettled(() => preferencesApi.getAgentRuntimes()),
      ])
      if (get().publicationEpoch !== epoch || get().inflight !== request) return
      const agents = listed.status === 'fulfilled'
        ? listed.value ?? []
        : get().agents
      const quickAccessIds = preferences.status === 'fulfilled'
        ? normalizeAgentRuntimeQuickAccessIds(preferences.value?.quickAccessIds ?? [])
        : get().quickAccessIds
      const recentAgentIds = preferences.status === 'fulfilled'
        ? normalizeAgentRuntimeQuickAccessIds(preferences.value?.recentAgentIds ?? [])
        : get().recentAgentIds
      const failed = [listed, snapshot].find((result) => result.status === 'rejected')
      set({
        agents,
        readiness: snapshot.status === 'fulfilled' ? snapshot.value ?? null : get().readiness,
        quickAccessIds,
        confirmedQuickAccessIds: quickAccessIds,
        recentAgentIds,
        confirmedRecentAgentIds: recentAgentIds,
        error: failed && failed.status === 'rejected' ? errorMessage(failed.reason) : null,
        loading: false,
        loaded: true,
      })
    })()
    set({ inflight: request })
    try {
      await request
    } finally {
      if (get().publicationEpoch === epoch && get().inflight === request) {
        set({ inflight: null })
      }
    }
  },

  async refresh(agent?: string) {
    const epoch = get().publicationEpoch + 1
    set({
      publicationEpoch: epoch,
      inflight: null,
      rediscoveryInflight: null,
      refreshInflight: null,
      loading: false,
      refreshing: true,
      error: null,
    })
    let request!: Promise<void>
    request = (async () => {
      try {
        const [listed, snapshot] = await Promise.all([
          listAgents(),
          probeAgentRuntimeReadiness(agent, (next) => {
            if (
              get().publicationEpoch === epoch
              && get().refreshInflight === request
            ) {
              set({ readiness: next })
            }
          }),
        ])
        if (get().publicationEpoch !== epoch || get().refreshInflight !== request) return
        set({
          agents: listed,
          readiness: snapshot,
          refreshing: false,
          error: null,
          loaded: true,
          loading: false,
          refreshInflight: null,
        })
      } catch (cause) {
        if (get().publicationEpoch !== epoch || get().refreshInflight !== request) return
        // Retire callback publication before surfacing the failure. The probe
        // transport may still deliver progress after its sibling inventory
        // request has already failed.
        set({ refreshing: false, error: errorMessage(cause), refreshInflight: null })
        throw cause
      }
    })()
    set({ refreshInflight: request })
    try {
      await request
    } finally {
      if (get().publicationEpoch === epoch && get().refreshInflight === request) {
        set({ refreshInflight: null })
      }
    }
  },

  async rediscover(options) {
    const supersedePending = options?.supersedePending === true
    if (!get().loaded) return get().ensureLoaded(options)
    const refreshInflight = get().refreshInflight
    if (refreshInflight && !supersedePending) return refreshInflight
    const inflight = get().rediscoveryInflight
    if (inflight && !supersedePending) return inflight
    const epoch = get().publicationEpoch + 1
    set({
      publicationEpoch: epoch,
      ...(supersedePending ? {
        inflight: null,
        rediscoveryInflight: null,
        refreshInflight: null,
        loading: false,
        refreshing: false,
      } : {}),
    })
    let request!: Promise<void>
    request = (async () => {
      const [listed, snapshot] = await Promise.all([
        asSettled(() => listAgents()),
        asSettled(() => getAgentRuntimeReadiness()),
      ])
      if (get().publicationEpoch !== epoch || get().rediscoveryInflight !== request) return
      const failed = [listed, snapshot].find((result) => result.status === 'rejected')
      set({
        agents: listed.status === 'fulfilled' ? listed.value ?? [] : get().agents,
        readiness: snapshot.status === 'fulfilled' ? snapshot.value ?? null : get().readiness,
        error: failed && failed.status === 'rejected' ? errorMessage(failed.reason) : null,
      })
    })()
    set({ rediscoveryInflight: request })
    try {
      await request
    } finally {
      if (get().publicationEpoch === epoch && get().rediscoveryInflight === request) {
        set({ rediscoveryInflight: null })
      }
    }
  },

  async recoverAfterBackend(generation) {
    const state = get()
    if (generation <= state.observedBackendRecoveryGeneration) return
    if (
      state.backendRecoveryInflightGeneration === generation
      && state.backendRecoveryInflight
    ) {
      return state.backendRecoveryInflight
    }

    let recovery!: Promise<void>
    recovery = (async () => {
      const discovery = get().rediscover({ supersedePending: true })
      const epoch = get().publicationEpoch
      await discovery
      const current = get()
      if (current.backendRecoveryInflight !== recovery) return
      const succeeded = current.publicationEpoch === epoch && current.error === null
      set({
        ...(succeeded ? { observedBackendRecoveryGeneration: generation } : {}),
        backendRecoveryInflightGeneration: null,
        backendRecoveryInflight: null,
      })
    })()
    // The coordinator, not a hopeful request start, owns the claim. Failed or
    // superseded recovery releases it so a later subscriber at the same Auth
    // generation can reconcile again.
    set({
      backendRecoveryInflightGeneration: generation,
      backendRecoveryInflight: recovery,
    })
    return recovery
  },

  async saveQuickAccess(ids: readonly string[]) {
    const nextIds = normalizeAgentRuntimeQuickAccessIds(ids)
    const generation = get().saveGeneration + 1
    set({
      saveGeneration: generation,
      quickAccessIds: nextIds,
      error: null,
    })
    const operation = get().saveQueue.catch(() => undefined).then(async () => {
      if (get().saveGeneration !== generation) return
      try {
        const saved = await preferencesApi.saveAgentRuntimes({ quickAccessIds: nextIds })
        const confirmed = normalizeAgentRuntimeQuickAccessIds(saved.quickAccessIds)
        const latest = get().saveGeneration === generation
        // A superseded write still landed on the server. Keep that as the last
        // confirmed snapshot so a later failed save does not rewind past it.
        set({
          confirmedQuickAccessIds: confirmed,
          ...(latest ? { quickAccessIds: confirmed, error: null } : {}),
        })
      } catch (cause) {
        if (get().saveGeneration !== generation) return
        set({
          quickAccessIds: get().confirmedQuickAccessIds,
          error: errorMessage(cause),
        })
        throw cause
      }
    })
    set({ saveQueue: operation })
    return operation
  },

  async recordSuccessfulUse(agentId: string) {
    const normalizedAgentId = agentId.trim()
    if (!normalizedAgentId) return
    const nextIds = normalizeAgentRuntimeQuickAccessIds([
      normalizedAgentId,
      ...get().recentAgentIds.filter((id) => id !== normalizedAgentId),
    ])
    const generation = get().recentGeneration + 1
    set({ recentGeneration: generation, recentAgentIds: nextIds, error: null })
    const operation = get().recentQueue.catch(() => undefined).then(async () => {
      try {
        const saved = await preferencesApi.rememberAgentRuntimeUse(normalizedAgentId)
        const confirmed = normalizeAgentRuntimeQuickAccessIds(saved.recentAgentIds ?? [])
        const latest = get().recentGeneration === generation
        set({
          confirmedRecentAgentIds: confirmed,
          ...(latest ? { recentAgentIds: confirmed, error: null } : {}),
        })
      } catch (cause) {
        if (get().recentGeneration !== generation) return
        set({ recentAgentIds: get().confirmedRecentAgentIds, error: errorMessage(cause) })
        throw cause
      }
    })
    set({ recentQueue: operation })
    return operation
  },
}))

/** Test-only reset. Drops live discovery and in-flight work without persisting install state. */
export function resetAgentRuntimesStore(): void {
  useAgentRuntimesStore.setState({
    ...emptyStoreSlice,
    publicationEpoch: useAgentRuntimesStore.getState().publicationEpoch + 1,
    observedBackendRecoveryGeneration: 0,
    backendRecoveryInflightGeneration: null,
    backendRecoveryInflight: null,
    saveGeneration: useAgentRuntimesStore.getState().saveGeneration + 1,
    saveQueue: Promise.resolve(),
    recentGeneration: useAgentRuntimesStore.getState().recentGeneration + 1,
    recentQueue: Promise.resolve(),
  })
}

/**
 * Host discovery and quick-access preference boundary for native agent
 * runtimes. One store snapshot is shared by every subscriber. Selecting a
 * runtime outside primary does not write pins.
 */
export function useAgentRuntimes(): AgentRuntimesState {
  const { backendRecoveryGeneration } = useBackendRecoverySignal()
  const agents = useAgentRuntimesStore((state) => state.agents)
  const readiness = useAgentRuntimesStore((state) => state.readiness)
  const quickAccessIds = useAgentRuntimesStore((state) => state.quickAccessIds)
  const recentAgentIds = useAgentRuntimesStore((state) => state.recentAgentIds)
  const loading = useAgentRuntimesStore((state) => state.loading)
  const refreshing = useAgentRuntimesStore((state) => state.refreshing)
  const error = useAgentRuntimesStore((state) => state.error)
  const ensureLoaded = useAgentRuntimesStore((state) => state.ensureLoaded)
  const rediscoverStore = useAgentRuntimesStore((state) => state.rediscover)
  const recoverAfterBackendStore = useAgentRuntimesStore((state) => state.recoverAfterBackend)
  const refreshStore = useAgentRuntimesStore((state) => state.refresh)
  const saveStore = useAgentRuntimesStore((state) => state.saveQuickAccess)
  const recordSuccessfulUseStore = useAgentRuntimesStore((state) => state.recordSuccessfulUse)

  useEffect(() => {
    void ensureLoaded()
  }, [ensureLoaded])

  useEffect(() => {
    // The store, rather than an individual mounted consumer, claims each
    // generation. A surface mounted after recovery must still reconcile a
    // cached inventory left behind by an earlier subscriber.
    if (backendRecoveryGeneration <= 0) return
    void recoverAfterBackendStore(backendRecoveryGeneration)
  }, [backendRecoveryGeneration, recoverAfterBackendStore])

  useEffect(() => {
    const rediscover = () => void rediscoverStore()
    const rediscoverWhenVisible = () => {
      if (document.visibilityState === 'visible') rediscover()
    }
    window.addEventListener('focus', rediscover)
    document.addEventListener('visibilitychange', rediscoverWhenVisible)
    return () => {
      window.removeEventListener('focus', rediscover)
      document.removeEventListener('visibilitychange', rediscoverWhenVisible)
    }
  }, [rediscoverStore])

  const projection = useMemo(
    () => projectAgentRuntimeQuickAccess(agents, quickAccessIds, recentAgentIds),
    [agents, quickAccessIds, recentAgentIds],
  )

  return {
    ...projection,
    agents,
    readiness,
    quickAccessIds,
    recentAgentIds,
    loading,
    refreshing,
    error,
    rediscover: useCallback(() => rediscoverStore(), [rediscoverStore]),
    refresh: useCallback((agent?: string) => refreshStore(agent), [refreshStore]),
    saveQuickAccess: useCallback(
      (ids: readonly string[]) => saveStore(ids),
      [saveStore],
    ),
    recordSuccessfulUse: useCallback(
      (agentId: string) => recordSuccessfulUseStore(agentId),
      [recordSuccessfulUseStore],
    ),
  }
}
