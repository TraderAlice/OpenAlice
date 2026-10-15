// @vitest-environment jsdom
import { setLaunchPreview, getLaunchPreview } from '../conversation/launch-preview'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWebConversation } from './useWebConversation'
import type { WebSessionSnapshot } from './api'
const api = vi.hoisted(() => ({ getWebSession: vi.fn(), openWebSession: vi.fn() }))
vi.mock('./api', () => ({ ...api, abortWebSession: vi.fn(), promptWebSession: vi.fn(), respondWebSession: vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks() })
const snapshot = (revision: number, phase = 'idle') => ({ revision, phase, messages: [], requests: [], error: null }) as unknown as WebSessionSnapshot

describe('Web Session restart', () => {
  it('bridges the launch prompt until the first authoritative snapshot without duplicating it', async () => {
    let resolve!: (value: WebSessionSnapshot) => void
    api.getWebSession.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    setLaunchPreview('workspace', 'session', 'Hello')
    const { result } = renderHook(() => useWebConversation('workspace', 'session'))
    expect(result.current.items).toEqual([{ kind: 'user', key: 'launch-preview', content: [{ kind: 'markdown', text: 'Hello' }] }])
    expect(getLaunchPreview('workspace', 'other')).toBeNull()
    await act(async () => resolve(snapshot(1)))
    expect(result.current.items).toEqual([])
    expect(getLaunchPreview('workspace', 'session')).toBeNull()
  })
  it('accepts a new process revision and ignores an old in-flight poll', async () => {
    api.getWebSession.mockResolvedValue(snapshot(50))
    const { result } = renderHook(() => useWebConversation('workspace', 'session'))
    await waitFor(() => expect(result.current.snapshot?.revision).toBe(50))
    let resolveOld!: (value: WebSessionSnapshot) => void
    api.getWebSession.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    let poll!: Promise<void>
    act(() => { poll = result.current.refresh() })
    api.openWebSession.mockResolvedValue(snapshot(1))
    await act(async () => { await result.current.reconfigure({ credentialSource: 'native', model: 'model', reasoningEffort: 'high' }) })
    expect(api.openWebSession).toHaveBeenCalledWith('workspace', 'session', { credentialSource: 'native', model: 'model', reasoningEffort: 'high' })
    await act(async () => { resolveOld(snapshot(51)); await poll })
    expect(result.current.snapshot?.revision).toBe(1)
    expect(result.current.reconfiguring).toBe(false)
  })
  it('keeps the last transcript when restart fails and refuses changes during a turn', async () => {
    api.getWebSession.mockResolvedValue(snapshot(8))
    const { result } = renderHook(() => useWebConversation('workspace', 'session'))
    await waitFor(() => expect(result.current.snapshot?.revision).toBe(8))
    api.openWebSession.mockRejectedValue(new Error('invalid credential'))
    await act(async () => { await expect(result.current.reconfigure({ credentialSource: 'native' })).rejects.toThrow('invalid credential') })
    expect(result.current.snapshot?.revision).toBe(8)
    expect(result.current.reconfiguring).toBe(false)
    api.getWebSession.mockResolvedValue(snapshot(9, 'working'))
    await act(async () => { await result.current.refresh() })
    await expect(result.current.reconfigure({ credentialSource: 'native' })).rejects.toThrow('Wait for the current response')
    expect(api.openWebSession).toHaveBeenCalledTimes(1)
  })
})
