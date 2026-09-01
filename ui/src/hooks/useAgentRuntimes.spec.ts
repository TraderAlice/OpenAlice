// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { preferencesApi } from '../api/preferences'
import {
  getAgentRuntimeReadiness,
  listAgents,
  probeAgentRuntimeReadiness,
  type AgentInfo,
  type AgentRuntimeReadinessSnapshot,
} from '../components/workspace/api'
import {
  resetAgentRuntimesStore,
  useAgentRuntimes,
  useAgentRuntimesStore,
} from './useAgentRuntimes'

const authMocks = vi.hoisted(() => ({
  backendRecoveryGeneration: 0,
}))

vi.mock('../auth/AuthContext', () => ({
  useBackendRecoverySignal: () => ({ backendRecoveryGeneration: authMocks.backendRecoveryGeneration }),
}))

vi.mock('../api/preferences', () => ({
  preferencesApi: {
    getAgentRuntimes: vi.fn(),
    saveAgentRuntimes: vi.fn(),
    rememberAgentRuntimeUse: vi.fn(),
  },
}))

vi.mock('../components/workspace/api', () => ({
  listAgents: vi.fn(),
  getAgentRuntimeReadiness: vi.fn(),
  probeAgentRuntimeReadiness: vi.fn(),
}))

const capabilities: AgentInfo['capabilities'] = {
  parallelPerCwd: true,
  resumeLast: true,
  resumeById: true,
  transcriptDiscovery: 'none',
}

function agent(id: string, installed = true, kind: AgentInfo['kind'] = 'agent'): AgentInfo {
  return { id, displayName: id, kind, installed, capabilities }
}

const agents: AgentInfo[] = [
  agent('claude'),
  agent('codex', false),
  agent('cursor'),
  agent('agy'),
  agent('grok'),
  agent('omp'),
  agent('opencode'),
  agent('pi'),
  agent('shell', true, 'utility'),
]

const readiness = {
  overallReady: true,
  checkedAt: '2026-08-18T00:00:00.000Z',
  agents: {
    pi: {
      agent: 'pi',
      displayName: 'Pi',
      installed: true,
      binPath: '/usr/bin/pi',
      status: 'ready' as const,
      ready: true,
      source: 'global-login' as const,
      checkedAt: '2026-08-18T00:00:00.000Z',
      durationMs: 12,
    },
  },
}

function discoveredCodex(fingerprint: string): AgentInfo[] {
  return agents.map((entry) => entry.id === 'codex'
    ? { ...entry, installed: true, binPath: '/usr/local/bin/codex', fingerprint }
    : entry)
}

function readinessSnapshot(label: string): AgentRuntimeReadinessSnapshot {
  return {
    ...readiness,
    checkedAt: label,
    agents: {
      ...readiness.agents,
      pi: { ...readiness.agents.pi, fingerprint: label },
    },
  }
}

describe('useAgentRuntimes', () => {
  beforeEach(() => {
    resetAgentRuntimesStore()
    authMocks.backendRecoveryGeneration = 0
    vi.mocked(listAgents).mockReset()
    vi.mocked(getAgentRuntimeReadiness).mockReset()
    vi.mocked(probeAgentRuntimeReadiness).mockReset()
    vi.mocked(preferencesApi.getAgentRuntimes).mockReset()
    vi.mocked(preferencesApi.saveAgentRuntimes).mockReset()
    vi.mocked(preferencesApi.rememberAgentRuntimeUse).mockReset()
    vi.mocked(listAgents).mockResolvedValue(agents)
    vi.mocked(getAgentRuntimeReadiness).mockResolvedValue(readiness)
    vi.mocked(probeAgentRuntimeReadiness).mockResolvedValue(readiness)
    vi.mocked(preferencesApi.getAgentRuntimes).mockResolvedValue({
      quickAccessIds: ['pi', 'grok'],
      recentAgentIds: ['opencode'],
    })
    vi.mocked(preferencesApi.saveAgentRuntimes).mockImplementation(async (next) => ({
      ...next,
      recentAgentIds: ['opencode'],
    }))
    vi.mocked(preferencesApi.rememberAgentRuntimeUse).mockImplementation(async (agentId) => ({
      quickAccessIds: ['pi', 'grok'],
      recentAgentIds: [agentId, 'opencode'].filter((id, index, all) => all.indexOf(id) === index),
    }))
  })

  afterEach(() => {
    resetAgentRuntimesStore()
  })

  it('starts loading and projects recent ids before pins and baseline fallbacks', async () => {
    const { result } = renderHook(() => useAgentRuntimes())
    expect(result.current.loading).toBe(true)
    expect(result.current.primary).toEqual([])
    expect(result.current.error).toBeNull()

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.catalog.map((item) => item.id)).not.toContain('shell')
    expect(result.current.agents.map((item) => item.id)).toContain('shell')
    expect(result.current.primary.map((item) => item.id)).toEqual(['opencode', 'pi', 'grok', 'claude'])
    expect(result.current.notInstalled.map((item) => item.id)).toEqual(['codex'])
    expect(result.current.readiness).toEqual(readiness)
    expect(result.current.quickAccessIds).toEqual(['pi', 'grok'])
    expect(result.current.recentAgentIds).toEqual(['opencode'])
  })

  it('reports a load error without leaving the hook unusable', async () => {
    vi.mocked(listAgents).mockRejectedValueOnce(new Error('agents offline'))
    const { result } = renderHook(() => useAgentRuntimes())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('agents offline')
    expect(result.current.primary).toEqual([])
  })

  it('issues one initial request set for two consumers and shares later saves and refresh', async () => {
    const first = renderHook(() => useAgentRuntimes())
    const second = renderHook(() => useAgentRuntimes())
    await waitFor(() => expect(first.result.current.loading).toBe(false))
    await waitFor(() => expect(second.result.current.loading).toBe(false))

    expect(listAgents).toHaveBeenCalledOnce()
    expect(getAgentRuntimeReadiness).toHaveBeenCalledOnce()
    expect(preferencesApi.getAgentRuntimes).toHaveBeenCalledOnce()
    expect(second.result.current.quickAccessIds).toEqual(first.result.current.quickAccessIds)
    expect(second.result.current.readiness).toBe(first.result.current.readiness)

    await act(async () => {
      await first.result.current.saveQuickAccess(['cursor', 'pi', 'cursor', 'omp'])
    })
    expect(preferencesApi.saveAgentRuntimes).toHaveBeenCalledOnce()
    expect(first.result.current.quickAccessIds).toEqual(['cursor', 'pi', 'omp'])
    expect(second.result.current.quickAccessIds).toEqual(['cursor', 'pi', 'omp'])
    expect(second.result.current.primary.map((item) => item.id)).toEqual(['opencode', 'cursor', 'pi', 'omp'])

    await act(async () => {
      await second.result.current.refresh('pi')
    })
    expect(probeAgentRuntimeReadiness).toHaveBeenCalledOnce()
    expect(probeAgentRuntimeReadiness).toHaveBeenCalledWith('pi', expect.any(Function))
    expect(first.result.current.readiness).toEqual(readiness)
    expect(second.result.current.refreshing).toBe(false)
  })

  it('rediscovers installed runtimes on focus without starting a readiness probe', async () => {
    const runtimes = renderHook(() => useAgentRuntimes())
    await waitFor(() => expect(runtimes.result.current.loading).toBe(false))

    const updatedAgents = agents.map((entry) => entry.id === 'codex'
      ? { ...entry, installed: true, binPath: '/usr/local/bin/codex', fingerprint: 'codex-v2' }
      : entry)
    const updatedReadiness = {
      ...readiness,
      overallReady: false,
      checkedAt: null,
      agents: {
        ...readiness.agents,
        codex: {
          agent: 'codex',
          displayName: 'Codex',
          installed: true,
          binPath: '/usr/local/bin/codex',
          fingerprint: 'codex-v2',
          status: 'unknown' as const,
          ready: false,
          source: 'unknown' as const,
          checkedAt: null,
          durationMs: null,
        },
      },
    }
    vi.mocked(listAgents).mockResolvedValue(updatedAgents)
    vi.mocked(getAgentRuntimeReadiness).mockResolvedValue(updatedReadiness)

    act(() => window.dispatchEvent(new Event('focus')))

    await waitFor(() => expect(runtimes.result.current.catalog.find((entry) => entry.id === 'codex')?.installed).toBe(true))
    expect(listAgents).toHaveBeenCalledTimes(2)
    expect(getAgentRuntimeReadiness).toHaveBeenCalledTimes(2)
    expect(probeAgentRuntimeReadiness).not.toHaveBeenCalled()
    expect(runtimes.result.current.readiness?.agents.codex?.status).toBe('unknown')

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(listAgents).toHaveBeenCalledTimes(2)
    visibility.mockReturnValue('visible')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await waitFor(() => expect(listAgents).toHaveBeenCalledTimes(3))
    expect(getAgentRuntimeReadiness).toHaveBeenCalledTimes(3)
    expect(probeAgentRuntimeReadiness).not.toHaveBeenCalled()
    visibility.mockRestore()
  })

  it('cheaply rediscovers runtimes when backend recovery generation advances', async () => {
    const runtimes = renderHook(() => useAgentRuntimes())
    await waitFor(() => expect(runtimes.result.current.loading).toBe(false))

    const updatedAgents = agents.map((entry) => entry.id === 'codex'
      ? { ...entry, installed: true, binPath: '/usr/local/bin/codex', fingerprint: 'codex-recovered' }
      : entry)
    const updatedReadiness = {
      ...readiness,
      overallReady: false,
      checkedAt: null,
      agents: {
        ...readiness.agents,
        codex: {
          agent: 'codex',
          displayName: 'Codex',
          installed: true,
          binPath: '/usr/local/bin/codex',
          fingerprint: 'codex-recovered',
          status: 'unknown' as const,
          ready: false,
          source: 'unknown' as const,
          checkedAt: null,
          durationMs: null,
        },
      },
    }
    vi.mocked(listAgents).mockResolvedValue(updatedAgents)
    vi.mocked(getAgentRuntimeReadiness).mockResolvedValue(updatedReadiness)

    authMocks.backendRecoveryGeneration = 1
    runtimes.rerender()

    await waitFor(() => expect(listAgents).toHaveBeenCalledTimes(2))
    expect(getAgentRuntimeReadiness).toHaveBeenCalledTimes(2)
    expect(probeAgentRuntimeReadiness).not.toHaveBeenCalled()
    expect(runtimes.result.current.catalog.find((entry) => entry.id === 'codex')?.installed).toBe(true)
    expect(runtimes.result.current.readiness?.agents.codex?.status).toBe('unknown')

    runtimes.rerender()
    await act(async () => undefined)
    expect(listAgents).toHaveBeenCalledTimes(2)

    authMocks.backendRecoveryGeneration = 2
    runtimes.rerender()
    await waitFor(() => expect(listAgents).toHaveBeenCalledTimes(3))
    expect(getAgentRuntimeReadiness).toHaveBeenCalledTimes(3)
    expect(probeAgentRuntimeReadiness).not.toHaveBeenCalled()
  })

  it('reconciles a shared cached inventory when the first subscriber mounts after recovery', async () => {
    useAgentRuntimesStore.setState({
      agents,
      readiness,
      loaded: true,
      loading: false,
      observedBackendRecoveryGeneration: 0,
    })
    const recoveredAgents = agents.map((entry) => entry.id === 'codex'
      ? { ...entry, installed: true, binPath: '/usr/local/bin/codex', fingerprint: 'codex-late-mount' }
      : entry)
    vi.mocked(listAgents).mockResolvedValueOnce(recoveredAgents)
    vi.mocked(getAgentRuntimeReadiness).mockResolvedValueOnce(readiness)
    authMocks.backendRecoveryGeneration = 3

    const runtimes = renderHook(() => useAgentRuntimes())

    await waitFor(() => expect(listAgents).toHaveBeenCalledOnce())
    await waitFor(() => expect(
      runtimes.result.current.catalog.find((entry) => entry.id === 'codex')?.fingerprint,
    ).toBe('codex-late-mount'))
    expect(useAgentRuntimesStore.getState().observedBackendRecoveryGeneration).toBe(3)
  })

  it('supersedes a hanging pre-recovery rediscovery and ignores its late snapshot', async () => {
    const runtimes = renderHook(() => useAgentRuntimes())
    await waitFor(() => expect(runtimes.result.current.loading).toBe(false))

    const staleAgents = deferred<AgentInfo[]>()
    const staleReadiness = deferred<typeof readiness>()
    vi.mocked(listAgents).mockReturnValueOnce(staleAgents.promise)
    vi.mocked(getAgentRuntimeReadiness).mockReturnValueOnce(staleReadiness.promise)
    act(() => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(listAgents).toHaveBeenCalledTimes(2))

    const recoveredAgents = agents.map((entry) => entry.id === 'codex'
      ? { ...entry, installed: true, binPath: '/usr/local/bin/codex', fingerprint: 'codex-recovered' }
      : entry)
    const recoveredReadiness = {
      ...readiness,
      agents: {
        ...readiness.agents,
        codex: {
          agent: 'codex',
          displayName: 'Codex',
          installed: true,
          binPath: '/usr/local/bin/codex',
          fingerprint: 'codex-recovered',
          status: 'unknown' as const,
          ready: false,
          source: 'unknown' as const,
          checkedAt: null,
          durationMs: null,
        },
      },
    }
    vi.mocked(listAgents).mockResolvedValueOnce(recoveredAgents)
    vi.mocked(getAgentRuntimeReadiness).mockResolvedValueOnce(recoveredReadiness)

    authMocks.backendRecoveryGeneration = 1
    runtimes.rerender()

    await waitFor(() => expect(listAgents).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(
      runtimes.result.current.catalog.find((entry) => entry.id === 'codex')?.fingerprint,
    ).toBe('codex-recovered'))

    await act(async () => {
      staleAgents.resolve(agents)
      staleReadiness.resolve(readiness)
      await staleAgents.promise
      await staleReadiness.promise
    })
    expect(runtimes.result.current.catalog.find((entry) => entry.id === 'codex')?.fingerprint)
      .toBe('codex-recovered')
  })

  it('supersedes a hanging initial load when backend recovery arrives before loaded', async () => {
    const staleAgents = deferred<AgentInfo[]>()
    const staleReadiness = deferred<typeof readiness>()
    const stalePreferences = deferred<{ quickAccessIds: string[]; recentAgentIds: string[] }>()
    vi.mocked(listAgents).mockReturnValueOnce(staleAgents.promise)
    vi.mocked(getAgentRuntimeReadiness).mockReturnValueOnce(staleReadiness.promise)
    vi.mocked(preferencesApi.getAgentRuntimes).mockReturnValueOnce(stalePreferences.promise)

    const runtimes = renderHook(() => useAgentRuntimes())
    await waitFor(() => expect(listAgents).toHaveBeenCalledOnce())
    expect(runtimes.result.current.loading).toBe(true)

    const recoveredAgents = agents.map((entry) => entry.id === 'codex'
      ? { ...entry, installed: true, binPath: '/usr/local/bin/codex', fingerprint: 'codex-initial-recovery' }
      : entry)
    vi.mocked(listAgents).mockResolvedValueOnce(recoveredAgents)
    vi.mocked(getAgentRuntimeReadiness).mockResolvedValueOnce(readiness)
    vi.mocked(preferencesApi.getAgentRuntimes).mockResolvedValueOnce({
      quickAccessIds: ['cursor'],
      recentAgentIds: ['claude'],
    })

    authMocks.backendRecoveryGeneration = 1
    runtimes.rerender()

    await waitFor(() => expect(listAgents).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(runtimes.result.current.loading).toBe(false))
    expect(runtimes.result.current.catalog.find((entry) => entry.id === 'codex')?.fingerprint)
      .toBe('codex-initial-recovery')
    expect(runtimes.result.current.quickAccessIds).toEqual(['cursor'])

    await act(async () => {
      staleAgents.resolve(agents)
      staleReadiness.resolve(readiness)
      stalePreferences.resolve({ quickAccessIds: ['pi'], recentAgentIds: ['opencode'] })
      await Promise.all([staleAgents.promise, staleReadiness.promise, stalePreferences.promise])
    })
    expect(runtimes.result.current.catalog.find((entry) => entry.id === 'codex')?.fingerprint)
      .toBe('codex-initial-recovery')
    expect(runtimes.result.current.quickAccessIds).toEqual(['cursor'])
  })

  it('releases a failed recovery claim so a later subscriber retries the same generation', async () => {
    const first = renderHook(() => useAgentRuntimes())
    await waitFor(() => expect(first.result.current.loading).toBe(false))

    vi.mocked(listAgents).mockRejectedValueOnce(new Error('inventory still restarting'))
    vi.mocked(getAgentRuntimeReadiness).mockRejectedValueOnce(new Error('readiness still restarting'))
    authMocks.backendRecoveryGeneration = 1
    first.rerender()

    await waitFor(() => expect(first.result.current.error).toBe('inventory still restarting'))
    expect(useAgentRuntimesStore.getState()).toMatchObject({
      observedBackendRecoveryGeneration: 0,
      backendRecoveryInflightGeneration: null,
      backendRecoveryInflight: null,
    })

    vi.mocked(listAgents).mockResolvedValueOnce(discoveredCodex('same-generation-retry'))
    vi.mocked(getAgentRuntimeReadiness).mockResolvedValueOnce(readinessSnapshot('same-generation-retry'))
    const second = renderHook(() => useAgentRuntimes())

    await waitFor(() => expect(
      second.result.current.catalog.find((entry) => entry.id === 'codex')?.fingerprint,
    ).toBe('same-generation-retry'))
    expect(useAgentRuntimesStore.getState()).toMatchObject({
      observedBackendRecoveryGeneration: 1,
      backendRecoveryInflightGeneration: null,
      backendRecoveryInflight: null,
    })
  })

  it('lets an explicit diagnostic refresh supersede a pending rediscovery', async () => {
    const runtimes = renderHook(() => useAgentRuntimes())
    await waitFor(() => expect(runtimes.result.current.loading).toBe(false))

    const rediscoveredAgents = deferred<AgentInfo[]>()
    const rediscoveredReadiness = deferred<AgentRuntimeReadinessSnapshot>()
    vi.mocked(listAgents).mockReturnValueOnce(rediscoveredAgents.promise)
    vi.mocked(getAgentRuntimeReadiness).mockReturnValueOnce(rediscoveredReadiness.promise)
    act(() => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(listAgents).toHaveBeenCalledTimes(2))

    const probedAgents = deferred<AgentInfo[]>()
    const probedReadiness = deferred<AgentRuntimeReadinessSnapshot>()
    vi.mocked(listAgents).mockReturnValueOnce(probedAgents.promise)
    vi.mocked(probeAgentRuntimeReadiness).mockReturnValueOnce(probedReadiness.promise)
    let refreshPromise!: Promise<void>
    act(() => {
      refreshPromise = runtimes.result.current.refresh('pi')
    })
    expect(runtimes.result.current.refreshing).toBe(true)

    await act(async () => {
      probedAgents.resolve(discoveredCodex('probe-current'))
      probedReadiness.resolve(readinessSnapshot('probe-current'))
      await refreshPromise
    })
    expect(runtimes.result.current.catalog.find((entry) => entry.id === 'codex')?.fingerprint)
      .toBe('probe-current')
    expect(runtimes.result.current.readiness?.checkedAt).toBe('probe-current')
    expect(runtimes.result.current.refreshing).toBe(false)

    await act(async () => {
      rediscoveredAgents.resolve(discoveredCodex('rediscovery-stale'))
      rediscoveredReadiness.resolve(readinessSnapshot('rediscovery-stale'))
      await Promise.all([rediscoveredAgents.promise, rediscoveredReadiness.promise])
    })
    expect(runtimes.result.current.catalog.find((entry) => entry.id === 'codex')?.fingerprint)
      .toBe('probe-current')
    expect(runtimes.result.current.readiness?.checkedAt).toBe('probe-current')
    expect(runtimes.result.current.refreshing).toBe(false)
  })

  it('keeps refresh B authoritative when refresh A callbacks and result arrive later', async () => {
    const runtimes = renderHook(() => useAgentRuntimes())
    await waitFor(() => expect(runtimes.result.current.loading).toBe(false))

    const agentsA = deferred<AgentInfo[]>()
    const readinessA = deferred<AgentRuntimeReadinessSnapshot>()
    const agentsB = deferred<AgentInfo[]>()
    const readinessB = deferred<AgentRuntimeReadinessSnapshot>()
    let publishA: ((snapshot: AgentRuntimeReadinessSnapshot) => void) | undefined
    let publishB: ((snapshot: AgentRuntimeReadinessSnapshot) => void) | undefined
    vi.mocked(listAgents)
      .mockReturnValueOnce(agentsA.promise)
      .mockReturnValueOnce(agentsB.promise)
    vi.mocked(probeAgentRuntimeReadiness)
      .mockImplementationOnce((_agent, publish) => {
        publishA = publish
        return readinessA.promise
      })
      .mockImplementationOnce((_agent, publish) => {
        publishB = publish
        return readinessB.promise
      })

    let refreshA!: Promise<void>
    let refreshB!: Promise<void>
    act(() => {
      refreshA = runtimes.result.current.refresh('pi')
      refreshB = runtimes.result.current.refresh('pi')
    })
    act(() => publishB?.(readinessSnapshot('probe-b-progress')))
    expect(runtimes.result.current.readiness?.checkedAt).toBe('probe-b-progress')
    expect(runtimes.result.current.refreshing).toBe(true)

    await act(async () => {
      agentsB.resolve(discoveredCodex('probe-b-final'))
      readinessB.resolve(readinessSnapshot('probe-b-final'))
      await refreshB
    })
    expect(runtimes.result.current.catalog.find((entry) => entry.id === 'codex')?.fingerprint)
      .toBe('probe-b-final')
    expect(runtimes.result.current.readiness?.checkedAt).toBe('probe-b-final')
    expect(runtimes.result.current.refreshing).toBe(false)

    await act(async () => {
      publishA?.(readinessSnapshot('probe-a-late-progress'))
      agentsA.resolve(discoveredCodex('probe-a-late-final'))
      readinessA.resolve(readinessSnapshot('probe-a-late-final'))
      await refreshA
    })
    expect(runtimes.result.current.catalog.find((entry) => entry.id === 'codex')?.fingerprint)
      .toBe('probe-b-final')
    expect(runtimes.result.current.readiness?.checkedAt).toBe('probe-b-final')
    expect(runtimes.result.current.refreshing).toBe(false)
    expect(runtimes.result.current.error).toBeNull()
  })

  it('retires probe callbacks when the sibling Agent inventory refresh fails first', async () => {
    const runtimes = renderHook(() => useAgentRuntimes())
    await waitFor(() => expect(runtimes.result.current.loading).toBe(false))

    const probedReadiness = deferred<AgentRuntimeReadinessSnapshot>()
    let publish: ((snapshot: AgentRuntimeReadinessSnapshot) => void) | undefined
    vi.mocked(listAgents).mockRejectedValueOnce(new Error('inventory unavailable'))
    vi.mocked(probeAgentRuntimeReadiness).mockImplementationOnce((_agent, next) => {
      publish = next
      return probedReadiness.promise
    })

    let refreshPromise!: Promise<void>
    act(() => {
      refreshPromise = runtimes.result.current.refresh('pi')
    })
    await expect(refreshPromise).rejects.toThrow('inventory unavailable')
    expect(runtimes.result.current.refreshing).toBe(false)
    expect(runtimes.result.current.error).toBe('inventory unavailable')
    const retained = runtimes.result.current.readiness

    await act(async () => {
      publish?.(readinessSnapshot('late-failed-progress'))
      probedReadiness.resolve(readinessSnapshot('late-failed-final'))
      await probedReadiness.promise
    })
    expect(runtimes.result.current.readiness).toBe(retained)
    expect(runtimes.result.current.error).toBe('inventory unavailable')
  })

  it('restores the last confirmed pins and exposes an error when an optimistic save fails', async () => {
    const { result } = renderHook(() => useAgentRuntimes())
    await waitFor(() => expect(result.current.loading).toBe(false))
    vi.mocked(preferencesApi.saveAgentRuntimes).mockRejectedValueOnce(new Error('write failed'))

    await act(async () => {
      await expect(result.current.saveQuickAccess(['cursor', 'pi'])).rejects.toThrow('write failed')
    })
    expect(result.current.quickAccessIds).toEqual(['pi', 'grok'])
    expect(result.current.error).toBe('write failed')
    expect(result.current.primary.map((item) => item.id)).toEqual(['opencode', 'pi', 'grok', 'claude'])
  })

  it('keeps a successful stale save as confirmed when the later intent fails', async () => {
    const { result } = renderHook(() => useAgentRuntimes())
    await waitFor(() => expect(result.current.loading).toBe(false))

    type RuntimePreferences = { quickAccessIds: readonly string[]; recentAgentIds: readonly string[] }
    let finishA: (value: RuntimePreferences) => void = () => undefined
    const pendingA = new Promise<RuntimePreferences>((resolve) => {
      finishA = resolve
    })
    let failB: () => void = () => undefined
    const pendingB = new Promise<RuntimePreferences>((_resolve, reject) => {
      failB = () => reject(new Error('write failed'))
    })
    vi.mocked(preferencesApi.saveAgentRuntimes)
      .mockImplementationOnce(() => pendingA)
      .mockImplementationOnce(() => pendingB)

    let saveA: Promise<void> = Promise.resolve()
    await act(async () => {
      saveA = result.current.saveQuickAccess(['cursor'])
    })
    await waitFor(() => expect(preferencesApi.saveAgentRuntimes).toHaveBeenCalledOnce())
    expect(result.current.quickAccessIds).toEqual(['cursor'])

    let saveB: Promise<void> = Promise.resolve()
    await act(async () => {
      saveB = result.current.saveQuickAccess(['claude'])
    })
    expect(result.current.quickAccessIds).toEqual(['claude'])

    await act(async () => {
      finishA({ quickAccessIds: ['cursor'], recentAgentIds: ['opencode'] })
      await saveA
    })
    await waitFor(() => expect(preferencesApi.saveAgentRuntimes).toHaveBeenCalledTimes(2))
    expect(result.current.quickAccessIds).toEqual(['claude'])

    await act(async () => {
      failB()
      await expect(saveB).rejects.toThrow('write failed')
    })
    expect(result.current.quickAccessIds).toEqual(['cursor'])
    expect(result.current.error).toBe('write failed')
    expect(result.current.primary.map((item) => item.id)[0]).toBe('opencode')
  })

  it('promotes only successful launches and persists the complete MRU order', async () => {
    const runtimes = renderHook(() => useAgentRuntimes())
    await waitFor(() => expect(runtimes.result.current.loading).toBe(false))
    expect(runtimes.result.current.recentAgentIds).toEqual(['opencode'])
    expect(runtimes.result.current.primary.map((item) => item.id)).toEqual(['opencode', 'pi', 'grok', 'claude'])

    await act(async () => {
      await runtimes.result.current.recordSuccessfulUse('cursor')
    })
    expect(preferencesApi.rememberAgentRuntimeUse).toHaveBeenCalledWith('cursor')
    expect(runtimes.result.current.recentAgentIds).toEqual(['cursor', 'opencode'])
    expect(runtimes.result.current.primary.map((item) => item.id)).toEqual(['cursor', 'opencode', 'pi', 'grok'])
    expect(runtimes.result.current.quickAccessIds).toEqual(['pi', 'grok'])
  })

  it('records every successful launch when promotions arrive back-to-back', async () => {
    const runtimes = renderHook(() => useAgentRuntimes())
    await waitFor(() => expect(runtimes.result.current.loading).toBe(false))

    await act(async () => {
      await Promise.all([
        runtimes.result.current.recordSuccessfulUse('cursor'),
        runtimes.result.current.recordSuccessfulUse('claude'),
      ])
    })

    expect(preferencesApi.rememberAgentRuntimeUse).toHaveBeenNthCalledWith(1, 'cursor')
    expect(preferencesApi.rememberAgentRuntimeUse).toHaveBeenNthCalledWith(2, 'claude')
  })
})

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}
