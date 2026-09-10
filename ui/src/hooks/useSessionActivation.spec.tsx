// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getWorkspaceSessionDirectory, type SessionRecord } from '../components/workspace/api'
import { useSessionActivation } from './useSessionActivation'
vi.mock('../components/workspace/api', () => ({ getWorkspaceSessionDirectory: vi.fn() }))
const record = { id: 'session', resumeId: 'resume', state: 'paused' } as SessionRecord

describe('Session route activation', () => {
  it('checks background ownership before launching a paused record', async () => {
    vi.mocked(getWorkspaceSessionDirectory).mockResolvedValue({ sessions: [
      { resumeId: 'resume', latestExecution: { status: 'running' } },
    ] } as never)
    const open = vi.fn()
    const { result, rerender } = renderHook(() => useSessionActivation({
      record, workspaceId: 'ws', enabled: true, automatic: true, open, busyMessage: 'Busy',
    }))
    await waitFor(() => expect(result.current.error).toBe('Busy'))
    rerender()
    expect(open).not.toHaveBeenCalled()
    expect(getWorkspaceSessionDirectory).toHaveBeenCalledTimes(1)
    vi.mocked(getWorkspaceSessionDirectory).mockResolvedValue({ sessions: [] } as never)
    await act(() => result.current.activate())
    expect(open).toHaveBeenCalledOnce()
  })
  it('does not launch hidden tabs or reconnect an explicitly disconnected session', async () => {
    const open = vi.fn()
    const { rerender } = renderHook(({ enabled, automatic }) => useSessionActivation({
      record, enabled, automatic, open, busyMessage: 'Busy',
    }), { initialProps: { enabled: false, automatic: true } })
    expect(open).not.toHaveBeenCalled()
    rerender({ enabled: true, automatic: false })
    expect(open).not.toHaveBeenCalled()
  })
  it('exposes startup errors and only retries explicitly', async () => {
    const open = vi.fn().mockRejectedValue(new Error('CLI missing'))
    const { result, rerender } = renderHook(() => useSessionActivation({
      record, enabled: true, automatic: true, open, busyMessage: 'Busy',
    }))
    await waitFor(() => expect(result.current.error).toBe('CLI missing'))
    rerender()
    expect(open).toHaveBeenCalledOnce()
    await act(() => result.current.activate())
    expect(open).toHaveBeenCalledTimes(2)
  })
})
