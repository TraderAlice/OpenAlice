// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  fetchRelayStatus: vi.fn(),
  reconnectRelayTarget: vi.fn(),
  refresh: vi.fn(async () => undefined),
}))

vi.mock('../auth/AuthContext', () => ({ useAuth: mocks.useAuth }))
vi.mock('./useRelayConnection', () => ({
  fetchRelayStatus: mocks.fetchRelayStatus,
  reconnectRelayTarget: mocks.reconnectRelayTarget,
}))

import { useConnectionLifecycle } from './useConnectionLifecycle'

const selected = {
  schemaVersion: 1 as const,
  generation: 1,
  target: { machine: 'cloud', machineName: 'Cloud', project: 'main', projectName: 'Main' },
  switching: false,
  targetConnection: 'unavailable' as const,
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('connection lifecycle', () => {
  it('identifies an unreachable relay separately from an unavailable selected Runtime', async () => {
    mocks.useAuth.mockReturnValue({ backendUnavailable: true, refresh: mocks.refresh })
    mocks.fetchRelayStatus.mockRejectedValue(new Error('relay offline'))
    const { result } = renderHook(() => useConnectionLifecycle(selected, true))
    await waitFor(() => expect(result.current.phase).toBe('relay-unavailable'))
    expect(result.current.relayStatus?.target?.project).toBe('main')
  })

  it('asks the relay to rebuild a failed target before refreshing backend auth', async () => {
    mocks.useAuth.mockReturnValue({ backendUnavailable: true, refresh: mocks.refresh })
    mocks.fetchRelayStatus.mockResolvedValue(selected)
    mocks.reconnectRelayTarget.mockResolvedValue({ ...selected, generation: 2, targetConnection: 'healthy' })
    const { result } = renderHook(() => useConnectionLifecycle(selected, true))
    await waitFor(() => expect(result.current.phase).toBe('target-unavailable'))
    await act(async () => { await result.current.retry() })
    expect(mocks.reconnectRelayTarget).toHaveBeenCalledTimes(1)
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })
})
