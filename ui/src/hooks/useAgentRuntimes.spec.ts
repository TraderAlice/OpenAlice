// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { preferencesApi } from '../api/preferences'
import {
  getAgentRuntimeReadiness,
  listAgents,
  probeAgentRuntimeReadiness,
  type AgentInfo,
} from '../components/workspace/api'
import { resetAgentRuntimesStore, useAgentRuntimes } from './useAgentRuntimes'

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
