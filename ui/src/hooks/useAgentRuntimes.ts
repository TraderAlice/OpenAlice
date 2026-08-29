import { useCallback, useEffect, useMemo } from 'react'
import { create } from 'zustand'

import { preferencesApi } from '../api/preferences'
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
  loadGeneration: number
  saveGeneration: number
  saveQueue: Promise<unknown>
  recentGeneration: number
  recentQueue: Promise<unknown>
  ensureLoaded(): Promise<void>
  refresh(agent?: string): Promise<void>
  saveQuickAccess(ids: readonly string[]): Promise<void>
  recordSuccessfulUse(agentId: string): Promise<void>
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
}

export const useAgentRuntimesStore = create<AgentRuntimesStore>((set, get) => ({
  ...emptyStoreSlice,
  loadGeneration: 0,
  saveGeneration: 0,
  saveQueue: Promise.resolve(),
  recentGeneration: 0,
  recentQueue: Promise.resolve(),

  async ensureLoaded() {
    if (get().loaded) return
    const inflight = get().inflight
    if (inflight) return inflight
    const generation = get().loadGeneration
    const request = (async () => {
      set({ loading: true })
      const [listed, snapshot, preferences] = await Promise.all([
        asSettled(() => listAgents()),
        asSettled(() => getAgentRuntimeReadiness()),
        asSettled(() => preferencesApi.getAgentRuntimes()),
      ])
      if (get().loadGeneration !== generation) return
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
      if (get().inflight === request) set({ inflight: null })
    }
  },

  async refresh(agent?: string) {
    const generation = get().loadGeneration
    set({ refreshing: true, error: null })
    try {
      const [listed, snapshot] = await Promise.all([
        listAgents(),
        probeAgentRuntimeReadiness(agent, (next) => {
          if (get().loadGeneration === generation) set({ readiness: next })
        }),
      ])
      if (get().loadGeneration !== generation) return
      set({
        agents: listed,
        readiness: snapshot,
        refreshing: false,
        error: null,
        loaded: true,
        loading: false,
      })
    } catch (cause) {
      if (get().loadGeneration !== generation) return
      set({ refreshing: false, error: errorMessage(cause) })
      throw cause
    }
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
    loadGeneration: useAgentRuntimesStore.getState().loadGeneration + 1,
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
  const agents = useAgentRuntimesStore((state) => state.agents)
  const readiness = useAgentRuntimesStore((state) => state.readiness)
  const quickAccessIds = useAgentRuntimesStore((state) => state.quickAccessIds)
  const recentAgentIds = useAgentRuntimesStore((state) => state.recentAgentIds)
  const loading = useAgentRuntimesStore((state) => state.loading)
  const refreshing = useAgentRuntimesStore((state) => state.refreshing)
  const error = useAgentRuntimesStore((state) => state.error)
  const ensureLoaded = useAgentRuntimesStore((state) => state.ensureLoaded)
  const refreshStore = useAgentRuntimesStore((state) => state.refresh)
  const saveStore = useAgentRuntimesStore((state) => state.saveQuickAccess)
  const recordSuccessfulUseStore = useAgentRuntimesStore((state) => state.recordSuccessfulUse)

  useEffect(() => {
    void ensureLoaded()
  }, [ensureLoaded])

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
